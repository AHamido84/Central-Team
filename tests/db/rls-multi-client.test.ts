/**
 * Feedback Round 4 security (ADR-091/092/093): one portal user in several clients. RLS stays per client and the
 * selected client (`app.active_client`) narrows every portal read and right to that one client.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, attempt, clientId, sql, userId } from './helpers';

const HALA = 'hala@group.test'; // Owner of Darb (approves), Member of Future Smile (approves), Viewer of Najd.
const DARB_OWNER = 'yasser@darb.test';
const NAJD_OWNER = 'mohammed@najd.test';

let darb: string;
let najd: string;
let smile: string;
let gulf: string;
let hala: string;

beforeAll(async () => {
  [darb, najd, smile, gulf] = await Promise.all([
    clientId('darb-coffee'),
    clientId('najd-heritage'),
    clientId('future-smile'),
    clientId('gulf-vision'),
  ]);
  hala = await userId(HALA);
});

afterAll(async () => {
  await sql.end();
});

const requestClients = (active?: string) =>
  as(HALA, async (tx) => (await tx`select distinct client_id from public.requests`).map((r) => r.client_id as string).sort(), active);

describe('active client scoping', () => {
  it('without a selection the user sees each of their clients (and only those)', async () => {
    const ids = await as(HALA, async (tx) => (await tx`select id from public.clients`).map((r) => r.id as string));
    expect(ids.sort()).toEqual([darb, najd, smile].sort());
  });

  it("with A selected only A's data is readable", async () => {
    expect(await requestClients(darb)).toEqual([darb]);
    expect(await requestClients(najd)).toEqual([najd]);
    const other = await as(
      HALA,
      async (tx) => ({
        files: (await tx`select count(*)::int as n from public.files where client_id <> ${darb}`)[0]!.n,
        threads: (await tx`select count(*)::int as n from public.threads where client_id <> ${darb}`)[0]!.n,
        clients: (await tx`select count(*)::int as n from public.clients where id <> ${darb}`)[0]!.n,
      }),
      darb,
    );
    expect(other).toEqual({ files: 0, threads: 0, clients: 0 });
  });

  it('selecting a client the user does not belong to shows nothing', async () => {
    expect(await requestClients(gulf)).toEqual([]);
  });

  it('the switcher list (my_portal_clients) ignores the selection', async () => {
    const rows = await as(HALA, (tx) => tx`select client_id, role_key, can_approve from app.my_portal_clients()`, darb);
    expect(rows.map((r) => r.client_id).sort()).toEqual([darb, najd, smile].sort());
  });

  it('the last used client can only be one of their own', async () => {
    const own = await as(HALA, async (tx) => (await tx`select app.touch_portal_client(${najd}) as ok`)[0]!.ok);
    const other = await as(HALA, async (tx) => (await tx`select app.touch_portal_client(${gulf}) as ok`)[0]!.ok);
    expect(own).toBe(true);
    expect(other).toBe(false);
  });
});

describe('approval rights are per client', () => {
  const canApprove = (client: string, active?: string) =>
    as(HALA, async (tx) => (await tx`select app.can_approve_for(${client}) as ok`)[0]!.ok as boolean, active);

  it('approves where the membership allows it, with that client selected', async () => {
    expect(await canApprove(darb, darb)).toBe(true);
    expect(await canApprove(smile, smile)).toBe(true);
  });

  it('cannot approve in B with the approval right only in A', async () => {
    expect(await canApprove(najd, najd)).toBe(false);
    expect(await canApprove(najd, darb)).toBe(false);
  });

  it('cannot approve in another client than the selected one', async () => {
    expect(await canApprove(smile, darb)).toBe(false);
  });
});

describe('removal from one client is immediate', () => {
  it('a deactivated membership stops reads on the next query; the other clients stay', async () => {
    const result = await as(HALA, async (tx) => {
      // An admin removes her (as the owner role, without her claims: nobody may change their own membership).
      await tx`select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true)`;
      await tx`update public.client_users set status = 'deactivated' where user_id = ${hala} and client_id = ${najd}`;
      await tx`select set_config('role', 'authenticated', true),
        set_config('request.jwt.claims', ${JSON.stringify({ sub: hala, role: 'authenticated' })}, true)`;
      return {
        najd: (await tx`select count(*)::int as n from public.requests where client_id = ${najd}`)[0]!.n,
        clients: (await tx`select client_id from app.my_portal_clients()`).map((r) => r.client_id as string).sort(),
      };
    });
    expect(result.najd).toBe(0);
    expect(result.clients).toEqual([darb, smile].sort());
  });
});

describe("an Owner sees only their own client's membership", () => {
  it("Owner of A doesn't see the person's membership in B", async () => {
    const darbView = await as(DARB_OWNER, (tx) => tx`select client_id from public.client_users where user_id = ${hala}`, darb);
    const najdView = await as(NAJD_OWNER, (tx) => tx`select client_id from public.client_users where user_id = ${hala}`, najd);
    expect(darbView.map((r) => r.client_id)).toEqual([darb]);
    expect(najdView.map((r) => r.client_id)).toEqual([najd]);
  });
});

describe('per-client notification preferences', () => {
  it('own clients only — any of them, not just the selected one', async () => {
    const org = (await sql`select organization_id from public.clients where id = ${darb}`)[0]!.organization_id as string;
    const insert = (client: string) =>
      attempt(
        HALA,
        (tx) => tx`insert into public.notification_client_preferences (user_id, organization_id, client_id, category, in_app, email)
          values (${hala}, ${org}, ${client}, 'requests', true, false)`,
        darb,
      );
    expect(await insert(najd)).toBeNull();
    expect((await insert(gulf))?.code).toBe('42501');
  });

  it("nobody reads another person's overrides", async () => {
    const n = await as(DARB_OWNER, async (tx) => {
      await tx`select set_config('role', 'postgres', true)`;
      const org = (await tx`select organization_id from public.clients where id = ${darb}`)[0]!.organization_id as string;
      await tx`insert into public.notification_client_preferences (user_id, organization_id, client_id, category, in_app, email)
        values (${hala}, ${org}, ${darb}, 'requests', true, false)`;
      await tx`select set_config('role', 'authenticated', true)`;
      return (await tx`select count(*)::int as n from public.notification_client_preferences`)[0]!.n;
    });
    expect(n).toBe(0);
  });
});

describe('portal email change (ADR-092)', () => {
  const allowed = (email: string, target: string) =>
    as(email, async (tx) => (await tx`select app.can_update_portal_email(${target}) as ok`)[0]!.ok as boolean);

  it('Super Admin, Admin and the Account Manager of one of their clients may change it', async () => {
    expect(await allowed('sara@ofoq.test', hala)).toBe(true);
    expect(await allowed('faisal@ofoq.test', hala)).toBe(true);
    expect(await allowed('noura@ofoq.test', hala)).toBe(true); // AM of Najd and Darb
    expect(await allowed('abdulrahman@ofoq.test', hala)).toBe(true); // AM of Future Smile
  });

  it("an Account Manager of none of the person's clients, a specialist or a Client Owner may not", async () => {
    expect(await allowed('noura@ofoq.test', await userId('sultan@gulfvision.test'))).toBe(false);
    expect(await allowed('khalid@ofoq.test', hala)).toBe(false);
    expect(await allowed(DARB_OWNER, hala)).toBe(false);
  });

  it('never applies to an agency team member', async () => {
    expect(await allowed('sara@ofoq.test', await userId('noura@ofoq.test'))).toBe(false);
  });

  it('confirmation tokens: no direct writes, and the hash is never readable', async () => {
    const org = (await sql`select organization_id from public.clients where id = ${darb}`)[0]!.organization_id as string;
    const write = await attempt(
      'faisal@ofoq.test',
      (
        tx,
      ) => tx`insert into public.portal_email_changes (organization_id, user_id, from_email, to_email, token_hash, expires_at, requested_by)
        values (${org}, ${hala}, ${HALA}, 'x@example.test', 'h', now() + interval '1 day', ${hala})`,
    );
    expect(write?.code).toBe('42501');
    const hash = await attempt('faisal@ofoq.test', (tx) => tx`select token_hash from public.portal_email_changes`);
    expect(hash?.code).toBe('42501');
    const own = await attempt(HALA, (tx) => tx`select id from public.portal_email_changes`);
    expect(own).toBeNull();
  });
});
