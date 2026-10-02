/**
 * FR1.6 / ADR-086 — personal platform connections: the owner sees and maps their own connection; other staff without
 * `integrations:read` don't see it; client users see nothing; admins see every connection; mapping is limited to
 * clients the owner can reach.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { dispatchPendingEvents } from '@/lib/events/dispatcher';
import { integrationNotifications } from '@/modules/integrations/server/consumers';
import { warnExpiringPersonal } from '@/modules/integrations/server/sweep';

import { as, clientId, sql, userId } from './helpers';

const OWNER = 'khalid@ofoq.test'; // specialist: integrations:connect
const OTHER = 'omar@ofoq.test'; // specialist
const ADMIN = 'sara@ofoq.test';
const CLIENT = 'mohammed@najd.test';

afterAll(async () => {
  await sql.end();
});

type Tx = Parameters<Parameters<typeof as>[1]>[0];

/** Creates a personal connection (owned by OWNER) with one ad account and one campaign, then continues as `email`. */
async function withPersonal<T>(email: string, fn: (tx: Tx, ids: { connection: string; account: string }) => Promise<T>) {
  const owner = await userId(OWNER);
  return as(email, async (tx) => {
    await tx`select set_config('role', 'postgres', true)`;
    const [{ org }] = (await tx<{ org: string }[]>`
      select organization_id as org from public.organization_members where user_id = ${owner} limit 1`) as unknown as [{ org: string }];
    const [c] = await tx<{ id: string }[]>`
      insert into public.integration_connections (organization_id, provider, mode, name, status, scopes, settings, connected_by, owner_id)
      values (${org}, 'meta', 'sandbox', 'Khalid Meta', 'connected', '{}', '{"tokenHint":"EAAB…wxyz"}', ${owner}, ${owner})
      returning id`;
    const [a] = await tx<{ id: string }[]>`
      insert into public.integration_accounts (organization_id, connection_id, kind, external_id, name)
      values (${org}, ${c!.id}, 'ad_account', 'act_personal_1', 'Personal ad account') returning id`;
    await tx`insert into public.integration_campaign_links (organization_id, account_id, external_campaign_id, name)
      values (${org}, ${a!.id}, 'cmp_1', 'Personal campaign')`;
    await tx`select set_config('role', 'authenticated', true)`;
    return fn(tx, { connection: c!.id, account: a!.id });
  });
}

const count = async (tx: Tx, table: string, id: string, column = 'id') =>
  Number((await tx.unsafe(`select count(*)::int as n from public.${table} where ${column} = $1`, [id]))[0]!.n);

