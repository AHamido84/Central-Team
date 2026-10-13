import 'server-only';

import { and, asc, eq, gte, inArray, isNotNull, lte, ne, or, sql } from 'drizzle-orm';

import type { AgencyContext } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import {
  aiInsights,
  aiSettings,
  aiUsage,
  campaignChannels,
  clientPackages,
  clients,
  crmActivities,
  crmSettings,
  deals,
  deliverables,
  deliverableVersions,
  departments,
  integrationConnections,
  kpiSnapshots,
  kpiTargets,
  leads,
  metricsDaily,
  organizationMembers,
  packages,
  profiles,
  requestTypes,
  requests,
  taskMembers,
  tasks,
  timeEntries,
  workflowTemplateSteps,
} from '@/lib/db/schema';
import { capacityGrid } from '@/modules/capacity/calc';
import { getCapacity } from '@/modules/capacity/server/queries';
import { listCampaigns } from '@/modules/campaigns/server/queries';
import { getCurrentPackageUsage } from '@/modules/clients/server/package-usage';
import { getSalesData } from '@/modules/crm/server/dashboard';
import { buildExecutiveReport, type ExecutiveInputs, type ExecutiveReport } from '@/modules/executive/compute';
import { addDays, addMonths, comparisonPeriod, monthStart, resolvePeriod } from '@/modules/executive/kpi';
import type { ExecutiveViewConfig } from '@/modules/executive/types';
import { getOpsOverview } from '@/modules/operations/server/queries';
import { dayInZone } from '@/modules/tasks/constants';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Everything the Executive Center shows for one view (FR7, ADR-096), read as the signed-in executive. RLS decides
 * what that is: the executive roles read every client. The operational screens' own loaders are called as they are
 * (ops overview, sales data, capacity, campaigns, package usage) so their numbers carry over unchanged; the rest is
 * read here over the window the period, its comparison and the 12-month sparklines need.
 */
export async function getExecutiveReport(ctx: AgencyContext, config: ExecutiveViewConfig): Promise<ExecutiveReport> {
  const inputs = await loadExecutiveInputs(ctx, config);
  return buildExecutiveReport(inputs);
}

