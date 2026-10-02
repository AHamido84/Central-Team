import 'server-only';

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';

import type { AgencyContext } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import { clients, holidays, organizations, profiles, requestTypes, requests, slaBreaches, slaPolicies } from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import { responseState, slaState, type RequestPriority, type RequestStatus, type SlaState } from '@/modules/requests/constants';
import { compliance, type BreachKind, type BreachLevel, type BreachView, type ComplianceRow } from '@/modules/sla/constants';

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export type SlaPolicyItem = {
  id: string;
  name: LocalizedText;
  clientId: string | null;
  clientName: LocalizedText | null;
  requestTypeId: string | null;
  requestTypeName: LocalizedText | null;
  priority: RequestPriority | null;
  responseHours: number;
  resolutionDays: number | null;
  pauseOnClient: boolean;
  atRiskPercent: number;
  escalateTo: string | null;
  escalateName: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  /** Requests submitted under this policy (all time). */
  usage: number;
};

export type HolidayItem = { id: string; date: string; name: LocalizedText };

export type SlaAdminData = {
  policies: SlaPolicyItem[];
  holidays: HolidayItem[];
  businessHours: { start: number; end: number; timeZone: string };
  options: {
    clients: { id: string; name: LocalizedText }[];
    requestTypes: { id: string; name: LocalizedText; slaDays: number | null }[];
    people: { id: string; name: string }[];
  };
};

export async function getSlaAdmin(ctx: AgencyContext): Promise<SlaAdminData> {
  const orgId = ctx.organization.id;
  return withRls(async (tx) => {
    const policyRows = await tx
      .select({
        p: slaPolicies,
        clientName: clients.name,
        requestTypeName: requestTypes.name,
        escalateName: profiles.fullName,
        usage: sql<number>`(select count(*)::int from public.requests r where r.sla_policy_id = sla_policies.id)`,
      })
      .from(slaPolicies)
      .leftJoin(clients, eq(clients.id, slaPolicies.clientId))
      .leftJoin(requestTypes, eq(requestTypes.id, slaPolicies.requestTypeId))
      .leftJoin(profiles, eq(profiles.id, slaPolicies.escalateTo))
      .where(eq(slaPolicies.organizationId, orgId))
      .orderBy(asc(slaPolicies.sortOrder), asc(slaPolicies.createdAt));
    const holidayRows = await tx
      .select({ id: holidays.id, date: holidays.date, name: holidays.name })
      .from(holidays)
      .where(and(eq(holidays.organizationId, orgId), gte(holidays.date, sql`(current_date - 30)`)))
      .orderBy(asc(holidays.date));
    const [org] = await tx
      .select({ start: organizations.businessHoursStart, end: organizations.businessHoursEnd, tz: organizations.defaultTimezone })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    const clientRows = await tx
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(eq(clients.organizationId, orgId), sql`${clients.status} <> 'archived'`))
      .orderBy(asc(sql`${clients.name}->>'en'`));
    const typeRows = await tx
      .select({ id: requestTypes.id, name: requestTypes.name, slaDays: requestTypes.slaDays })
      .from(requestTypes)
      .where(eq(requestTypes.organizationId, orgId))
      .orderBy(asc(requestTypes.sortOrder));
    const people = await tx.execute<{ id: string; name: string }>(sql`
      select p.id, p.full_name as name from public.organization_members m join public.profiles p on p.id = m.user_id
      where m.organization_id = ${orgId} and m.user_type = 'agency' and m.status = 'active' order by p.full_name`);
    return {
      policies: policyRows.map((x) => ({
        id: x.p.id,
        name: x.p.name,
        clientId: x.p.clientId,
        clientName: x.clientName,
        requestTypeId: x.p.requestTypeId,
        requestTypeName: x.requestTypeName,
        priority: x.p.priority as RequestPriority | null,
        responseHours: x.p.responseHours,
        resolutionDays: x.p.resolutionDays,
        pauseOnClient: x.p.pauseOnClient,
        atRiskPercent: x.p.atRiskPercent,
        escalateTo: x.p.escalateTo,
        escalateName: x.escalateName,
        isActive: x.p.isActive,
        sortOrder: x.p.sortOrder,
        createdAt: x.p.createdAt.toISOString(),
        usage: x.usage,
      })),
      holidays: holidayRows,
      businessHours: { start: org?.start ?? 540, end: org?.end ?? 1020, timeZone: org?.tz ?? 'Asia/Riyadh' },
      options: { clients: clientRows, requestTypes: typeRows, people: [...people] },
    };
  });
}

