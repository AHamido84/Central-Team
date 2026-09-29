import 'server-only';

import { and, asc, desc, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm';

import type { AgencyContext } from '@/lib/auth/context';
import type { Tx } from '@/lib/db/client';
import { withRls } from '@/lib/db/rls';
import {
  approvals,
  campaigns,
  clients,
  departmentMembers,
  departments,
  deliverables,
  organizationMembers,
  profiles,
  reports,
  requestStatusHistory,
  requests,
  slaBreaches,
  taskMembers,
  tasks,
  threads,
  timeEntries,
} from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import { can } from '@/lib/permissions/can';
import type { CampaignHealth } from '@/modules/campaigns/constants';
import {
  clientHealth,
  compareHealth,
  emptySignals,
  type ClientHealth,
  type ClientSignals,
  type HealthReason,
} from '@/modules/operations/health';
import type { RequestPriority, RequestStatus } from '@/modules/requests/constants';
import { compliance } from '@/modules/sla/constants';
import { issuesOf, openRequestsForSla, type SlaIssue } from '@/modules/sla/server/queries';
import { addDays, dayInZone, endOfWeek, taskReference } from '@/modules/tasks/constants';

const NONE = '00000000-0000-0000-0000-000000000000';
const ids = (list: string[]) => (list.length ? list : [NONE]);
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
const DAY = 86_400_000;

export type OpsScope = { kind: 'all' } | { kind: 'mine' } | { kind: 'manager'; userId: string };

type ClientRow = { id: string; name: LocalizedText; logoPath: string | null; status: string; accountManagerId: string | null };

/** Per-client counters behind the portfolio table, the tiles and client health. */
export type ClientOps = {
  id: string;
  name: LocalizedText;
  logoPath: string | null;
  accountManagerId: string | null;
  accountManagerName: string | null;
  openRequests: number;
  awaitingTriage: number;
  openTasks: number;
  clientReview: number;
  internalReview: number;
  activeCampaigns: number;
  worstCampaign: CampaignHealth | null;
  lastClientActivity: string | null;
  signals: ClientSignals;
  health: ClientHealth;
  score: number;
  reasons: HealthReason[];
};

type Signals = {
  clients: ClientOps[];
  issues: SlaIssue[];
  overdueTasks: { id: string; number: number; title: string; clientId: string; dueDate: string; assigneeNames: string[] }[];
  offTrackCampaigns: { id: string; name: string; clientId: string; health: CampaignHealth }[];
  staleApprovals: { id: string; title: string; clientId: string; since: string }[];
};

/**
 * Everything the ops views count, for the given clients, in a handful of grouped queries (RLS-scoped: tasks, time
 * and deliverables only for the clients the viewer can access; permission-gated parts come back empty).
 */
async function collectSignals(tx: Tx, ctx: AgencyContext, clientRows: ClientRow[]): Promise<Signals> {
  const orgId = ctx.organization.id;
  const clientIds = clientRows.map((c) => c.id);
  const today = dayInZone(new Date(), ctx.organization.defaultTimezone);
  const now = new Date();
  const reminderDays = ctx.organization.approvalReminderDays ?? 2;
  const canRequests = can(ctx.permissions, 'requests:read');
  const canTasks = can(ctx.permissions, 'tasks:read');
  const canCampaigns = can(ctx.permissions, 'campaigns:read');

  const open = canRequests ? await openRequestsForSla(tx, orgId, clientIds) : [];
  const issues = issuesOf(open, now);

  const taskCounts = canTasks
    ? await tx
        .select({
          clientId: tasks.clientId,
          open: sql<number>`count(*)::int`,
          overdue: sql<number>`count(*) filter (where ${tasks.dueDate} < ${today}::date)::int`,
        })
        .from(tasks)
        .where(and(inArray(tasks.clientId, ids(clientIds)), ne(tasks.statusCategory, 'done')))
        .groupBy(tasks.clientId)
    : [];
  const overdueTaskRows = canTasks
    ? await tx
        .select({
          id: tasks.id,
          number: tasks.number,
          title: tasks.title,
          clientId: tasks.clientId,
          dueDate: tasks.dueDate,
          assigneeNames: sql<
            string[]
          >`coalesce((select array_agg(p.full_name order by p.full_name) from public.task_members m join public.profiles p on p.id = m.user_id where m.task_id = tasks.id and m.role = 'assignee'), '{}')`,
        })
        .from(tasks)
        .where(and(inArray(tasks.clientId, ids(clientIds)), ne(tasks.statusCategory, 'done'), sql`${tasks.dueDate} < ${today}::date`))
        .orderBy(asc(tasks.dueDate))
        .limit(8)
    : [];

  const deliverableRows = canTasks
    ? await tx
        .select({
          id: deliverables.id,
          title: deliverables.title,
          clientId: deliverables.clientId,
          status: deliverables.status,
          sentAt: sql<
            string | null
          >`(select v.sent_to_client_at from public.deliverable_versions v where v.id = deliverables.current_version_id)`,
        })
        .from(deliverables)
        .where(and(inArray(deliverables.clientId, ids(clientIds)), inArray(deliverables.status, ['client_review', 'internal_review'])))
    : [];
  const staleCutoff = now.getTime() - reminderDays * DAY;
  const staleApprovals = deliverableRows
    .filter((d) => d.status === 'client_review' && d.sentAt && new Date(d.sentAt).getTime() < staleCutoff)
    .map((d) => ({ id: d.id, title: d.title, clientId: d.clientId, since: new Date(d.sentAt!).toISOString() }))
    .sort((a, b) => a.since.localeCompare(b.since));

  const campaignRows = canCampaigns
    ? await tx
        .select({ id: campaigns.id, name: campaigns.name, clientId: campaigns.clientId, health: campaigns.health })
        .from(campaigns)
        .where(and(inArray(campaigns.clientId, ids(clientIds)), inArray(campaigns.status, ['active', 'paused'])))
    : [];

  // Last message on each client-side thread: from the client = waiting on us.
  const threadRows = await tx
    .select({
      clientId: threads.clientId,
      lastSide: sql<
        string | null
      >`(select c.author_side from public.comments c where c.thread_id = threads.id and c.deleted_at is null order by c.created_at desc limit 1)`,
      lastClientAt: sql<
        string | null
      >`(select max(c.created_at) from public.comments c where c.thread_id = threads.id and c.author_side = 'client' and c.deleted_at is null)`,
    })
    .from(threads)
    .where(and(inArray(threads.clientId, ids(clientIds)), eq(threads.visibility, 'client')));

  const breachCounts = canRequests
    ? await tx
        .select({ clientId: slaBreaches.clientId, n: sql<number>`count(*)::int` })
        .from(slaBreaches)
        .where(
          and(
            inArray(slaBreaches.clientId, ids(clientIds)),
            eq(slaBreaches.level, 'breached'),
            gte(slaBreaches.detectedAt, new Date(now.getTime() - 30 * DAY)),
          ),
        )
        .groupBy(slaBreaches.clientId)
    : [];

  const amIds = [...new Set(clientRows.map((c) => c.accountManagerId).filter(Boolean) as string[])];
  const managers = amIds.length
    ? await tx.select({ id: profiles.id, name: profiles.fullName }).from(profiles).where(inArray(profiles.id, amIds))
    : [];

  const worst = (list: CampaignHealth[]): CampaignHealth | null =>
    list.includes('off_track')
      ? 'off_track'
      : list.includes('at_risk')
        ? 'at_risk'
        : list.includes('on_track')
          ? 'on_track'
          : list.length
            ? 'no_data'
            : null;

  const result = clientRows.map((c): ClientOps => {
    const reqs = open.filter((r) => r.clientId === c.id);
    const cIssues = issues.filter((i) => i.clientId === c.id);
    const taskRow = taskCounts.find((x) => x.clientId === c.id);
    const cDeliverables = deliverableRows.filter((d) => d.clientId === c.id);
    const cCampaigns = campaignRows.filter((x) => x.clientId === c.id);
    const cThreads = threadRows.filter((x) => x.clientId === c.id);
    const lastClient = cThreads.map((x) => x.lastClientAt).filter(Boolean) as string[];
    const signals: ClientSignals = {
      ...emptySignals(),
      slaOverdue: new Set(cIssues.filter((i) => i.state === 'overdue').map((i) => i.requestId)).size,
      slaAtRisk: new Set(cIssues.filter((i) => i.state === 'at_risk').map((i) => i.requestId)).size,
      overdueTasks: taskRow?.overdue ?? 0,
      staleApprovals: staleApprovals.filter((d) => d.clientId === c.id).length,
      campaignsOffTrack: cCampaigns.filter((x) => x.health === 'off_track').length,
      campaignsAtRisk: cCampaigns.filter((x) => x.health === 'at_risk').length,
      unansweredMessages: cThreads.filter((x) => x.lastSide === 'client').length,
      recentBreaches: breachCounts.find((x) => x.clientId === c.id)?.n ?? 0,
    };
    const h = clientHealth(signals);
    return {
      id: c.id,
      name: c.name,
      logoPath: c.logoPath,
      accountManagerId: c.accountManagerId,
      accountManagerName: managers.find((m) => m.id === c.accountManagerId)?.name ?? null,
      openRequests: reqs.filter((r) => !r.deliveredAt).length,
      awaitingTriage: reqs.filter((r) => r.status === 'submitted').length,
      openTasks: taskRow?.open ?? 0,
      clientReview: cDeliverables.filter((d) => d.status === 'client_review').length,
      internalReview: cDeliverables.filter((d) => d.status === 'internal_review').length,
      activeCampaigns: cCampaigns.length,
      worstCampaign: worst(cCampaigns.map((x) => x.health as CampaignHealth)),
      lastClientActivity: lastClient.length ? new Date(lastClient.sort().at(-1)!).toISOString() : null,
      signals,
      ...h,
    };
  });

  return {
    clients: result.sort((a, b) => compareHealth(a, b)),
    issues,
    overdueTasks: overdueTaskRows.map((x) => ({ ...x, dueDate: x.dueDate! })),
    offTrackCampaigns: campaignRows
      .filter((x) => x.health === 'off_track' || x.health === 'at_risk')
      .map((x) => ({ ...x, health: x.health as CampaignHealth }))
      .sort((a, b) => (a.health === b.health ? 0 : a.health === 'off_track' ? -1 : 1)),
    staleApprovals,
  };
}

async function accessibleClients(tx: Tx, orgId: string): Promise<ClientRow[]> {
  // RLS limits clients to the ones this user can access.
  return tx
    .select({
      id: clients.id,
      name: clients.name,
      logoPath: clients.logoPath,
      status: clients.status,
      accountManagerId: clients.accountManagerId,
    })
    .from(clients)
    .where(and(eq(clients.organizationId, orgId), ne(clients.status, 'archived')))
    .orderBy(asc(sql`${clients.name}->>'en'`));
}

export type OpsOverview = Signals & {
  scope: OpsScope;
  managers: { id: string; name: string }[];
  totals: {
    openRequests: number;
    awaitingTriage: number;
    slaOverdue: number;
    slaAtRisk: number;
    overdueTasks: number;
    clientReview: number;
    internalReview: number;
    campaignsAtRisk: number;
    campaignsOffTrack: number;
    unanswered: number;
  };
  departments: { id: string; name: LocalizedText; color: string; open: number; overdue: number; members: number }[];
  compliance: ReturnType<typeof compliance>;
  unacknowledgedBreaches: number;
};

export async function getOpsOverview(ctx: AgencyContext, scope: OpsScope): Promise<OpsOverview> {
  const orgId = ctx.organization.id;
  const today = dayInZone(new Date(), ctx.organization.defaultTimezone);
  return withRls(async (tx) => {
    const all = await accessibleClients(tx, orgId);
    const managerIds = [...new Set(all.map((c) => c.accountManagerId).filter(Boolean) as string[])];
    const managers = managerIds.length
      ? await tx
          .select({ id: profiles.id, name: profiles.fullName })
          .from(profiles)
          .where(inArray(profiles.id, managerIds))
          .orderBy(asc(profiles.fullName))
      : [];
    const scoped =
      scope.kind === 'all' ? all : all.filter((c) => c.accountManagerId === (scope.kind === 'mine' ? ctx.session.userId : scope.userId));
    const signals = await collectSignals(tx, ctx, scoped);
    const clientIds = scoped.map((c) => c.id);

    const deptRows = await tx
      .select({ id: departments.id, name: departments.name, color: departments.color })
      .from(departments)
      .where(and(eq(departments.organizationId, orgId), eq(departments.isArchived, false)))
      .orderBy(asc(departments.sortOrder));
    const deptTasks = can(ctx.permissions, 'tasks:read')
      ? await tx
          .select({
            departmentId: tasks.departmentId,
            open: sql<number>`count(*)::int`,
            overdue: sql<number>`count(*) filter (where ${tasks.dueDate} < ${today}::date)::int`,
          })
          .from(tasks)
          .where(and(inArray(tasks.clientId, ids(clientIds)), ne(tasks.statusCategory, 'done'), isNotNull(tasks.departmentId)))
          .groupBy(tasks.departmentId)
      : [];
    const deptMembers = await tx
      .select({ departmentId: departmentMembers.departmentId, n: sql<number>`count(*)::int` })
      .from(departmentMembers)
      .groupBy(departmentMembers.departmentId);

    const since = new Date(Date.now() - 30 * DAY);
    const windowRows = can(ctx.permissions, 'requests:read')
      ? await tx
          .select({
            submittedAt: requests.submittedAt,
            responseDueAt: requests.responseDueAt,
            firstResponseAt: requests.firstResponseAt,
            dueDate: requests.dueDate,
            deliveredAt: requests.deliveredAt,
          })
          .from(requests)
          .where(and(inArray(requests.clientId, ids(clientIds)), ne(requests.status, 'draft'), gte(requests.submittedAt, since)))
      : [];
    const [unack] = can(ctx.permissions, 'requests:read')
      ? await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(slaBreaches)
          .where(
            and(
              inArray(slaBreaches.clientId, ids(clientIds)),
              eq(slaBreaches.level, 'breached'),
              sql`${slaBreaches.acknowledgedAt} is null and ${slaBreaches.resolvedAt} is null`,
            ),
          )
      : [{ n: 0 }];

    const sum = (f: (c: ClientOps) => number) => signals.clients.reduce((n, c) => n + f(c), 0);
    return {
      ...signals,
      scope,
      managers,
      totals: {
        openRequests: sum((c) => c.openRequests),
        awaitingTriage: sum((c) => c.awaitingTriage),
        slaOverdue: sum((c) => c.signals.slaOverdue),
        slaAtRisk: sum((c) => c.signals.slaAtRisk),
        overdueTasks: sum((c) => c.signals.overdueTasks),
        clientReview: sum((c) => c.clientReview),
        internalReview: sum((c) => c.internalReview),
        campaignsAtRisk: sum((c) => c.signals.campaignsAtRisk),
        campaignsOffTrack: sum((c) => c.signals.campaignsOffTrack),
        unanswered: sum((c) => c.signals.unansweredMessages),
      },
      departments: deptRows.map((d) => ({
        ...d,
        open: deptTasks.find((x) => x.departmentId === d.id)?.open ?? 0,
        overdue: deptTasks.find((x) => x.departmentId === d.id)?.overdue ?? 0,
        members: deptMembers.find((x) => x.departmentId === d.id)?.n ?? 0,
      })),
      compliance: compliance(
        windowRows.map((r) => ({
          submittedAt: iso(r.submittedAt),
          responseDueAt: iso(r.responseDueAt),
          firstResponseAt: iso(r.firstResponseAt),
          dueDate: r.dueDate,
          deliveredAt: iso(r.deliveredAt),
        })),
      ),
      unacknowledgedBreaches: unack?.n ?? 0,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Client 360                                                                 */
/* -------------------------------------------------------------------------- */

export type DeadlineItem =
  | { kind: 'request'; id: string; label: string; title: string; date: string; status: RequestStatus; priority: RequestPriority }
  | { kind: 'task'; id: string; label: string; title: string; date: string; assigneeNames: string[] };

export type ActivityItem = {
  id: string;
  kind: 'request_status' | 'approval' | 'report' | 'message';
  at: string;
  actorName: string | null;
  actorSide: 'agency' | 'client' | 'system';
  title: string;
  /** request status / approval decision / message side. */
  detail: string | null;
  href: string;
};

export type Client360 = {
  ops: ClientOps;
  issues: SlaIssue[];
  compliance: ReturnType<typeof compliance>;
  deadlines: DeadlineItem[];
  activity: ActivityItem[];
  overdueTasks: Signals['overdueTasks'];
  staleApprovals: Signals['staleApprovals'];
  offTrackCampaigns: Signals['offTrackCampaigns'];
};

export async function getClient360(ctx: AgencyContext, clientId: string): Promise<Client360 | null> {
  const orgId = ctx.organization.id;
  const tz = ctx.organization.defaultTimezone;
  const today = dayInZone(new Date(), tz);
  const horizon = addDays(today, 14);
  const canRequests = can(ctx.permissions, 'requests:read');
  const canTasks = can(ctx.permissions, 'tasks:read');
  const canCampaigns = can(ctx.permissions, 'campaigns:read');
  return withRls(async (tx) => {
    const rows = (await accessibleClients(tx, orgId)).filter((c) => c.id === clientId);
    if (!rows.length) return null;
    const signals = await collectSignals(tx, ctx, rows);

    const since = new Date(Date.now() - 90 * DAY);
    const windowRows = canRequests
      ? await tx
          .select({
            submittedAt: requests.submittedAt,
            responseDueAt: requests.responseDueAt,
            firstResponseAt: requests.firstResponseAt,
            dueDate: requests.dueDate,
            deliveredAt: requests.deliveredAt,
          })
          .from(requests)
          .where(and(eq(requests.clientId, clientId), ne(requests.status, 'draft'), gte(requests.submittedAt, since)))
      : [];

    const dueRequests = canRequests
      ? await tx
          .select({
            id: requests.id,
            reference: requests.reference,
            title: requests.title,
            dueDate: requests.dueDate,
            status: requests.status,
            priority: requests.priority,
          })
          .from(requests)
          .where(
            and(
              eq(requests.clientId, clientId),
              inArray(requests.status, ['submitted', 'under_review', 'accepted', 'in_progress', 'in_review']),
              sql`${requests.dueDate} between ${today}::date and ${horizon}::date`,
            ),
          )
      : [];
    const dueTasks = canTasks
      ? await tx
          .select({
            id: tasks.id,
            number: tasks.number,
            title: tasks.title,
            dueDate: tasks.dueDate,
            assigneeNames: sql<
              string[]
            >`coalesce((select array_agg(p.full_name order by p.full_name) from public.task_members m join public.profiles p on p.id = m.user_id where m.task_id = tasks.id and m.role = 'assignee'), '{}')`,
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.clientId, clientId),
              ne(tasks.statusCategory, 'done'),
              sql`${tasks.dueDate} between ${today}::date and ${horizon}::date`,
            ),
          )
          .orderBy(asc(tasks.dueDate))
          .limit(20)
      : [];
    const deadlines: DeadlineItem[] = [
      ...dueRequests.map((r): DeadlineItem => ({
        kind: 'request',
        id: r.id,
        label: r.reference ?? '',
        title: r.title,
        date: r.dueDate!,
        status: r.status as RequestStatus,
        priority: r.priority as RequestPriority,
      })),
      ...dueTasks.map((x): DeadlineItem => ({
        kind: 'task',
        id: x.id,
        label: taskReference(x.number),
        title: x.title,
        date: x.dueDate!,
        assigneeNames: x.assigneeNames,
      })),
    ]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 12);

    // Unified timeline: request status moves, review decisions, published reports, client-thread messages.
    const history = canRequests
      ? await tx
          .select({
            id: requestStatusHistory.id,
            at: requestStatusHistory.createdAt,
            to: requestStatusHistory.toStatus,
            side: requestStatusHistory.actorSide,
            actorName: profiles.fullName,
            requestId: requestStatusHistory.requestId,
            title: requests.title,
            reference: requests.reference,
          })
          .from(requestStatusHistory)
          .innerJoin(requests, eq(requests.id, requestStatusHistory.requestId))
          .leftJoin(profiles, eq(profiles.id, requestStatusHistory.actorId))
          .where(eq(requestStatusHistory.clientId, clientId))
          .orderBy(desc(requestStatusHistory.createdAt))
          .limit(12)
      : [];
    const decisions = canTasks
      ? await tx
          .select({
            id: approvals.id,
            at: approvals.createdAt,
            stage: approvals.stage,
            decision: approvals.decision,
            actorName: profiles.fullName,
            deliverableId: approvals.deliverableId,
            title: deliverables.title,
          })
          .from(approvals)
          .innerJoin(deliverables, eq(deliverables.id, approvals.deliverableId))
          .leftJoin(profiles, eq(profiles.id, approvals.reviewerId))
          .where(eq(approvals.clientId, clientId))
          .orderBy(desc(approvals.createdAt))
          .limit(12)
      : [];
    const published = canCampaigns
      ? await tx
          .select({ id: reports.id, at: reports.publishedAt, title: reports.title })
          .from(reports)
          .where(and(eq(reports.clientId, clientId), eq(reports.status, 'published'), isNotNull(reports.publishedAt)))
          .orderBy(desc(reports.publishedAt))
          .limit(6)
      : [];
    const messages = await tx.execute<{
      id: string;
      at: string;
      side: 'agency' | 'client';
      actor: string | null;
      thread_id: string;
      title: string;
      subject_type: string;
      subject_id: string | null;
    }>(sql`
      select c.id, c.created_at as at, c.author_side as side, p.full_name as actor, t.id as thread_id, t.title, t.subject_type, t.subject_id
      from public.comments c
      join public.threads t on t.id = c.thread_id
      left join public.profiles p on p.id = c.author_id
      where t.client_id = ${clientId} and c.deleted_at is null and c.visibility = 'client'
      order by c.created_at desc limit 12`);

    const activity: ActivityItem[] = [
      ...history.map((h): ActivityItem => ({
        id: `h-${h.id}`,
        kind: 'request_status',
        at: h.at.toISOString(),
        actorName: h.actorName,
        actorSide: h.side as ActivityItem['actorSide'],
        title: h.reference ? `${h.reference} · ${h.title}` : h.title,
        detail: h.to,
        href: `/requests/${h.requestId}`,
      })),
      ...decisions.map((d): ActivityItem => ({
        id: `a-${d.id}`,
        kind: 'approval',
        at: d.at.toISOString(),
        actorName: d.actorName,
        actorSide: d.stage === 'client' ? 'client' : 'agency',
        title: d.title,
        detail: d.decision,
        href: `/deliverables/${d.deliverableId}`,
      })),
      ...published.map((r): ActivityItem => ({
        id: `r-${r.id}`,
        kind: 'report',
        at: r.at!.toISOString(),
        actorName: null,
        actorSide: 'agency',
        title: r.title,
        detail: null,
        href: `/reports/${r.id}`,
      })),
      ...[...messages].map((m): ActivityItem => ({
        id: `m-${m.id}`,
        kind: 'message',
        at: new Date(m.at).toISOString(),
        actorName: m.actor,
        actorSide: m.side,
        title: m.title,
        detail: m.side,
        href:
          m.subject_type === 'request' && m.subject_id
            ? `/requests/${m.subject_id}`
            : `/clients/${clientId}?tab=messages&thread=${m.thread_id}`,
      })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 15);

    return {
      ops: signals.clients[0]!,
      issues: signals.issues,
      compliance: compliance(
        windowRows.map((r) => ({
          submittedAt: iso(r.submittedAt),
          responseDueAt: iso(r.responseDueAt),
          firstResponseAt: iso(r.firstResponseAt),
          dueDate: r.dueDate,
          deliveredAt: iso(r.deliveredAt),
        })),
      ),
      deadlines,
      activity,
      overdueTasks: signals.overdueTasks,
      staleApprovals: signals.staleApprovals,
      offTrackCampaigns: signals.offTrackCampaigns,
    };
  });
}

/** Health for the clients list (one pass over every accessible client). */
export async function getClientsHealth(
  ctx: AgencyContext,
): Promise<Record<string, { health: ClientHealth; score: number; reasons: HealthReason[] }>> {
  return withRls(async (tx) => {
    const rows = await accessibleClients(tx, ctx.organization.id);
    const signals = await collectSignals(tx, ctx, rows);
    return Object.fromEntries(signals.clients.map((c) => [c.id, { health: c.health, score: c.score, reasons: c.reasons }]));
  });
}

/* -------------------------------------------------------------------------- */
/* Team                                                                       */
/* -------------------------------------------------------------------------- */

export type TeamMember = {
  id: string;
  name: string;
  avatarPath: string | null;
  jobTitle: string | null;
  departments: { id: string; name: LocalizedText; isLead: boolean }[];
  openTasks: number;
  overdue: number;
  dueThisWeek: number;
  reviews: number;
  openRequests: number;
  clients: number;
  /** Null when the viewer may only see their own time. */
  minutes7d: number | null;
};

export type TeamOverview = {
  members: TeamMember[];
  departments: { id: string; name: LocalizedText }[];
  canSeeTime: boolean;
};

async function memberStats(tx: Tx, ctx: AgencyContext, userIds: string[]) {
  const today = dayInZone(new Date(), ctx.organization.defaultTimezone);
  const weekEnd = endOfWeek(today);
  const canTasks = can(ctx.permissions, 'tasks:read');
  const assigned = canTasks
    ? await tx
        .select({
          userId: taskMembers.userId,
          open: sql<number>`count(*)::int`,
          overdue: sql<number>`count(*) filter (where ${tasks.dueDate} < ${today}::date)::int`,
          week: sql<number>`count(*) filter (where ${tasks.dueDate} between ${today}::date and ${weekEnd}::date)::int`,
        })
        .from(taskMembers)
        .innerJoin(tasks, eq(tasks.id, taskMembers.taskId))
        .where(and(inArray(taskMembers.userId, ids(userIds)), eq(taskMembers.role, 'assignee'), ne(tasks.statusCategory, 'done')))
        .groupBy(taskMembers.userId)
    : [];
  const reviews = canTasks
    ? await tx
        .select({ userId: tasks.reviewerId, n: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(inArray(tasks.reviewerId, ids(userIds)), eq(tasks.statusCategory, 'review')))
        .groupBy(tasks.reviewerId)
    : [];
  const reqs = can(ctx.permissions, 'requests:read')
    ? await tx
        .select({ userId: requests.assigneeId, n: sql<number>`count(*)::int` })
        .from(requests)
        .where(
          and(
            inArray(requests.assigneeId, ids(userIds)),
            inArray(requests.status, ['submitted', 'under_review', 'needs_info', 'accepted', 'in_progress', 'in_review']),
          ),
        )
        .groupBy(requests.assigneeId)
    : [];
  const managed = await tx
    .select({ userId: clients.accountManagerId, n: sql<number>`count(*)::int` })
    .from(clients)
    .where(and(inArray(clients.accountManagerId, ids(userIds)), ne(clients.status, 'archived')))
    .groupBy(clients.accountManagerId);
  const canSeeTime = can(ctx.permissions, 'time:read_all');
  // RLS already hides other people's time without `time:read_all`; the flag keeps the UI honest about it.
  const time = await tx
    .select({ userId: timeEntries.userId, minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int` })
    .from(timeEntries)
    .where(and(inArray(timeEntries.userId, ids(userIds)), gte(timeEntries.startedAt, new Date(Date.now() - 7 * DAY))))
    .groupBy(timeEntries.userId);
  return (userId: string) => ({
    openTasks: assigned.find((x) => x.userId === userId)?.open ?? 0,
    overdue: assigned.find((x) => x.userId === userId)?.overdue ?? 0,
    dueThisWeek: assigned.find((x) => x.userId === userId)?.week ?? 0,
    reviews: reviews.find((x) => x.userId === userId)?.n ?? 0,
    openRequests: reqs.find((x) => x.userId === userId)?.n ?? 0,
    clients: managed.find((x) => x.userId === userId)?.n ?? 0,
    minutes7d: canSeeTime || userId === ctx.session.userId ? (time.find((x) => x.userId === userId)?.minutes ?? 0) : null,
  });
}

async function agencyPeople(tx: Tx, orgId: string, userId?: string) {
  return tx
    .select({ id: profiles.id, name: profiles.fullName, avatarPath: profiles.avatarPath, jobTitle: organizationMembers.jobTitle })
    .from(organizationMembers)
    .innerJoin(profiles, eq(profiles.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, orgId),
        eq(organizationMembers.userType, 'agency'),
        eq(organizationMembers.status, 'active'),
        userId ? eq(profiles.id, userId) : undefined,
      ),
    )
    .orderBy(asc(profiles.fullName));
}

export async function getTeamOverview(ctx: AgencyContext): Promise<TeamOverview> {
  const orgId = ctx.organization.id;
  return withRls(async (tx) => {
    const people = await agencyPeople(tx, orgId);
    const deptRows = await tx
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.organizationId, orgId), eq(departments.isArchived, false)))
      .orderBy(asc(departments.sortOrder));
    const memberships = await tx
      .select({ userId: departmentMembers.userId, departmentId: departmentMembers.departmentId, isLead: departmentMembers.isLead })
      .from(departmentMembers)
      .where(inArray(departmentMembers.departmentId, ids(deptRows.map((d) => d.id))));
    const stats = await memberStats(
      tx,
      ctx,
      people.map((p) => p.id),
    );
    return {
      members: people.map((p) => ({
        ...p,
        departments: memberships
          .filter((m) => m.userId === p.id)
          .map((m) => ({ id: m.departmentId, name: deptRows.find((d) => d.id === m.departmentId)!.name, isLead: m.isLead })),
        ...stats(p.id),
      })),
      departments: deptRows,
      canSeeTime: can(ctx.permissions, 'time:read_all'),
    };
  });
}

export type MemberTask = {
  id: string;
  number: number;
  title: string;
  clientId: string;
  clientName: LocalizedText;
  dueDate: string | null;
  statusCategory: string;
  priority: string;
};

export type TeamMemberDetail = TeamMember & {
  tasks: MemberTask[];
  requests: {
    id: string;
    reference: string | null;
    title: string;
    status: RequestStatus;
    clientName: LocalizedText;
    dueDate: string | null;
  }[];
  managedClients: { id: string; name: LocalizedText; logoPath: string | null }[];
  /** Minutes per day for the last 14 days (oldest first), when visible. */
  days: { day: string; minutes: number }[] | null;
  today: string;
};

export async function getTeamMember(ctx: AgencyContext, userId: string): Promise<TeamMemberDetail | null> {
  const orgId = ctx.organization.id;
  const tz = ctx.organization.defaultTimezone;
  const today = dayInZone(new Date(), tz);
  return withRls(async (tx) => {
    const [person] = await agencyPeople(tx, orgId, userId);
    if (!person) return null;
    const deps = await tx
      .select({ id: departments.id, name: departments.name, isLead: departmentMembers.isLead })
      .from(departmentMembers)
      .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
      .where(and(eq(departmentMembers.userId, userId), eq(departments.organizationId, orgId)));
    const stats = (await memberStats(tx, ctx, [userId]))(userId);
    const taskRows = can(ctx.permissions, 'tasks:read')
      ? await tx
          .select({
            id: tasks.id,
            number: tasks.number,
            title: tasks.title,
            clientId: tasks.clientId,
            clientName: clients.name,
            dueDate: tasks.dueDate,
            statusCategory: tasks.statusCategory,
            priority: tasks.priority,
          })
          .from(taskMembers)
          .innerJoin(tasks, eq(tasks.id, taskMembers.taskId))
          .innerJoin(clients, eq(clients.id, tasks.clientId))
          .where(and(eq(taskMembers.userId, userId), eq(taskMembers.role, 'assignee'), ne(tasks.statusCategory, 'done')))
          .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.number))
          .limit(100)
      : [];
    const reqRows = can(ctx.permissions, 'requests:read')
      ? await tx
          .select({
            id: requests.id,
            reference: requests.reference,
            title: requests.title,
            status: requests.status,
            clientName: clients.name,
            dueDate: requests.dueDate,
          })
          .from(requests)
          .innerJoin(clients, eq(clients.id, requests.clientId))
          .where(
            and(
              eq(requests.assigneeId, userId),
              inArray(requests.status, ['submitted', 'under_review', 'needs_info', 'accepted', 'in_progress', 'in_review']),
            ),
          )
          .orderBy(sql`${requests.dueDate} asc nulls last`)
          .limit(30)
      : [];
    const managed = await tx
      .select({ id: clients.id, name: clients.name, logoPath: clients.logoPath })
      .from(clients)
      .where(and(eq(clients.accountManagerId, userId), ne(clients.status, 'archived')))
      .orderBy(asc(sql`${clients.name}->>'en'`));
    let days: TeamMemberDetail['days'] = null;
    if (stats.minutes7d !== null) {
      const from = addDays(today, -13);
      const perDay = await tx.execute<{ day: string; minutes: number }>(sql`
        select to_char((e.started_at at time zone ${tz})::date, 'YYYY-MM-DD') as day, sum(e.minutes)::int as minutes
        from public.time_entries e
        where e.user_id = ${userId} and (e.started_at at time zone ${tz})::date >= ${from}::date
        group by 1`);
      days = Array.from({ length: 14 }, (_, i) => {
        const day = addDays(from, i);
        return { day, minutes: [...perDay].find((r) => r.day === day)?.minutes ?? 0 };
      });
    }
    return {
      ...person,
      departments: deps,
      ...stats,
      tasks: taskRows,
      requests: reqRows.map((r) => ({ ...r, status: r.status as RequestStatus })),
      managedClients: managed,
      days,
      today,
    };
  });
}