export async function loadExecutiveInputs(ctx: AgencyContext, config: ExecutiveViewConfig): Promise<ExecutiveInputs> {
  const orgId = ctx.organization.id;
  const today = dayInZone(new Date(), ctx.organization.defaultTimezone);
  const period = resolvePeriod(config.preset, today, { from: config.from, to: config.to });
  const comparison = comparisonPeriod(period, config.compare, today);
  // Sparklines run 12 months back from the period's (last) month; the comparison may start earlier still.
  const sparkFrom = addMonths(monthStart(period.to < today ? period.to : today), -11);
  const from = [sparkFrom, period.from, comparison?.from ?? period.from].sort()[0]!;
  const to = period.to > today ? today : period.to;
  const fromTs = new Date(`${from}T00:00:00Z`);

  const [ops, sales, capacity, campaignList, rows] = await Promise.all([
    getOpsOverview(ctx, { kind: 'all' }),
    getSalesData(ctx, { period: 'year', ownerId: null, pipelineId: null }),
    getCapacity(ctx),
    listCampaigns(),
    withRls(async (tx) => {
      const clientRows = await tx
        .select({ id: clients.id, name: clients.name, accountManagerId: clients.accountManagerId, status: clients.status })
        .from(clients)
        .where(eq(clients.organizationId, orgId))
        .orderBy(asc(sql`${clients.name}->>'en'`));
      const clientIds = clientRows.map((c) => c.id);
      const pkgRows = await tx
        .select({
          clientId: clientPackages.clientId,
          packageId: clientPackages.packageId,
          packageName: packages.name,
          priceMinor: packages.priceMinor,
          periodStart: clientPackages.periodStart,
          periodEnd: clientPackages.periodEnd,
        })
        .from(clientPackages)
        .innerJoin(packages, eq(packages.id, clientPackages.packageId))
        .where(eq(clientPackages.organizationId, orgId));
      const usage = await Promise.all(
        clientIds.map(async (id) => {
          const u = await getCurrentPackageUsage(tx, id);
          if (!u) return { clientId: id, ratio: null, over: 0 };
          const allowed = u.items.reduce((n, i) => n + i.allowed, 0);
          const used = u.items.reduce((n, i) => n + i.used, 0);
          return { clientId: id, ratio: allowed ? used / allowed : null, over: u.items.filter((i) => i.used > i.allowed).length };
        }),
      );
      const types = await tx
        .select({ id: requestTypes.id, name: requestTypes.name })
        .from(requestTypes)
        .where(eq(requestTypes.organizationId, orgId));
      const reqRows = await tx
        .select({
          id: requests.id,
          clientId: requests.clientId,
          typeId: requests.requestTypeId,
          status: requests.status,
          isExtra: requests.isExtra,
          submittedAt: requests.submittedAt,
          responseDueAt: requests.responseDueAt,
          firstResponseAt: requests.firstResponseAt,
          dueDate: requests.dueDate,
          deliveredAt: requests.deliveredAt,
        })
        .from(requests)
        .where(
          and(
            eq(requests.organizationId, orgId),
            ne(requests.status, 'draft'),
            // Everything in the window, plus whatever is still open (the backlog).
            or(
              gte(requests.submittedAt, fromTs),
              gte(requests.deliveredAt, fromTs),
              sql`${requests.status} not in ('delivered','closed','cancelled','rejected')`,
            ),
          ),
        );
      const delRows = await tx
        .select({
          id: deliverables.id,
          clientId: deliverables.clientId,
          revisionRounds: deliverables.revisionRounds,
          status: deliverables.status,
          approvedAt: deliverables.approvedAt,
          dueDate: tasks.dueDate,
        })
        .from(deliverables)
        .leftJoin(tasks, eq(tasks.id, deliverables.taskId))
        .where(
          and(eq(deliverables.organizationId, orgId), or(gte(deliverables.approvedAt, fromTs), sql`${deliverables.approvedAt} is null`)),
        );
      const decisionRows = await tx
        .select({
          clientId: deliverableVersions.clientId,
          sentAt: deliverableVersions.sentToClientAt,
          decidedAt: deliverableVersions.decidedAt,
        })
        .from(deliverableVersions)
        .where(
          and(
            eq(deliverableVersions.organizationId, orgId),
            isNotNull(deliverableVersions.sentToClientAt),
            isNotNull(deliverableVersions.decidedAt),
            gte(deliverableVersions.decidedAt, fromTs),
          ),
        );
      const taskRows = await tx
        .select({
          id: tasks.id,
          clientId: tasks.clientId,
          departmentId: tasks.departmentId,
          statusCategory: tasks.statusCategory,
          dueDate: tasks.dueDate,
          completedAt: tasks.completedAt,
          createdAt: tasks.createdAt,
          startDate: tasks.startDate,
          stepName: workflowTemplateSteps.name,
        })
        .from(tasks)
        .leftJoin(workflowTemplateSteps, eq(workflowTemplateSteps.id, tasks.workflowStepId))
        .where(and(eq(tasks.organizationId, orgId), or(gte(tasks.completedAt, fromTs), ne(tasks.statusCategory, 'done'))));
      const assignees = taskRows.length
        ? await tx
            .select({ taskId: taskMembers.taskId, userId: taskMembers.userId })
            .from(taskMembers)
            .where(
              and(
                eq(taskMembers.role, 'assignee'),
                inArray(
                  taskMembers.taskId,
                  taskRows.map((t) => t.id),
                ),
              ),
            )
        : [];
      const timeRows = await tx
        .select({
          userId: timeEntries.userId,
          clientId: timeEntries.clientId,
          day: sql<string>`(${timeEntries.startedAt} at time zone ${ctx.organization.defaultTimezone})::date::text`,
          minutes: timeEntries.minutes,
        })
        .from(timeEntries)
        .where(and(eq(timeEntries.organizationId, orgId), gte(timeEntries.startedAt, fromTs)));
      const deptRows = await tx
        .select({ id: departments.id, name: departments.name, color: departments.color })
        .from(departments)
        .where(and(eq(departments.organizationId, orgId), eq(departments.isArchived, false)))
        .orderBy(asc(departments.sortOrder));
      const metricRows = await tx
        .select({
          date: metricsDaily.date,
          campaignId: metricsDaily.campaignId,
          clientId: metricsDaily.clientId,
          platform: campaignChannels.platform,
          spend: metricsDaily.spendMinor,
          impressions: metricsDaily.impressions,
          clicks: metricsDaily.clicks,
          conversions: metricsDaily.conversions,
          leads: metricsDaily.leads,
          revenue: metricsDaily.revenueMinor,
        })
        .from(metricsDaily)
        .innerJoin(campaignChannels, eq(campaignChannels.id, metricsDaily.channelId))
        .where(and(eq(metricsDaily.organizationId, orgId), gte(metricsDaily.date, from), lte(metricsDaily.date, to)));
      const insightRows = await tx
        .select({ clientId: aiInsights.clientId, severity: aiInsights.severity, status: aiInsights.status })
        .from(aiInsights)
        .where(eq(aiInsights.organizationId, orgId));
      const dealExtra = await tx
        .select({ id: deals.id, title: deals.title, lastActivityAt: deals.lastActivityAt, clientId: deals.clientId })
        .from(deals)
        .where(eq(deals.organizationId, orgId));
      const [settings] = await tx
        .select({ staleDays: crmSettings.staleDays })
        .from(crmSettings)
        .where(eq(crmSettings.organizationId, orgId));
      const leadRows = await tx
        .select({
          createdAt: leads.createdAt,
          firstActivityAt: sql<
            string | null
          >`(select min(${crmActivities.createdAt}) from ${crmActivities} where ${crmActivities.leadId} = ${leads.id})`,
        })
        .from(leads)
        .where(and(eq(leads.organizationId, orgId), gte(leads.createdAt, fromTs)));
      const integrations = await tx
        .select({
          id: integrationConnections.id,
          provider: integrationConnections.provider,
          name: integrationConnections.name,
          status: integrationConnections.status,
          tokenExpiresAt: integrationConnections.tokenExpiresAt,
          ownerId: integrationConnections.connectedBy,
        })
        .from(integrationConnections)
        .where(and(eq(integrationConnections.organizationId, orgId), ne(integrationConnections.status, 'disconnected')));
      const [ai] = await tx.select({ budget: aiSettings.monthlyTokenBudget }).from(aiSettings).where(eq(aiSettings.organizationId, orgId));
      const [used] = await tx
        .select({ n: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::float8` })
        .from(aiUsage)
        .where(and(eq(aiUsage.organizationId, orgId), gte(aiUsage.createdAt, new Date(`${today.slice(0, 7)}-01T00:00:00Z`))));
      const targets = await tx
        .select({ metric: kpiTargets.metric, year: kpiTargets.year, quarter: kpiTargets.quarter, value: kpiTargets.value })
        .from(kpiTargets)
        .where(eq(kpiTargets.organizationId, orgId));
      const snapshots = await tx
        .select({ day: kpiSnapshots.day, metric: kpiSnapshots.metric, value: kpiSnapshots.value, details: kpiSnapshots.details })
        .from(kpiSnapshots)
        .where(and(eq(kpiSnapshots.organizationId, orgId), gte(kpiSnapshots.day, addDays(from, -31))));
      const memberRows = await tx
        .select({ id: profiles.id, name: profiles.fullName })
        .from(organizationMembers)
        .innerJoin(profiles, eq(profiles.id, organizationMembers.userId))
        .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userType, 'agency')));
      return {
        memberRows,
        clientRows,
        pkgRows,
        usage,
        types,
        reqRows,
        delRows,
        decisionRows,
        taskRows,
        assignees,
        timeRows,
        deptRows,
        metricRows,
        insightRows,
        dealExtra,
        staleDays: settings?.staleDays ?? 7,
        leadRows,
        integrations,
        ai: { budget: ai?.budget ?? null, used: used?.n ?? 0 },
        targets,
        snapshots,
      };
    }),
  ]);

  const grid = capacityGrid({
    today: capacity.today,
    weeks: capacity.weeks,
    departmentIds: capacity.departments.map((d) => d.id),
    members: capacity.members,
    timeOff: capacity.timeOff,
    holidays: new Set(capacity.holidays),
    tasks: capacity.tasks,
    packages: capacity.packages,
    deals: capacity.deals,
    efforts: capacity.efforts,
  });
  const extra = new Map(rows.dealExtra.map((d) => [d.id, d]));

  return {
    today,
    timeZone: ctx.organization.defaultTimezone,
    period,
    comparison,
    config,
    clients: rows.clientRows,
    packages: rows.pkgRows.map((p) => ({ ...p, priceMinor: p.priceMinor ?? 0 })),
    usage: rows.usage,
    requestTypes: rows.types,
    requests: rows.reqRows.map((r) => ({
      ...r,
      submittedAt: iso(r.submittedAt),
      responseDueAt: iso(r.responseDueAt),
      firstResponseAt: iso(r.firstResponseAt),
      deliveredAt: iso(r.deliveredAt),
    })),
    deliverables: rows.delRows.map((d) => ({ ...d, approvedAt: iso(d.approvedAt) })),
    clientDecisions: rows.decisionRows.map((d) => ({
      clientId: d.clientId,
      sentAt: d.sentAt!.toISOString(),
      decidedAt: d.decidedAt!.toISOString(),
    })),
    tasks: rows.taskRows.map((t) => ({
      id: t.id,
      clientId: t.clientId,
      departmentId: t.departmentId,
      statusCategory: t.statusCategory,
      dueDate: t.dueDate,
      completedAt: iso(t.completedAt),
      startedAt: t.startDate ? `${t.startDate}T00:00:00Z` : t.createdAt.toISOString(),
      stepName: t.stepName ?? null,
      assigneeIds: rows.assignees.filter((a) => a.taskId === t.id).map((a) => a.userId),
    })),
    time: rows.timeRows,
    departments: rows.deptRows,
    people: capacity.people.map((p) => ({ id: p.id, name: p.name, hoursPerWeek: p.hoursPerWeek, departmentIds: p.departmentIds })),
    timeOff: capacity.timeOff,
    holidays: capacity.holidays,
    capacity: { weeks: capacity.weeks, rows: grid.map((r) => ({ departmentId: r.departmentId, cells: r.cells })) },
    metrics: rows.metricRows.map((m) => ({ ...m, spend: Number(m.spend), revenue: Number(m.revenue) })),
    campaigns: campaignList.map((c) => ({
      id: c.id,
      name: c.name,
      clientId: c.clientId,
      status: c.status,
      health: c.health,
      budgetMinor: c.budgetMinor,
      spentMinor: c.analysis.budget?.spent ?? c.analysis.totals.spend,
      elapsed: c.analysis.elapsed,
      pacingStatus: c.analysis.budget?.status ?? null,
    })),
    insights: rows.insightRows,
    ops: {
      clients: ops.clients.map((c) => ({ id: c.id, score: c.score, health: c.health, reasons: c.reasons })),
      slaOverdue: ops.totals.slaOverdue,
      unacknowledgedBreaches: ops.unacknowledgedBreaches,
      overdueTasks: ops.totals.overdueTasks,
      staleApprovals: ops.staleApprovals.length,
    },
    sales: sales
      ? {
          stages: sales.pipeline.stages.map((s) => ({ id: s.id, kind: s.kind, sortOrder: s.sortOrder, name: s.name })),
          deals: sales.deals.map((d) => ({
            ...d,
            lostReason: d.lostReason,
            title: extra.get(d.id)?.title ?? '',
            lastActivityAt: (extra.get(d.id)?.lastActivityAt ?? new Date()).toISOString(),
            clientId: extra.get(d.id)?.clientId ?? null,
          })),
          moves: sales.moves,
          leads: sales.leads,
          targets: sales.targets,
          people: sales.people,
          staleDays: rows.staleDays,
        }
      : { stages: [], deals: [], moves: [], leads: [], targets: new Map(), people: new Map(), staleDays: rows.staleDays },
    leads: rows.leadRows.map((l) => ({
      createdAt: l.createdAt.toISOString(),
      firstActivityAt: l.firstActivityAt ? new Date(l.firstActivityAt).toISOString() : null,
    })),
    integrations: rows.integrations.map((c) => ({ ...c, tokenExpiresAt: iso(c.tokenExpiresAt) })),
    ai: rows.ai,
    targets: rows.targets,
    snapshots: rows.snapshots.map((s) => ({ ...s, details: s.details ?? {} })),
    names: Object.fromEntries(rows.memberRows.map((m) => [m.id, m.name])),
  };
}
