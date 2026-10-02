/**
 * Phase 5 seed: SLA policies (default, urgent, a premium client, ad campaigns), Saudi public holidays and an agency
 * day off, SLA targets back-filled onto the requests that were seeded before the policies existed, a request paused
 * while waiting on the client, and the breach log (open, acknowledged and resolved) the daily sweep would have written.
 * Runs as the table owner, so triggers treat every write as a trusted system change.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../src/lib/db/schema';
import { responseState, slaState, type RequestStatus } from '../src/modules/requests/constants';
import { zonedInstant } from '../src/modules/sla/calendar';

type Db = PostgresJsDatabase<typeof schema>;

/** Public holidays in Saudi Arabia; Eid dates follow the Umm al-Qura estimate and may shift by a day. */
const holidays: { date: string; ar: string; en: string }[] = [
  { date: '2026-09-23', ar: 'اليوم الوطني', en: 'National Day' },
  { date: '2026-10-15', ar: 'يوم الوكالة السنوي', en: 'Agency offsite' },
  { date: '2027-02-22', ar: 'يوم التأسيس', en: 'Founding Day' },
  { date: '2027-03-09', ar: 'عيد الفطر', en: 'Eid al-Fitr' },
  { date: '2027-03-10', ar: 'عيد الفطر', en: 'Eid al-Fitr' },
  { date: '2027-03-11', ar: 'عيد الفطر', en: 'Eid al-Fitr' },
  { date: '2027-05-16', ar: 'يوم عرفة', en: 'Arafat Day' },
  { date: '2027-05-17', ar: 'عيد الأضحى', en: 'Eid al-Adha' },
  { date: '2027-05-18', ar: 'عيد الأضحى', en: 'Eid al-Adha' },
  { date: '2027-09-23', ar: 'اليوم الوطني', en: 'National Day' },
];