describe('personal connections', () => {
  it('the owner sees their connection, its ad account and campaigns', async () => {
    await withPersonal(OWNER, async (tx, ids) => {
      expect(await count(tx, 'integration_connections', ids.connection)).toBe(1);
      expect(await count(tx, 'integration_accounts', ids.account)).toBe(1);
      expect(await count(tx, 'integration_campaign_links', ids.account, 'account_id')).toBe(1);
      // Organization (non-personal) connections stay hidden from a specialist.
      const [{ n }] = (await tx<
        { n: number }[]
      >`select count(*)::int as n from public.integration_connections where owner_id is null`) as unknown as [{ n: number }];
      expect(n).toBe(0);
    });
  });

  it('other staff and client users see nothing', async () => {
    for (const email of [OTHER, CLIENT])
      await withPersonal(email, async (tx, ids) => {
        expect(await count(tx, 'integration_connections', ids.connection)).toBe(0);
        expect(await count(tx, 'integration_accounts', ids.account)).toBe(0);
        expect(await count(tx, 'integration_campaign_links', ids.account, 'account_id')).toBe(0);
      });
  });

  it('admins see every personal connection', async () => {
    await withPersonal(ADMIN, async (tx, ids) => {
      expect(await count(tx, 'integration_connections', ids.connection)).toBe(1);
      expect(await count(tx, 'integration_accounts', ids.account)).toBe(1);
    });
  });

  it('the owner maps an ad account only to a client they can reach', async () => {
    const reachable = await clientId('najd-heritage');
    const unreachable = await clientId('gulf-vision');
    await withPersonal(OWNER, async (tx, ids) => {
      const ok = await tx`update public.integration_accounts set client_id = ${reachable} where id = ${ids.account} returning id`;
      expect(ok).toHaveLength(1);
      await expect(
        tx.savepoint((sp) => sp`update public.integration_accounts set client_id = ${unreachable} where id = ${ids.account}`),
      ).rejects.toMatchObject({ code: '42501' });
    });
    await withPersonal(OTHER, async (tx, ids) => {
      const none = await tx`update public.integration_accounts set client_id = ${reachable} where id = ${ids.account} returning id`;
      expect(none).toHaveLength(0);
    });
  });

  it('losing integrations:connect hides the connection from its owner', async () => {
    await withPersonal(OWNER, async (tx, ids) => {
      await tx`select set_config('role', 'postgres', true)`;
      await tx`delete from public.role_permissions where permission_key = 'integrations:connect'
        and role_id in (select role_id from public.user_roles where user_id = ${await userId(OWNER)})`;
      await tx`select set_config('role', 'authenticated', true)`;
      expect(await count(tx, 'integration_connections', ids.connection)).toBe(0);
    });
  });

  it('reassign targets must hold integrations:connect', async () => {
    await as(ADMIN, async (tx) => {
      const [{ org }] = (await tx<{ org: string }[]>`
        select organization_id as org from public.organization_members where user_id = auth.uid() limit 1`) as unknown as [{ org: string }];
      const check = async (email: string) =>
        (await tx<{ ok: boolean }[]>`select app.member_has_permission(${org}, ${await userId(email)}, 'integrations:connect') as ok`)[0]!
          .ok;
      expect(await check(OTHER)).toBe(true);
      expect(await check('ruba@ofoq.test')).toBe(false); // sales rep
      expect(await check(CLIENT)).toBe(false);
    });
  });

  it('only integration managers reassign, and only to someone who can connect', async () => {
    const omar = await userId(OTHER);
    const ruba = await userId('ruba@ofoq.test');
    await withPersonal(ADMIN, async (tx, ids) => {
      const [row] = await tx<{ owner: string }[]>`
        update public.integration_connections set owner_id = ${omar} where id = ${ids.connection} returning owner_id as owner`;
      expect(row!.owner).toBe(omar);
      await expect(
        tx.savepoint((sp) => sp`update public.integration_connections set owner_id = ${ruba} where id = ${ids.connection}`),
      ).rejects.toMatchObject({ code: '42501' });
    });
    // The owner can't give it away (no update policy for owners: nothing is updated).
    await withPersonal(OWNER, async (tx, ids) => {
      const rows = await tx`update public.integration_connections set owner_id = ${omar} where id = ${ids.connection} returning id`;
      expect(rows).toHaveLength(0);
    });
  });
});

describe('expiry warning', () => {
  it('warns the owner once, seven days ahead, and again for a new expiry', async () => {
    const owner = await userId(OWNER);
    const [{ org }] = (await sql<{ org: string }[]>`
      select organization_id as org from public.organization_members where user_id = ${owner} limit 1`) as unknown as [{ org: string }];
    const [{ id }] = (await sql<{ id: string }[]>`
      insert into public.integration_connections (organization_id, provider, mode, name, status, scopes, settings, owner_id, token_expires_at)
      values (${org}, 'linkedin', 'sandbox', 'Expiring soon', 'connected', '{}', '{}', ${owner}, now() + interval '3 days')
      returning id`) as unknown as [{ id: string }];
    try {
      const warned = async () =>
        Number(
          (
            await sql<{ n: number }[]>`select count(*)::int as n from public.domain_events
            where type = 'integration.connection_expiring' and aggregate_id = ${id}`
          )[0]!.n,
        );
      await warnExpiringPersonal(new Date());
      expect(await warned()).toBe(1);
      await warnExpiringPersonal(new Date());
      expect(await warned()).toBe(1);
      // Too far away: nothing; a renewed token with a new expiry inside the window warns again.
      await sql`update public.integration_connections set token_expires_at = now() + interval '5 days' where id = ${id}`;
      await warnExpiringPersonal(new Date());
      expect(await warned()).toBe(2);

      await dispatchPendingEvents([integrationNotifications]);
      const notes = await sql<{ user_id: string }[]>`
        select user_id from public.notifications where type = 'integration_expiring' and link = '/settings/connections'
          and event_id in (select id from public.domain_events where aggregate_id = ${id})`;
      expect(notes.map((n) => n.user_id)).toEqual([owner, owner]);
    } finally {
      await sql`delete from public.notifications where event_id in (select id from public.domain_events where aggregate_id = ${id})`;
      await sql`delete from public.integration_connections where id = ${id}`;
    }
  });
});
