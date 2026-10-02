/**
 * Phase 7 security in the database: tokens live only in Vault and no user — not even a Super Admin, and never a client
 * user — can read them; RLS on every integration / automation table (allow and deny); server-owned columns guarded;
 * the loop-guard columns on domain_events can't be forged. Every statement runs as a real persona and is rolled back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, attempt, sql, userId } from './helpers';

let org: string;
let meta: string;
let google: string;
let account: string;
let najd: string;
let lujainMetaChannel: string;

beforeAll(async () => {
  const [c] = await sql<{ id: string; organization_id: string }[]>`
    select id, organization_id from public.integration_connections where provider = 'meta' and mode = 'sandbox'`;
  if (!c) throw new Error('Seed sandbox connections missing — run pnpm db:reset');
  meta = c.id;
  org = c.organization_id;
  [{ id: google }] = (await sql<{ id: string }[]>`select id from public.integration_connections where provider = 'google'`) as unknown as [
    { id: string },
  ];
  [{ id: account }] = (await sql<{ id: string }[]>`
    select id from public.integration_accounts where connection_id = ${meta} and external_id = 'act_sbx_1001'`) as unknown as [
    { id: string },
  ];
  [{ id: najd }] = (await sql<{ id: string }[]>`select id from public.clients where slug = 'najd-heritage'`) as unknown as [{ id: string }];
  [{ id: lujainMetaChannel }] = (await sql<{ id: string }[]>`
    select ch.id from public.campaign_channels ch join public.clients c on c.id = ch.client_id
    where c.slug = 'lujain-fashion' and ch.platform = 'meta' limit 1`) as unknown as [{ id: string }];
});

afterAll(async () => {
  await sql.end();
});

describe('tokens live only in Vault', () => {
  it('no table stores a token column', async () => {
    const cols = await sql<{ table_name: string; column_name: string }[]>`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and table_name like any (array['integration_%', 'whatsapp_%'])
        and (column_name like '%token%' or column_name like '%secret%') and column_name not in ('token_expires_at', 'secret_id')`;
    expect(cols).toEqual([]);
  });

  it('the service path can read what it stored (and only through the function)', async () => {
    const [row] = await sql<{ secret: string }[]>`select app.integration_get_secret(${meta}::uuid) as secret`;
    expect(JSON.parse(row!.secret)).toMatchObject({ accessToken: expect.stringMatching(/^sbx_/) });
  });

  for (const email of ['sara@ofoq.test', 'faisal@ofoq.test', 'noura@ofoq.test', 'mohammed@najd.test']) {
    it(`${email} can't read vault, the secrets table or the read function`, async () => {
      expect((await attempt(email, (tx) => tx`select * from vault.decrypted_secrets`))?.code).toBe('42501');
      expect((await attempt(email, (tx) => tx`select * from vault.secrets`))?.code).toBe('42501');
      expect((await attempt(email, (tx) => tx`select * from public.integration_secrets`))?.code).toBe('42501');
      expect((await attempt(email, (tx) => tx`select app.integration_get_secret(${meta}::uuid)`))?.code).toBe('42501');
      expect((await attempt(email, (tx) => tx`select app.integration_drop_secret(${meta}::uuid)`))?.code).toBe('42501');
    });
  }

  it('storing a token is write-only and needs integrations:manage', async () => {
    expect(
      await attempt('faisal@ofoq.test', (tx) => tx`select app.integration_put_secret(${google}::uuid, '{"accessToken":"x"}')`),
    ).toBeNull();
    expect(
      (await attempt('noura@ofoq.test', (tx) => tx`select app.integration_put_secret(${google}::uuid, '{"accessToken":"x"}')`))?.code,
    ).toBe('42501');
    expect(
      (await attempt('mohammed@najd.test', (tx) => tx`select app.integration_put_secret(${google}::uuid, '{"accessToken":"x"}')`))?.code,
    ).toBe('42501');
  });
});

describe('RLS: integrations are agency-only and permission-scoped', () => {
  const count = (email: string, table: string) =>
    as(email, async (tx) => (await tx.unsafe(`select count(*)::int as n from public.${table}`))[0]!.n as number);

  it('client users see nothing', async () => {
    for (const t of [
      'integration_connections',
      'integration_accounts',
      'integration_campaign_links',
      'integration_sync_runs',
      'integration_webhook_events',
      'whatsapp_templates',
      'whatsapp_messages',
      'automations',
      'automation_runs',
    ])
      expect(await count('mohammed@najd.test', t)).toBe(0);
  });

  it('a specialist without integrations:read sees nothing; an account manager reads', async () => {
    expect(await count('khalid@ofoq.test', 'integration_connections')).toBe(0);
    expect(await count('khalid@ofoq.test', 'automations')).toBe(0);
    expect(await count('noura@ofoq.test', 'integration_connections')).toBeGreaterThanOrEqual(4);
    expect(await count('noura@ofoq.test', 'automation_runs')).toBeGreaterThan(0);
    expect(await count('noura@ofoq.test', 'integration_sync_runs')).toBeGreaterThan(0);
  });

  it('a sales rep sees only approved templates of live connections (to send) and the messages', async () => {
    const templates = await as('ruba@ofoq.test', (tx) => tx<{ status: string }[]>`select status from public.whatsapp_templates`);
    expect(templates.length).toBeGreaterThan(0);
    expect(templates.every((t) => t.status === 'approved')).toBe(true);
    expect(await count('ruba@ofoq.test', 'integration_connections')).toBe(0);
    expect(await count('ruba@ofoq.test', 'whatsapp_messages')).toBeGreaterThan(0);
  });

  it('readers cannot change anything; managers change only the columns that are theirs', async () => {
    const rename = (email: string) =>
      as(email, (tx) => tx<{ id: string }[]>`update public.integration_connections set name = 'Renamed' where id = ${meta} returning id`);
    expect(await rename('noura@ofoq.test')).toEqual([]);
    const renamed = await as('faisal@ofoq.test', async (tx) => {
      await tx`update public.integration_connections set name = 'Renamed', status = 'disconnected', token_expires_at = null where id = ${meta}`;
      return (
        await tx<
          { name: string; status: string; token_expires_at: Date | null }[]
        >`select name, status, token_expires_at from public.integration_connections where id = ${meta}`
      )[0];
    });
    expect(renamed).toMatchObject({ name: 'Renamed', status: 'connected' });
    expect(renamed!.token_expires_at).not.toBeNull();
    expect(
      (
        await attempt(
          'faisal@ofoq.test',
          (tx) => tx`insert into public.integration_connections (organization_id, provider, name) values (${org}, 'meta', 'x')`,
        )
      )?.code,
    ).toBe('42501');
    expect((await attempt('faisal@ofoq.test', (tx) => tx`delete from public.integration_connections where id = ${meta}`))?.code).toBe(
      '42501',
    );
  });

  it('account mapping: external ids are server-owned; a campaign link must point at the mapped client', async () => {
    const mapped = await as('faisal@ofoq.test', async (tx) => {
      await tx`update public.integration_accounts set client_id = ${najd}, external_id = 'hacked', sync_enabled = false where id = ${account}`;
      return (
        await tx<
          { client_id: string; external_id: string }[]
        >`select client_id, external_id from public.integration_accounts where id = ${account}`
      )[0];
    });
    expect(mapped).toEqual({ client_id: najd, external_id: 'act_sbx_1001' });
    // act_sbx_1001 is mapped to Future Smile in the seed: a Lujain channel is refused.
    const err = await attempt(
      'faisal@ofoq.test',
      (tx) => tx`
      update public.integration_campaign_links set channel_id = ${lujainMetaChannel} where account_id = ${account}`,
    );
    expect(err?.message).toBe('channel_client_mismatch');
  });

  it('sync runs: managers queue manual runs whose state the trigger owns; scheduled runs are service-only', async () => {
    const run = await as('faisal@ofoq.test', async (tx) => {
      const [r] = await tx<{ status: string; rows_written: number; requested_by: string }[]>`
        insert into public.integration_sync_runs (organization_id, connection_id, trigger, date_from, date_to, status, rows_written)
        values (${org}, ${meta}, 'manual', current_date - 2, current_date, 'succeeded', 999)
        returning status, rows_written, requested_by`;
      return r;
    });
    expect(run).toEqual({ status: 'queued', rows_written: 0, requested_by: await userId('faisal@ofoq.test') });
    expect(
      (
        await attempt(
          'faisal@ofoq.test',
          (tx) => tx`
      insert into public.integration_sync_runs (organization_id, connection_id, trigger, date_from, date_to)
      values (${org}, ${meta}, 'scheduled', current_date - 2, current_date)`,
        )
      )?.message,
    ).toBe('invalid_trigger');
    expect(
      (
        await attempt(
          'faisal@ofoq.test',
          (tx) => tx`
      insert into public.integration_sync_runs (organization_id, connection_id, trigger, date_from, date_to)
      values (${org}, ${google}, 'manual', current_date - 2, current_date)`,
        )
      )?.message,
    ).toBe('connection_not_connected');
    expect(
      (
        await attempt(
          'faisal@ofoq.test',
          (tx) => tx`
      insert into public.integration_sync_runs (organization_id, connection_id, trigger, date_from, date_to)
      values (${org}, ${meta}, 'backfill', current_date - 120, current_date)`,
        )
      )?.code,
    ).toBe('23514');
    expect(
      (
        await attempt(
          'noura@ofoq.test',
          (tx) => tx`
      insert into public.integration_sync_runs (organization_id, connection_id, trigger, date_from, date_to)
      values (${org}, ${meta}, 'manual', current_date - 2, current_date)`,
        )
      )?.code,
    ).toBe('42501');
    expect((await attempt('faisal@ofoq.test', (tx) => tx`update public.integration_sync_runs set status = 'succeeded'`))?.code).toBe(
      '42501',
    );
  });

  it('webhook events, messages and runs are read-only for everyone', async () => {
    for (const stmt of [
      `insert into public.integration_webhook_events (provider, signature_valid) values ('meta', true)`,
      `update public.whatsapp_messages set status = 'read'`,
      `delete from public.automation_runs`,
    ])
      expect((await attempt('sara@ofoq.test', (tx) => tx.unsafe(stmt)))?.code).toBe('42501');
  });
});

describe('RLS: automations and WhatsApp opt-ins', () => {
  it('automations: read with automations:read, write with automations:manage, counters server-owned', async () => {
    const insert = (tx: Parameters<Parameters<typeof as>[1]>[0]) =>
      tx`insert into public.automations (organization_id, name, trigger_type, actions, run_count, created_by)
         values (${org}, 'x', 'lead.created', '[{"id":"a","type":"notify","config":{"recipients":["owner"],"title":"t"}}]', 50, null)`;
    expect((await attempt('noura@ofoq.test', insert))?.code).toBe('42501');
    const created = await as('majed@ofoq.test', async (tx) => {
      await insert(tx);
      return (
        await tx<{ run_count: number; created_by: string }[]>`select run_count, created_by from public.automations where name = 'x'`
      )[0];
    });
    expect(created).toEqual({ run_count: 0, created_by: await userId('majed@ofoq.test') });
    expect(
      (
        await attempt(
          'faisal@ofoq.test',
          (tx) =>
            tx`insert into public.automation_runs (organization_id, automation_id, event_type) select organization_id, id, trigger_type from public.automations limit 1`,
        )
      )?.code,
    ).toBe('42501');
  });

  it('opt-ins: your own row only, agency members only', async () => {
    const sara = await userId('sara@ofoq.test');
    const noura = await userId('noura@ofoq.test');
    expect(await as('noura@ofoq.test', (tx) => tx`select * from public.whatsapp_opt_ins where user_id = ${sara}`)).toEqual([]);
    expect(
      (
        await attempt(
          'noura@ofoq.test',
          (tx) =>
            tx`insert into public.whatsapp_opt_ins (user_id, organization_id, phone, opted_in_at) values (${sara}, ${org}, '+966500000000', now())`,
        )
      )?.code,
    ).toBe('42501');
    expect(
      await attempt(
        'noura@ofoq.test',
        (tx) =>
          tx`insert into public.whatsapp_opt_ins (user_id, organization_id, phone, opted_in_at) values (${noura}, ${org}, '+966501110003', now())`,
      ),
    ).toBeNull();
    expect(
      (
        await attempt(
          'noura@ofoq.test',
          (tx) => tx`insert into public.whatsapp_opt_ins (user_id, organization_id, phone) values (${noura}, ${org}, '0501110003')`,
        )
      )?.code,
    ).toBe('23514');
    // Client users are refused (the agency-member guard or the policy, whichever runs first).
    const client = await userId('mohammed@najd.test');
    expect(['42501', '22023']).toContain(
      (
        await attempt(
          'mohammed@najd.test',
          (tx) => tx`insert into public.whatsapp_opt_ins (user_id, organization_id, phone) values (${client}, ${org}, '+966500000001')`,
        )
      )?.code,
    );
  });

  it('users cannot forge the loop-guard columns on domain events', async () => {
    const sara = await userId('sara@ofoq.test');
    const id = crypto.randomUUID();
    const row = await as('sara@ofoq.test', async (tx) => {
      await tx`
        insert into public.domain_events (id, organization_id, type, aggregate_type, actor_id, automation_depth, automation_chain)
        values (${id}, ${org}, 'lead.created', 'lead', ${sara}, 3, array[gen_random_uuid()])`;
      // Users can't read domain_events: look as the owner, still inside the rolled-back transaction.
      await tx`set local role postgres`;
      const [e] = await tx<{ automation_depth: number; automation_chain: string[] }[]>`
        select automation_depth, automation_chain from public.domain_events where id = ${id}`;
      return e;
    });
    expect(row).toEqual({ automation_depth: 0, automation_chain: [] });
  });

  it('the dry-run event picker needs automations:manage', async () => {
    expect(
      (await attempt('noura@ofoq.test', (tx) => tx`select * from app.automation_recent_events(${org}::uuid, 'lead.created', 5)`))?.code,
    ).toBe('42501');
    expect(
      await attempt('faisal@ofoq.test', (tx) => tx`select * from app.automation_recent_events(${org}::uuid, 'lead.created', 5)`),
    ).toBeNull();
  });
});
