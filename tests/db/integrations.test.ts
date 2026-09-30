/**
 * Phase 7 service paths against Postgres (committed, cleaned up afterwards): sandbox connect → Vault, the metrics sync
 * (idempotent, replaces manual numbers, retries), lead ads through the signed webhook path (dedup on the platform id
 * and on phone), WhatsApp sends with forward-only delivery statuses, and the automation engine (conditions, actions,
 * loop guard, retries → failure notice, dry run without side effects).
 */
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key-for-signing-0000';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dispatchPendingEvents } from '@/lib/events/dispatcher';
import { automationEngine, loadEvent, runAutomation } from '@/modules/automations/server/engine';
import { signingSecret } from '@/modules/integrations/providers';
import { discover, saveConnection } from '@/modules/integrations/server/connections';
import { integrationNotifications } from '@/modules/integrations/server/consumers';
import { executeSyncRun } from '@/modules/integrations/server/sync';
import { processWebhookEvents, receiveWebhook, SANDBOX_SIGNATURE_HEADER } from '@/modules/integrations/server/webhooks';
import { sendWhatsApp } from '@/modules/integrations/server/whatsapp';
import { signSandbox } from '@/modules/integrations/signatures';

import { sql, userId } from './helpers';

const startedAt = new Date();
const tag = Date.now().toString(36);
let org: string;
let sara: string;
let majed: string;
let ruba: string;
let najd: string;
let snap: string;
let campaignId: string;
let channelId: string;
const automationIds: string[] = [];
const leadPhones: string[] = [];

async function dispatch(consumers = [automationEngine]) {
  for (let i = 0; i < 5; i++) {
    const r = await dispatchPendingEvents(consumers);
    if (r.delivered + r.failed === 0) break;
  }
}

beforeAll(async () => {
  sara = await userId('sara@ofoq.test');
  majed = await userId('majed@ofoq.test');
  ruba = await userId('ruba@ofoq.test');
  const [c] = await sql<
    { id: string; organization_id: string }[]
  >`select id, organization_id from public.clients where slug = 'najd-heritage'`;
  najd = c!.id;
  org = c!.organization_id;
  await sql`delete from public.integration_connections where provider = 'snapchat' and mode = 'sandbox'`;
  const [camp] = await sql<{ id: string }[]>`
    insert into public.campaigns (organization_id, client_id, name, status, start_date, end_date, owner_id)
    values (${org}, ${najd}, ${`DB sync ${tag}`}, 'active', current_date - 30, current_date + 30, ${sara}) returning id`;
  campaignId = camp!.id;
  const [ch] = await sql<{ id: string }[]>`
    insert into public.campaign_channels (organization_id, client_id, campaign_id, platform, name)
    values (${org}, ${najd}, ${campaignId}, 'snapchat', 'Snap') returning id`;
  channelId = ch!.id;
});

afterAll(async () => {
  await sql`delete from public.automations where id = any(${automationIds})`;
  await sql`delete from public.campaigns where id = ${campaignId}`;
  await sql`delete from public.integration_connections where provider = 'snapchat' and mode = 'sandbox'`;
  if (leadPhones.length) {
    await sql`delete from public.integration_webhook_events where lead_id in (select id from public.leads where phone = any(${leadPhones}))`;
    await sql`delete from public.leads where phone = any(${leadPhones})`;
  }
  await sql`delete from public.integration_webhook_events where received_at >= ${startedAt} and status in ('rejected', 'ignored')`;
  await sql`delete from public.whatsapp_messages where created_at >= ${startedAt}`;
  await sql`delete from public.notifications where created_at >= ${startedAt} and type in ('automation_message', 'automation_failed', 'integration_expired', 'integration_sync_failed')`;
  await sql.end();
});