export type SlaIssue = {
  requestId: string;
  reference: string | null;
  title: string;
  status: RequestStatus;
  priority: RequestPriority;
  clientId: string;
  clientName: LocalizedText;
  assigneeName: string | null;
  kind: BreachKind;
  state: Extract<SlaState, 'at_risk' | 'overdue'>;
  /** Response: the reply deadline; resolution: the due date (end of day). */
  dueAt: string;
};

export type BreachItem = {
  id: string;
  requestId: string;
  reference: string | null;
  title: string;
  clientId: string;
  clientName: LocalizedText;
  kind: BreachKind;
  level: BreachLevel;
  dueAt: string;
  detectedAt: string;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  note: string | null;
};

export type ClientCompliance = {
  clientId: string;
  clientName: LocalizedText;
  response: ReturnType<typeof compliance>['response'];
  resolution: ReturnType<typeof compliance>['resolution'];
  breaches: number;
};

type OpenRequestRow = {
  id: string;
  reference: string | null;
  title: string;
  status: string;
  priority: string;
  clientId: string;
  clientName: LocalizedText;
  assigneeName: string | null;
  submittedAt: Date | null;
  dueDate: string | null;
  deliveredAt: Date | null;
  firstResponseAt: Date | null;
  responseDueAt: Date | null;
  slaPausedAt: Date | null;
  atRiskPercent: number | null;
};

/** Live SLA issues (at risk / overdue) of the open requests the caller can see — independent of the sweep. */
export function issuesOf(rows: readonly OpenRequestRow[], now: Date = new Date()): SlaIssue[] {
  const out: SlaIssue[] = [];
  for (const r of rows) {
    const base = {
      requestId: r.id,
      reference: r.reference,
      title: r.title,
      status: r.status as RequestStatus,
      priority: r.priority as RequestPriority,
      clientId: r.clientId,
      clientName: r.clientName,
      assigneeName: r.assigneeName,
    };
    const common = { status: r.status as RequestStatus, submittedAt: iso(r.submittedAt), atRiskPercent: r.atRiskPercent };
    const response = responseState({ ...common, responseDueAt: iso(r.responseDueAt), firstResponseAt: iso(r.firstResponseAt) }, now);
    if ((response === 'at_risk' || response === 'overdue') && r.responseDueAt)
      out.push({ ...base, kind: 'response', state: response, dueAt: r.responseDueAt.toISOString() });
    const resolution = slaState({ ...common, dueDate: r.dueDate, deliveredAt: iso(r.deliveredAt), slaPausedAt: iso(r.slaPausedAt) }, now);
    if ((resolution === 'at_risk' || resolution === 'overdue') && r.dueDate)
      out.push({ ...base, kind: 'resolution', state: resolution, dueAt: `${r.dueDate}T23:59:59+03:00` });
  }
  const rank = { overdue: 0, at_risk: 1 } as const;
  return out.sort((a, b) => rank[a.state] - rank[b.state] || a.dueAt.localeCompare(b.dueAt));
}

/** Open requests with the fields SLA states need (RLS-scoped). Shared by the SLA monitor and the ops dashboard. */
export async function openRequestsForSla(tx: Parameters<Parameters<typeof withRls>[0]>[0], orgId: string, clientIds?: string[]) {
  return tx
    .select({
      id: requests.id,
      reference: requests.reference,
      title: requests.title,
      status: requests.status,
      priority: requests.priority,
      clientId: requests.clientId,
      clientName: clients.name,
      assigneeId: requests.assigneeId,
      assigneeName: sql<string | null>`(select p.full_name from public.profiles p where p.id = requests.assignee_id)`,
      submittedAt: requests.submittedAt,
      dueDate: requests.dueDate,
      deliveredAt: requests.deliveredAt,
      firstResponseAt: requests.firstResponseAt,
      responseDueAt: requests.responseDueAt,
      slaPausedAt: requests.slaPausedAt,
      atRiskPercent: slaPolicies.atRiskPercent,
    })
    .from(requests)
    .innerJoin(clients, eq(clients.id, requests.clientId))
    .leftJoin(slaPolicies, eq(slaPolicies.id, requests.slaPolicyId))
    .where(
      and(
        eq(requests.organizationId, orgId),
        notInArray(requests.status, ['draft', 'closed', 'cancelled', 'rejected']),
        isNotNull(requests.submittedAt),
        clientIds ? inArray(requests.clientId, clientIds.length ? clientIds : ['00000000-0000-0000-0000-000000000000']) : undefined,
      ),
    );
}

export type SlaMonitorData = {
  issues: SlaIssue[];
  breaches: BreachItem[];
  compliance: ReturnType<typeof compliance>;
  byClient: ClientCompliance[];
  days: number;
  people: Record<string, string>;
};

