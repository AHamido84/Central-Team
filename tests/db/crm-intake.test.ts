/**
 * Phase 6 service paths against Postgres (committed, cleaned up afterwards): website-form and webhook intake
 * (assignment rules with round-robin, duplicate → activity on the existing lead, idempotent `external_ref`, form
 * submission count) and the CRM sweep (follow-up due and stale deal announced once, notifications to the owner).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dbAdmin } from '@/lib/db/client';
import { dispatchPendingEvents } from '@/lib/events/dispatcher';
import { crmNotifications } from '@/modules/crm/server/consumers';
import { ingestLead, type LeadValues } from '@/modules/crm/server/intake';
import { runCrmSweep } from '@/modules/crm/server/sweep';

import { sql, userId } from './helpers';

const startedAt = new Date();
const PHONE_PREFIX = '+96655888';
let org: string;
let formId: string;
let majed: string;
let ruba: string;
let pipeline: string;
let firstStage: string;
const created: { deals: string[] } = { deals: [] };

const values = (over: Partial<LeadValues & { message: string }>): LeadValues & { message: string } => ({
  fullName: 'Intake Test',
  company: null,
  phone: null,
  email: null,
  source: 'website_form',
  sourceDetail: null,
  services: ['social_media'],
  budgetRange: 'unknown',
  city: 'riyadh',
  ownerId: null,
  tags: [],
  notes: '',
  message: 'Hello',
  ...over,
});

beforeAll(async () => {
  const [f] = await sql<
    { id: string; organization_id: string }[]
  >`select id, organization_id from public.lead_forms where token = 'ofoq-website-contact'`;
  formId = f!.id;
  org = f!.organization_id;
  majed = await userId('majed@ofoq.test');
  ruba = await userId('ruba@ofoq.test');
  const [p] = await sql<{ id: string }[]>`select id from public.pipelines where is_default and organization_id = ${org}`;
  pipeline = p!.id;
  const [s] = await sql<
    { id: string }[]
  >`select id from public.pipeline_stages where pipeline_id = ${pipeline} order by sort_order limit 1`;
  firstStage = s!.id;
});

afterAll(async () => {
  const leadIds = (
    await sql<{ id: string }[]>`select id from public.leads where phone like ${`${PHONE_PREFIX}%`} or external_ref like 'test-intake-%'`
  ).map((r) => r.id);
  await sql`delete from public.notifications where created_at >= ${startedAt} and type in ('lead_assigned', 'crm_followup_due', 'deal_stale', 'deal_won')`;
  await sql`delete from public.domain_events where occurred_at >= ${startedAt} and (aggregate_id = any(${leadIds}) or aggregate_id = any(${created.deals}))`;
  await sql`delete from public.deals where id = any(${created.deals})`;
  await sql`delete from public.leads where id = any(${leadIds})`;
  await sql`update public.lead_forms set submissions = greatest(0, submissions - 2) where id = ${formId}`;
  await sql.end();
  await (dbAdmin as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe('lead intake', () => {
  it('assigns form leads with the rules: city match first, then round-robin', async () => {
    const jeddah = await ingestLead(org, { ...values({ phone: `${PHONE_PREFIX}0001`, city: 'jeddah' }), formId }, 'form');
    const a = await ingestLead(org, { ...values({ phone: `${PHONE_PREFIX}0002` }), formId }, 'form');
    const b = await ingestLead(org, values({ phone: `${PHONE_PREFIX}0003`, source: 'referral' }), 'webhook');
    const rows = await sql<{ id: string; owner_id: string | null; form_id: string | null }[]>`
      select id, owner_id, form_id from public.leads where id = any(${[jeddah.leadId, a.leadId, b.leadId]})`;
    const owner = (id: string) => rows.find((r) => r.id === id)!.owner_id;
    expect(owner(jeddah.leadId)).toBe(ruba);
    expect(new Set([owner(a.leadId), owner(b.leadId)])).toEqual(new Set([majed, ruba]));
    expect(rows.find((r) => r.id === a.leadId)!.form_id).toBe(formId);
    const events = await sql<
      { type: string }[]
    >`select type from public.domain_events where aggregate_id = ${a.leadId} order by occurred_at`;
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['lead.created', 'lead.assigned']));
  });

  it('turns a repeat submission into an activity on the existing lead', async () => {
    const [before] = await sql<{ n: number }[]>`select count(*)::int as n from public.leads where phone like ${`${PHONE_PREFIX}%`}`;
    // Same number typed the local way, and the same person.
    const again = await ingestLead(
      org,
      { ...values({ phone: '0558880002'.replace(/^0/, '+966'), fullName: 'Intake Again', message: 'Second message' }), formId },
      'form',
    );
    expect(again.duplicate).toBe(true);
    const [after] = await sql<{ n: number }[]>`select count(*)::int as n from public.leads where phone like ${`${PHONE_PREFIX}%`}`;
    expect(after!.n).toBe(before!.n);
    const notes = await sql<
      { subject: string; body: string }[]
    >`select subject, body from public.crm_activities where lead_id = ${again.leadId}`;
    expect(notes.some((n) => n.subject === 'resubmitted_form' && n.body.includes('Second message'))).toBe(true);
  });

  it('is idempotent on the webhook external_ref', async () => {
    const one = await ingestLead(
      org,
      values({ source: 'lead_ad', externalRef: 'test-intake-1', email: 'intake1@example.test', city: null }),
      'webhook',
    );
    const two = await ingestLead(
      org,
      values({ source: 'lead_ad', externalRef: 'test-intake-1', email: 'intake1@example.test', city: null }),
      'webhook',
    );
    expect(one.duplicate).toBe(false);
    expect(two).toEqual({ leadId: one.leadId, duplicate: true });
  });
});

describe('CRM sweep', () => {
  it('announces a due follow-up and a quiet deal once, and notifies the owner', async () => {
    const [deal] = await sql<{ id: string }[]>`insert into public.deals
        (organization_id, pipeline_id, stage_id, title, value_minor, owner_id, created_at)
      values (${org}, ${pipeline}, ${firstStage}, 'Sweep test deal', 100000, ${ruba}, now() - interval '20 days') returning id`;
    created.deals.push(deal!.id);
    await sql`update public.deals set last_activity_at = now() - interval '15 days' where id = ${deal!.id}`;
    const [act] = await sql<{ id: string }[]>`insert into public.crm_activities (organization_id, deal_id, type, subject, due_at, owner_id)
      values (${org}, ${deal!.id}, 'call', 'Sweep follow-up', now() - interval '1 hour', ${ruba}) returning id`;

    const first = await runCrmSweep();
    expect(first.followUpsDue).toBeGreaterThanOrEqual(1);
    expect(first.staleDeals).toBeGreaterThanOrEqual(1);
    const [marks] = await sql<{ reminded: Date | null; stale: Date | null }[]>`
      select a.reminded_at as reminded, d.stale_notified_at as stale from public.crm_activities a join public.deals d on d.id = a.deal_id where a.id = ${act!.id}`;
    expect(marks!.reminded).not.toBeNull();
    expect(marks!.stale).not.toBeNull();

    await runCrmSweep();
    const events = await sql<{ type: string; n: number }[]>`
      select type, count(*)::int as n from public.domain_events where aggregate_id = ${deal!.id} and type in ('crm_activity.due', 'deal.stale') group by type`;
    expect(Object.fromEntries(events.map((e) => [e.type, e.n]))).toEqual({ 'crm_activity.due': 1, 'deal.stale': 1 });

    await dispatchPendingEvents([crmNotifications]);
    const notified = await sql<{ type: string; user_id: string }[]>`
      select type, user_id from public.notifications where link = ${`/crm/deals/${deal!.id}`}`;
    expect(notified.map((n) => n.type).sort()).toEqual(['crm_followup_due', 'deal_stale']);
    expect(notified.every((n) => n.user_id === ruba)).toBe(true);
  });
});