describe('connect and sync (sandbox)', () => {
  it('stores the tokens in Vault and discovers accounts and campaigns', async () => {
    const { connectionId, reconnected } = await saveConnection({
      organizationId: org,
      actorId: sara,
      provider: 'snapchat',
      mode: 'sandbox',
      tokens: { accessToken: 'sbx_test', refreshToken: 'sbxr_test', expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    snap = connectionId;
    expect(reconnected).toBe(false);
    const [secret] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.integration_secrets s join vault.secrets v on v.id = s.secret_id where s.connection_id = ${snap}`;
    expect(secret!.n).toBe(1);
    const links =
      await sql`select 1 from public.integration_campaign_links l join public.integration_accounts a on a.id = l.account_id where a.connection_id = ${snap}`;
    expect(links.length).toBe(3);
    // The audit trail names who connected it.
    const [audit] = await sql<{ actor_id: string }[]>`
      select actor_id from public.activity_log where table_name = 'integration_connections' and record_id = ${snap} and action = 'insert'`;
    expect(audit?.actor_id).toBe(sara);
    // Re-authorizing the same platform user reuses the connection and its mappings.
    expect(
      (
        await saveConnection({
          organizationId: org,
          actorId: sara,
          provider: 'snapchat',
          mode: 'sandbox',
          tokens: { accessToken: 'sbx_test2', expiresAt: null },
        })
      ).connectionId,
    ).toBe(snap);
    expect(await discover(snap)).toMatchObject({ accounts: 1, campaigns: 3 });
  });

  it('a sync writes the linked channel per day, is idempotent, and replaces manual numbers', async () => {
    const [acc] = await sql<{ id: string }[]>`
      update public.integration_accounts set client_id = ${najd}, sync_enabled = true where connection_id = ${snap} returning id`;
    await sql`update public.integration_campaign_links set channel_id = ${channelId}
      where account_id = ${acc!.id} and external_campaign_id in ('sbx_snap_4001_c1', 'sbx_snap_4001_c2')`;
    // A number typed by hand for yesterday is replaced by the platform's.
    await sql`insert into public.metrics_daily (organization_id, client_id, campaign_id, channel_id, date, impressions, source)
      values (${org}, ${najd}, ${campaignId}, ${channelId}, current_date - 1, 7, 'manual')`;
    const queue = async () =>
      (
        await sql<{ id: string }[]>`insert into public.integration_sync_runs (organization_id, connection_id, trigger, date_from, date_to)
        values (${org}, ${snap}, 'backfill', current_date - 6, current_date) returning id`
      )[0]!.id;
    const snapshot = () =>
      sql<{ date: string; impressions: number; spend_minor: number; source: string }[]>`
        select date::text, impressions::int, spend_minor::int, source from public.metrics_daily where channel_id = ${channelId} order by date`;

    const first = await executeSyncRun(await queue());
    expect(first).toMatchObject({ status: 'succeeded', rowsWritten: 7, campaigns: 1 });
    const a = await snapshot();
    expect(a).toHaveLength(7);
    expect(a.every((r) => r.source === 'api' && r.impressions > 7)).toBe(true);
    // Two platform campaigns feed the channel: each day is their sum.
    expect(a[0]!.impressions).toBeGreaterThan(2_000 * 2 - 1);

    await executeSyncRun(await queue());
    expect(await snapshot()).toEqual(a);
    const [synced] = await sql<
      { n: number }[]
    >`select count(*)::int as n from public.domain_events where type = 'metrics.synced' and aggregate_id = ${campaignId}`;
    expect(synced!.n).toBe(2);
  });

  it('a platform failure retries with backoff, then gives up and tells the managers once', async () => {
    // Revoke the token behind the sandbox's back: every call now fails as auth_revoked (terminal).
    await sql`select app.integration_put_secret(${snap}::uuid, ${JSON.stringify({ accessToken: 'sbx_revoked_x', expiresAt: null })})`;
    const [{ id }] = (await sql<
      { id: string }[]
    >`insert into public.integration_sync_runs (organization_id, connection_id, trigger, date_from, date_to)
      values (${org}, ${snap}, 'manual', current_date - 1, current_date) returning id`) as unknown as [{ id: string }];
    const run = await executeSyncRun(id);
    expect(run).toMatchObject({ status: 'failed', errorCode: 'auth_revoked', attempts: 3 });
    const [c] = await sql<
      { status: string; last_error_code: string }[]
    >`select status, last_error_code from public.integration_connections where id = ${snap}`;
    expect(c).toEqual({ status: 'expired', last_error_code: 'auth_revoked' });
    expect(await executeSyncRun(id)).toBeNull();
    await dispatch([integrationNotifications]);
    const notes = await sql<{ type: string }[]>`
      select type from public.notifications where created_at >= ${startedAt} and link = ${`/admin/integrations/${snap}`}`;
    expect(notes.filter((n) => n.type === 'integration_expired').length).toBeGreaterThan(0);
    expect(notes.filter((n) => n.type === 'integration_sync_failed').length).toBeGreaterThan(0);
  });
});

describe('lead ads through the signed webhook path', () => {
  const phone = `+96655${String(Date.now()).slice(-7)}`;
  const leadgen = (id: string, withPhone = phone) =>
    JSON.stringify({
      object: 'page',
      entry: [
        {
          id: 'sbx_page_2001',
          changes: [
            {
              field: 'leadgen',
              value: {
                leadgen_id: id,
                page_id: 'sbx_page_2001',
                form_id: 'F-1',
                field_data: [
                  { name: 'full_name', values: ['Webhook Lead'] },
                  { name: 'phone_number', values: [withPhone] },
                  { name: 'city', values: ['riyadh'] },
                  { name: 'preferred_time', values: ['evening'] },
                ],
              },
            },
          ],
        },
      ],
    });
  const signed = (raw: string) => new Headers({ [SANDBOX_SIGNATURE_HEADER]: signSandbox(raw, signingSecret()) });
  let leadId: string;

  it('rejects unsigned and badly signed deliveries without keeping the payload', async () => {
    leadPhones.push(phone);
    const raw = leadgen(`L${tag}0`);
    expect((await receiveWebhook('meta', raw, new Headers())).status).toBe(401);
    expect(
      (await receiveWebhook('meta', raw, new Headers({ [SANDBOX_SIGNATURE_HEADER]: signSandbox(raw, 'wrong-secret-000000') }))).status,
    ).toBe(401);
    expect((await receiveWebhook('meta', raw, new Headers({ 'x-hub-signature-256': 'sha256=deadbeef' }))).status).toBe(401);
    const rejected = await sql<{ payload: unknown }[]>`
      select payload from public.integration_webhook_events where status = 'rejected' and received_at >= ${startedAt}`;
    expect(rejected.length).toBeGreaterThanOrEqual(3);
    expect(rejected.every((r) => r.payload === null)).toBe(true);
  });

  it('creates a lead_ad lead with an external ref, assigned by the rules; a replay is a no-op', async () => {
    const raw = leadgen(`L${tag}1`);
    const first = await receiveWebhook('meta', raw, signed(raw));
    expect(first).toMatchObject({ status: 200, duplicates: 0 });
    expect(first.accepted).toHaveLength(1);
    expect(await processWebhookEvents(first.accepted)).toEqual({ processed: 1, failed: 0 });
    const [lead] = await sql<{ id: string; source: string; external_ref: string; city: string; notes: string; tags: string[] }[]>`
      select id, source, external_ref, city, notes, tags from public.leads where phone = ${phone}`;
    expect(lead).toMatchObject({ source: 'lead_ad', external_ref: `meta:L${tag}1`, city: 'riyadh', tags: ['meta'] });
    expect(lead!.notes).toContain('preferred_time: evening');
    leadId = lead!.id;
    const replay = await receiveWebhook('meta', raw, signed(raw));
    expect(replay).toMatchObject({ accepted: [], duplicates: 1 });
    expect((await sql`select 1 from public.leads where phone = ${phone}`).length).toBe(1);
  });

  it('a new lead id with a known phone becomes an activity on the existing lead', async () => {
    const raw = leadgen(`L${tag}2`);
    const r = await receiveWebhook('meta', raw, signed(raw));
    await processWebhookEvents(r.accepted);
    expect((await sql`select 1 from public.leads where phone = ${phone}`).length).toBe(1);
    const [act] = await sql<
      { subject: string }[]
    >`select subject from public.crm_activities where lead_id = ${leadId} order by created_at desc limit 1`;
    expect(act?.subject).toBe('resubmitted_lead_ad');
  });

  it('an unknown page is logged as ignored, not processed', async () => {
    const raw = leadgen(`L${tag}3`).replaceAll('sbx_page_2001', 'unknown_page');
    const r = await receiveWebhook('meta', raw, signed(raw));
    expect(r.accepted).toEqual([]);
    const [e] = await sql<
      { status: string; error: string }[]
    >`select status, error from public.integration_webhook_events where external_id = ${`sandbox:L${tag}3`}`;
    expect(e).toEqual({ status: 'ignored', error: 'unknown_account' });
  });
});

describe('WhatsApp', () => {
  it('sends an approved template, logs it on the lead and follows the delivery statuses forward only', async () => {
    const [tpl] = await sql<{ id: string }[]>`select id from public.whatsapp_templates where name = 'lead_welcome' and language = 'ar'`;
    const { whatsappTemplates } = await import('@/lib/db/schema');
    const { dbAdmin } = await import('@/lib/db/client');
    const { eq } = await import('drizzle-orm');
    const [template] = await dbAdmin.select().from(whatsappTemplates).where(eq(whatsappTemplates.id, tpl!.id));
    const [lead] = await sql<{ id: string }[]>`select id from public.leads where external_ref = 'meta:sbx_lead_90001'`;
    const res = await sendWhatsApp({
      organizationId: org,
      template: template!,
      to: '+966551230077',
      params: ['ريم', 'أفق'],
      purpose: 'lead',
      leadId: lead!.id,
      sentBy: ruba,
    });
    expect(res.status).toBe('sent');
    const [msg] = await sql<{ status: string; body: string; external_id: string; read_at: Date | null }[]>`
      select status, body, external_id, read_at from public.whatsapp_messages where id = ${res.messageId}`;
    // The sandbox plays the platform: delivered then read arrive through the signed status webhook.
    expect(msg).toMatchObject({ status: 'read', body: expect.stringContaining('ريم') });
    expect(msg!.read_at).not.toBeNull();
    await sql`update public.whatsapp_messages set status = 'delivered' where id = ${res.messageId}`;
    expect((await sql<{ status: string }[]>`select status from public.whatsapp_messages where id = ${res.messageId}`)[0]!.status).toBe(
      'read',
    );
    const [act] = await sql<
      { type: string; subject: string }[]
    >`select type, subject from public.crm_activities where lead_id = ${lead!.id} order by created_at desc limit 1`;
    expect(act).toEqual({ type: 'whatsapp', subject: 'whatsapp_sent' });
  });

  it('a bad number fails with a translated code and no platform id', async () => {
    const { whatsappTemplates } = await import('@/lib/db/schema');
    const { dbAdmin } = await import('@/lib/db/client');
    const [template] = await dbAdmin.select().from(whatsappTemplates).limit(1);
    const res = await sendWhatsApp({
      organizationId: org,
      template: { ...template!, status: 'approved' },
      to: '0551234567',
      params: [],
      purpose: 'automation',
    });
    expect(res).toMatchObject({ status: 'failed', errorCode: 'invalid_phone' });
  });
});

describe('automation engine', () => {
  const createRule = async (v: { trigger: string; conditions: unknown[]; actions: unknown[]; active?: boolean }) => {
    const [row] = await sql<{ id: string }[]>`
      insert into public.automations (organization_id, name, is_active, trigger_type, conditions, actions)
      values (${org}, ${`Test ${tag} ${automationIds.length}`}, ${v.active ?? true}, ${v.trigger}, ${sql.json(v.conditions as never)}, ${sql.json(v.actions as never)})
      returning id`;
    automationIds.push(row!.id);
    return row!.id;
  };
  const runsOf = (id: string) =>
    sql<
      { status: string; skip_reason: string | null; attempts: number; dry_run: boolean; actions: { status: string; error?: string }[] }[]
    >`
      select status, skip_reason, attempts, dry_run, actions from public.automation_runs where automation_id = ${id} order by started_at`;
  const newLead = async (city: string) => {
    const p = `+96656${String(Date.now()).slice(-7)}`;
    leadPhones.push(p);
    const { ingestLead } = await import('@/modules/crm/server/intake');
    const r = await ingestLead(
      org,
      {
        fullName: `Auto ${tag}`,
        company: null,
        phone: p,
        email: null,
        source: 'lead_ad',
        sourceDetail: null,
        externalRef: `test:${p}`,
        services: ['ads'],
        budgetRange: 'unknown',
        city,
        ownerId: null,
        tags: [],
        notes: '',
        message: '',
      },
      'lead_ad',
    );
    return r.leadId;
  };

  it('runs matching rules once per event: conditions, notify the owner, change the status', async () => {
    // Earlier tests left lead events undelivered to the engine; drain them before the new rule exists.
    await dispatch();
    await sql`update public.automations set is_active = false where organization_id = ${org} and trigger_type = 'lead.created' and not (id = any(${automationIds}))`;
    const id = await createRule({
      trigger: 'lead.created',
      conditions: [
        { field: 'lead.source', op: 'eq', value: 'lead_ad' },
        { field: 'lead.city', op: 'in', value: ['riyadh', 'jeddah'] },
      ],
      actions: [
        {
          id: 'n',
          type: 'notify',
          config: { recipients: ['users'], userIds: [sara], title: 'New lead: {{lead.full_name}}', body: '{{lead.city}}' },
        },
        { id: 's', type: 'change_status', config: { status: 'qualified' } },
      ],
    });
    const hit = await newLead('riyadh');
    const miss = await newLead('abha');
    await dispatch();
    const runs = await runsOf(id);
    expect(runs.map((r) => [r.status, r.skip_reason])).toEqual([
      ['succeeded', null],
      ['skipped', 'conditions'],
    ]);
    expect((await sql<{ status: string }[]>`select status from public.leads where id = ${hit}`)[0]!.status).toBe('qualified');
    expect((await sql<{ status: string }[]>`select status from public.leads where id = ${miss}`)[0]!.status).toBe('new');
    const [note] = await sql<{ params: { title: string } }[]>`
      select params from public.notifications where user_id = ${sara} and type = 'automation_message' and created_at >= ${startedAt} order by created_at desc limit 1`;
    expect(note!.params.title).toBe(`New lead: Auto ${tag}`);
    // Redelivering the same event never runs the rule twice.
    await sql`update public.domain_event_deliveries set processed_at = null, next_attempt_at = now() where consumer = 'automations.engine'
      and event_id in (select id from public.domain_events where aggregate_id = ${hit} and type = 'lead.created')`;
    await dispatch();
    expect(await runsOf(id)).toHaveLength(2);
    await sql`update public.automations set is_active = false where id = ${id}`;
  });

  it('loop guard: a rule never re-triggers itself down its own chain', async () => {
    // On "lead assigned" → assign to someone else: that emits lead.assigned again, which must not run the rule again.
    const id = await createRule({
      trigger: 'lead.assigned',
      conditions: [],
      actions: [{ id: 'a', type: 'assign', config: { userIds: [majed, ruba] } }],
    });
    const lead = await newLead('tabuk');
    await sql`update public.leads set owner_id = null where id = ${lead}`;
    const { emitEvent } = await import('@/lib/events/emit');
    const { dbAdmin } = await import('@/lib/db/client');
    await dbAdmin.transaction((tx) =>
      emitEvent(tx, {
        type: 'lead.assigned',
        organizationId: org,
        actorId: null,
        aggregate: { type: 'lead', id: lead },
        payload: { leadId: lead, ownerId: null, previousOwnerId: null, ruleId: null },
      }),
    );
    await dispatch();
    const runs = await runsOf(id);
    expect(runs.some((r) => r.status === 'succeeded')).toBe(true);
    expect(runs.some((r) => r.skip_reason === 'loop_self')).toBe(true);
    const [chained] = await sql<{ automation_depth: number; automation_chain: string[] }[]>`
      select automation_depth, automation_chain from public.domain_events where type = 'lead.assigned' and aggregate_id = ${lead} and automation_depth > 0 limit 1`;
    expect(chained).toEqual({ automation_depth: 1, automation_chain: [id] });
    await sql`update public.automations set is_active = false where id = ${id}`;
  });

  it('a failing action retries, then fails for good once and tells the managers', async () => {
    const id = await createRule({
      trigger: 'lead.created',
      conditions: [{ field: 'lead.city', op: 'eq', value: 'taif' }],
      // No phone on record-less "phone" mode: the WhatsApp action can't find a number → action error.
      actions: [
        {
          id: 'w',
          type: 'send_whatsapp',
          config: { to: 'phone', phone: 'not-a-number', templateId: '00000000-0000-0000-0000-000000000000', params: [] },
        },
      ],
    });
    const lead = await newLead('taif');
    const event = (
      await sql<{ id: string }[]>`select id from public.domain_events where type = 'lead.created' and aggregate_id = ${lead}`
    )[0]!;
    const [rule] = await (await import('@/lib/db/client')).dbAdmin.query.automations.findMany({ where: (a, { eq }) => eq(a.id, id) });
    const stored = (await loadEvent(org, event.id, 'lead.created'))!;
    expect((await runAutomation(rule!, stored)).retry).toBe(true);
    expect((await runAutomation(rule!, stored)).retry).toBe(true);
    const last = await runAutomation(rule!, stored);
    expect(last).toMatchObject({ status: 'failed', retry: false });
    expect((await runAutomation(rule!, stored)).status).toBe('failed');
    const runs = await runsOf(id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'failed', attempts: 3 });
    expect(runs[0]!.actions[0]).toMatchObject({ status: 'failed', error: 'no_phone' });
    const [a] = await sql<
      { failure_count: number; run_count: number }[]
    >`select failure_count, run_count from public.automations where id = ${id}`;
    expect(a).toEqual({ failure_count: 1, run_count: 1 });
    await dispatch([integrationNotifications]);
    const notes =
      await sql`select 1 from public.notifications where type = 'automation_failed' and link like ${`/admin/automations/${id}%`}`;
    expect(notes.length).toBeGreaterThan(0);
    await sql`update public.automations set is_active = false where id = ${id}`;
  });

  it('a dry run plans the actions and changes nothing', async () => {
    const id = await createRule({
      trigger: 'lead.created',
      active: false,
      conditions: [],
      actions: [
        { id: 'n', type: 'notify', config: { recipients: ['users'], userIds: [sara], title: 'Dry {{lead.full_name}}', body: '' } },
        { id: 's', type: 'change_status', config: { status: 'unqualified' } },
        { id: 't', type: 'webhook', config: { url: 'https://hooks.example.com/x' } },
      ],
    });
    const lead = await newLead('dammam');
    const event = (
      await sql<{ id: string }[]>`select id from public.domain_events where type = 'lead.created' and aggregate_id = ${lead}`
    )[0]!;
    const [rule] = await (await import('@/lib/db/client')).dbAdmin.query.automations.findMany({ where: (a, { eq }) => eq(a.id, id) });
    const before = await sql`select 1 from public.notifications where params->>'title' = ${`Dry Auto ${tag}`}`;
    const outcome = await runAutomation(rule!, (await loadEvent(org, event.id, 'lead.created'))!, { dryRun: true, requestedBy: sara });
    expect(outcome.status).toBe('succeeded');
    const [run] = await runsOf(id);
    expect(run).toMatchObject({ dry_run: true, status: 'succeeded' });
    expect(run!.actions.map((x) => x.status)).toEqual(['planned', 'planned', 'planned']);
    expect((await sql<{ status: string }[]>`select status from public.leads where id = ${lead}`)[0]!.status).toBe('new');
    expect(await sql`select 1 from public.notifications where params->>'title' = ${`Dry Auto ${tag}`}`).toHaveLength(before.length);
    // Dry runs can repeat on the same event; real runs are unique per event.
    await runAutomation(rule!, (await loadEvent(org, event.id, 'lead.created'))!, { dryRun: true });
    expect(await runsOf(id)).toHaveLength(2);
  });
});