export async function getSlaMonitor(
  ctx: AgencyContext,
  opts: { days: 30 | 90; view: BreachView; clientId?: string },
): Promise<SlaMonitorData> {
  const orgId = ctx.organization.id;
  const now = new Date();
  const since = new Date(now.getTime() - opts.days * 86_400_000);
  return withRls(async (tx) => {
    const clientFilter = opts.clientId ? [opts.clientId] : undefined;
    const open = await openRequestsForSla(tx, orgId, clientFilter);
    const breachRows = await tx
      .select({ b: slaBreaches, reference: requests.reference, title: requests.title, clientName: clients.name })
      .from(slaBreaches)
      .innerJoin(requests, eq(requests.id, slaBreaches.requestId))
      .innerJoin(clients, eq(clients.id, slaBreaches.clientId))
      .where(
        and(
          eq(slaBreaches.organizationId, orgId),
          opts.clientId ? eq(slaBreaches.clientId, opts.clientId) : undefined,
          opts.view === 'open' ? isNull(slaBreaches.resolvedAt) : undefined,
          opts.view === 'unacknowledged' ? and(isNull(slaBreaches.acknowledgedAt), eq(slaBreaches.level, 'breached')) : undefined,
          opts.view === 'resolved' ? isNotNull(slaBreaches.resolvedAt) : undefined,
        ),
      )
      .orderBy(desc(slaBreaches.detectedAt))
      .limit(200);
    const windowRows = await tx
      .select({
        clientId: requests.clientId,
        clientName: clients.name,
        submittedAt: requests.submittedAt,
        responseDueAt: requests.responseDueAt,
        firstResponseAt: requests.firstResponseAt,
        dueDate: requests.dueDate,
        deliveredAt: requests.deliveredAt,
        breaches: sql<number>`(select count(*)::int from public.sla_breaches b where b.request_id = requests.id and b.level = 'breached')`,
      })
      .from(requests)
      .innerJoin(clients, eq(clients.id, requests.clientId))
      .where(
        and(
          eq(requests.organizationId, orgId),
          sql`${requests.status} <> 'draft'`,
          gte(requests.submittedAt, since),
          opts.clientId ? eq(requests.clientId, opts.clientId) : undefined,
        ),
      );
    const toRow = (r: (typeof windowRows)[number]): ComplianceRow => ({
      submittedAt: iso(r.submittedAt),
      responseDueAt: iso(r.responseDueAt),
      firstResponseAt: iso(r.firstResponseAt),
      dueDate: r.dueDate,
      deliveredAt: iso(r.deliveredAt),
    });
    const byClientMap = new Map<string, { name: LocalizedText; rows: typeof windowRows }>();
    for (const r of windowRows) {
      const entry = byClientMap.get(r.clientId) ?? { name: r.clientName, rows: [] };
      entry.rows.push(r);
      byClientMap.set(r.clientId, entry);
    }
    const ackIds = [...new Set(breachRows.map((x) => x.b.acknowledgedBy).filter(Boolean) as string[])];
    const people = ackIds.length
      ? await tx.select({ id: profiles.id, name: profiles.fullName }).from(profiles).where(inArray(profiles.id, ackIds))
      : [];
    return {
      issues: issuesOf(open, now),
      breaches: breachRows.map((x) => ({
        id: x.b.id,
        requestId: x.b.requestId,
        reference: x.reference,
        title: x.title,
        clientId: x.b.clientId,
        clientName: x.clientName,
        kind: x.b.kind as BreachKind,
        level: x.b.level as BreachLevel,
        dueAt: x.b.dueAt.toISOString(),
        detectedAt: x.b.detectedAt.toISOString(),
        resolvedAt: iso(x.b.resolvedAt),
        acknowledgedAt: iso(x.b.acknowledgedAt),
        acknowledgedBy: x.b.acknowledgedBy,
        note: x.b.note,
      })),
      compliance: compliance(windowRows.map(toRow), now),
      byClient: [...byClientMap.entries()]
        .map(([clientId, v]) => ({
          clientId,
          clientName: v.name,
          ...compliance(v.rows.map(toRow), now),
          breaches: v.rows.reduce((n, r) => n + r.breaches, 0),
        }))
        .sort((a, b) => b.breaches - a.breaches || (a.resolution.rate ?? 1) - (b.resolution.rate ?? 1)),
      days: opts.days,
      people: Object.fromEntries(people.map((p) => [p.id, p.name])),
    };
  });
}

/** Clients the caller can see, for filters. */
export async function listClientOptions(ctx: AgencyContext) {
  return withRls((tx) =>
    tx
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(eq(clients.organizationId, ctx.organization.id), sql`${clients.status} <> 'archived'`))
      .orderBy(asc(sql`${clients.name}->>'en'`)),
  );
}