export async function seedSlaData({
  db,
  ids,
  clientIds,
  orgId,
}: {
  db: Db;
  ids: Record<string, string>;
  clientIds: Record<string, string>;
  orgId: string;
}): Promise<void> {
  const types = await db.execute<{ id: string; key: string }>(
    sql`select id, key from public.request_types where organization_id = ${orgId}`,
  );
  const typeId = (key: string) => [...types].find((t) => t.key === key)!.id;

  await db.insert(schema.holidays).values(holidays.map((h) => ({ organizationId: orgId, date: h.date, name: { ar: h.ar, en: h.en } })));

  await db.insert(schema.slaPolicies).values([
    {
      organizationId: orgId,
      name: { ar: 'المعيار العام', en: 'Standard' },
      responseHours: 8,
      pauseOnClient: true,
      atRiskPercent: 75,
      sortOrder: 1,
      createdBy: ids.faisal,
    },
    {
      organizationId: orgId,
      name: { ar: 'الطلبات العاجلة', en: 'Urgent requests' },
      priority: 'urgent',
      responseHours: 2,
      resolutionDays: 2,
      pauseOnClient: true,
      atRiskPercent: 60,
      escalateTo: ids.faisal,
      sortOrder: 2,
      createdBy: ids.faisal,
    },
    {
      organizationId: orgId,
      name: { ar: 'حملات إعلانية', en: 'Ad campaigns' },
      requestTypeId: typeId('ad-campaign'),
      responseHours: 4,
      resolutionDays: 3,
      pauseOnClient: true,
      atRiskPercent: 75,
      escalateTo: ids.faisal,
      sortOrder: 3,
      createdBy: ids.faisal,
    },
    {
      organizationId: orgId,
      name: { ar: 'باقة نجد المميزة', en: 'Najd premium' },
      clientId: clientIds['najd-heritage'],
      responseHours: 4,
      pauseOnClient: true,
      atRiskPercent: 70,
      escalateTo: ids.faisal,
      sortOrder: 4,
      createdBy: ids.faisal,
    },
  ]);

  // Requests seeded before the policies: apply the policy each would have got at submit (response targets only;
  // their due dates were seeded deliberately and stay as they are).
  await db.execute(sql`
    with m as (
      select r.id, (app.sla_policy_for(r.organization_id, r.client_id, r.request_type_id, r.priority)).id as policy_id
      from public.requests r
      where r.organization_id = ${orgId} and r.status <> 'draft' and r.submitted_at is not null and r.sla_policy_id is null
    )
    update public.requests r set
      sla_policy_id = p.id,
      response_due_at = app.org_add_business_hours(r.organization_id, r.submitted_at, p.response_hours)
    from m join public.sla_policies p on p.id = m.policy_id
    where r.id = m.id`);
  // One request is waiting on the client under a pausing policy.
  await db.execute(sql`
    update public.requests set sla_paused_at = coalesce((
        select max(h.created_at) from public.request_status_history h
        where h.request_id = requests.id and h.to_status = 'needs_info'), now() - interval '1 day')
    where organization_id = ${orgId} and status = 'needs_info'
      and exists (select 1 from public.sla_policies p where p.id = requests.sla_policy_id and p.pause_on_client)`);

  // The breach log the daily sweep would have produced (same rules as runSlaSweep).
  const now = new Date();
  const rows = await db.execute<{
    id: string;
    client_id: string;
    status: string;
    submitted_at: string | null;
    due_date: string | null;
    delivered_at: string | null;
    first_response_at: string | null;
    response_due_at: string | null;
    sla_paused_at: string | null;
    sla_policy_id: string | null;
    at_risk_percent: number | null;
  }>(sql`
    select r.id, r.client_id, r.status, r.submitted_at, r.due_date::text as due_date, r.delivered_at, r.first_response_at,
      r.response_due_at, r.sla_paused_at, r.sla_policy_id, p.at_risk_percent
    from public.requests r left join public.sla_policies p on p.id = r.sla_policy_id
    where r.organization_id = ${orgId} and r.status <> 'draft' and r.submitted_at is not null`);
  const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
  const breaches: (typeof schema.slaBreaches.$inferInsert)[] = [];
  for (const r of rows) {
    const base = { status: r.status as RequestStatus, submittedAt: iso(r.submitted_at), atRiskPercent: r.at_risk_percent };
    const dueEnd = r.due_date ? new Date(zonedInstant(r.due_date, 1440, 'Asia/Riyadh').getTime() - 1000) : null;
    const common = { organizationId: orgId, clientId: r.client_id, requestId: r.id, policyId: r.sla_policy_id };
    const resolution = slaState({ ...base, dueDate: r.due_date, deliveredAt: iso(r.delivered_at), slaPausedAt: iso(r.sla_paused_at) }, now);
    if (dueEnd && (resolution === 'overdue' || resolution === 'at_risk'))
      breaches.push({
        ...common,
        kind: 'resolution',
        level: resolution === 'overdue' ? 'breached' : 'at_risk',
        dueAt: dueEnd,
        detectedAt: now,
      });
    // Delivered late: breached at the deadline, resolved on delivery.
    if (dueEnd && resolution === 'missed')
      breaches.push({
        ...common,
        kind: 'resolution',
        level: 'breached',
        dueAt: dueEnd,
        detectedAt: new Date(dueEnd.getTime() + 5 * 3_600_000),
        resolvedAt: new Date(r.delivered_at!),
      });
    const response = responseState({ ...base, responseDueAt: iso(r.response_due_at), firstResponseAt: iso(r.first_response_at) }, now);
    if (r.response_due_at && (response === 'overdue' || response === 'at_risk'))
      breaches.push({
        ...common,
        kind: 'response',
        level: response === 'overdue' ? 'breached' : 'at_risk',
        dueAt: new Date(r.response_due_at),
        detectedAt: now,
      });
  }
  if (breaches.length) {
    // Acknowledge the oldest open breach so the log shows both states.
    const open = breaches.filter((b) => b.level === 'breached' && !b.resolvedAt);
    const first = open[0];
    if (first) Object.assign(first, { acknowledgedAt: now, acknowledgedBy: ids.noura, note: 'تواصلنا مع العميل ونسلّم غدًا صباحًا' });
    await db.insert(schema.slaBreaches).values(breaches).onConflictDoNothing();
  }

  const [p] = await db.execute<{ n: number }>(sql`select count(*)::int as n from public.sla_policies where organization_id = ${orgId}`);
  console.info(`✓ Seeded ${p?.n} SLA policies, ${holidays.length} holidays and ${breaches.length} SLA breach records.`);
}
