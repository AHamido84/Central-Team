/**
 * SLA sweep: an unanswered request past its reply target is recorded as breached exactly once, emits `sla.breached`,
 * notifies the assignee, account manager and escalation contact, and is resolved once the agency replies.
 * Works on committed rows and cleans up after itself.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dbAdmin } from '@/lib/db/client';
import { dispatchPendingEvents } from '@/lib/events/dispatcher';
import { slaNotifications } from '@/modules/sla/server/consumers';
import { runSlaSweep } from '@/modules/sla/server/sweep';

import { clientId, sql, userId } from './helpers';

const startedAt = new Date();
let org: string;
let najd: string;
let policyId: string;
let requestId: string;
let escalation: string;

beforeAll(async () => {
  najd = await clientId('najd-heritage');
  const [c] = await sql<{ organization_id: string }[]>`select organization_id from public.clients where id = ${najd}`;
  org = c!.organization_id;
  escalation = await userId('faisal@ofoq.test');
  const [type] = await sql<{ id: string }[]>`select id from public.request_types where key = 'social-post'`;
  const [p] = await sql<{ id: string }[]>`insert into public.sla_policies (organization_id, name, client_id, response_hours, escalate_to)
    values (${org}, '{"ar":"اختبار الفحص","en":"Sweep test"}', ${najd}, 2, ${escalation}) returning id`;
  policyId = p!.id;
  // Service-role insert: submitted a week ago, never answered → the trigger computes a reply target in the past.
  const [r] = await sql<{ id: string; response_due_at: Date | null }[]>`insert into public.requests
      (organization_id, client_id, request_type_id, title, status, submitted_at, created_at)
    values (${org}, ${najd}, ${type!.id}, 'طلب لاختبار الفحص', 'submitted', now() - interval '7 days', now() - interval '7 days')
    returning id, response_due_at`;
  requestId = r!.id;
  expect(r!.response_due_at).not.toBeNull();
});

afterAll(async () => {
  await sql`delete from public.notifications where created_at >= ${startedAt} and type in ('sla_at_risk', 'sla_breached')`;
  await sql`delete from public.sla_breaches where detected_at >= ${startedAt}`;
  await sql`delete from public.domain_events where occurred_at >= ${startedAt} and type in ('sla.at_risk', 'sla.breached')`;
  await sql`delete from public.requests where id = ${requestId}`;
  await sql`delete from public.sla_policies where id = ${policyId}`;
  await sql.end();
  await (dbAdmin as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe('SLA sweep', () => {
  it('records the breach once, notifies the right people and resolves it after the reply', async () => {
    const first = await runSlaSweep();
    expect(first.breached).toBeGreaterThanOrEqual(1);
    const rows = await sql<{ id: string; kind: string; level: string; policy_id: string }[]>`
      select id, kind, level, policy_id from public.sla_breaches where request_id = ${requestId}`;
    expect(rows.map((r) => `${r.kind}:${r.level}`).sort()).toContain('response:breached');
    expect(rows.find((r) => r.kind === 'response')!.policy_id).toBe(policyId);

    const events = await sql<{ n: number }[]>`
      select count(*)::int as n from public.domain_events
      where occurred_at >= ${startedAt} and type = 'sla.breached' and aggregate_id = ${requestId} and payload->>'kind' = 'response'`;
    expect(events[0]!.n).toBe(1);

    // Second run: nothing new for this request.
    await runSlaSweep();
    const again = await sql<
      { n: number }[]
    >`select count(*)::int as n from public.sla_breaches where request_id = ${requestId} and kind = 'response'`;
    expect(again[0]!.n).toBe(1);

    await dispatchPendingEvents([slaNotifications]);
    const [req] = await sql<{ assignee_id: string }[]>`select assignee_id from public.requests where id = ${requestId}`;
    const notified = await sql<{ user_id: string }[]>`
      select user_id from public.notifications where type = 'sla_breached' and link = ${`/requests/${requestId}`}`;
    const ids = new Set(notified.map((n) => n.user_id));
    expect(ids.has(req!.assignee_id)).toBe(true); // the account manager is the default assignee
    expect(ids.has(escalation)).toBe(true);

    // The agency replies (a system-side status move stamps the first response only for agency users, so set it).
    await sql`update public.requests set first_response_at = now() where id = ${requestId}`;
    const third = await runSlaSweep();
    expect(third.resolved).toBeGreaterThanOrEqual(1);
    const [resolved] = await sql<{ resolved_at: Date | null }[]>`
      select resolved_at from public.sla_breaches where request_id = ${requestId} and kind = 'response'`;
    expect(resolved!.resolved_at).not.toBeNull();
  });
});
