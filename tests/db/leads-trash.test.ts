/**
 * Feedback Round 5 (ADR-094): leads go to the Trash. Who may delete / purge, what disappears with a lead, what stays
 * (deals), restore and purge, and the service paths that bypass RLS (intake dedup).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dbAdmin } from '@/lib/db/client';
import { ingestLead } from '@/modules/crm/server/intake';

import { as, attempt, sql, userId } from './helpers';

const ADMIN = 'faisal@ofoq.test';
const SALES_MANAGER = 'majed@ofoq.test';
const SALES_REP = 'ruba@ofoq.test';
const ACCOUNT_MANAGER = 'noura@ofoq.test';

let org: string;
/** A live lead with activities of its own. */
let withActivities: string;
/** A lead a deal came from. */
let withDeal: string;
let dealId: string;

type Tx = Parameters<Parameters<typeof as>[1]>[0];
const become = async (tx: Tx, email: string) => {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: await userId(email), role: 'authenticated' })}, true)`;
};

beforeAll(async () => {
  const [a] = await sql<{ id: string; organization_id: string }[]>`
    select l.id, l.organization_id from public.leads l
    where l.status not in ('merged', 'converted') and l.deleted_at is null
      and exists (select 1 from public.crm_activities x where x.lead_id = l.id and x.deal_id is null)
    order by l.number limit 1`;
  withActivities = a!.id;
  org = a!.organization_id;
  const [d] = await sql<{ id: string; lead_id: string }[]>`
    select d.id, d.lead_id from public.deals d join public.leads l on l.id = d.lead_id
    where l.deleted_at is null order by d.number limit 1`;
  dealId = d!.id;
  withDeal = d!.lead_id;
});

afterAll(async () => {
  await sql.end();
  await (dbAdmin as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe('who may delete leads', () => {
  const can = (email: string, action: 'delete' | 'purge') =>
    as(email, async (tx) => (await tx`select app.trash_can('lead', ${withActivities}, ${action}) as ok`)[0]!.ok as boolean);

  it('Admin deletes and purges; Sales Manager deletes only', async () => {
    expect(await can(ADMIN, 'delete')).toBe(true);
    expect(await can(ADMIN, 'purge')).toBe(true);
    expect(await can(SALES_MANAGER, 'delete')).toBe(true);
    expect(await can(SALES_MANAGER, 'purge')).toBe(false);
  });

  it('a Sales Rep and an Account Manager may not delete', async () => {
    expect(await can(SALES_REP, 'delete')).toBe(false);
    expect(await can(ACCOUNT_MANAGER, 'delete')).toBe(false);
    const denied = await attempt(SALES_REP, (tx) => tx`select app.trash_delete('lead', ${withActivities})`);
    expect(denied?.code).toBe('42501');
  });

  it('a plain DELETE no longer removes a lead (only the Trash does)', async () => {
    const n = await as(ADMIN, async (tx) => (await tx`delete from public.leads where id = ${withActivities} returning id`).length);
    expect(n).toBe(0);
  });
});

describe('a deleted lead', () => {
  it('disappears with its own activities, for everyone, and can no longer be written', async () => {
    const r = await as(SALES_MANAGER, async (tx) => {
      const impact = (await tx`select app.trash_impact('lead', ${withActivities}) as i`)[0]!.i as { counts: Record<string, number> };
      await tx`select app.trash_delete('lead', ${withActivities})`;
      const out = {
        impact,
        manager: (await tx`select count(*)::int as n from public.leads where id = ${withActivities}`)[0]!.n as number,
        activities: (await tx`select count(*)::int as n from public.crm_activities where lead_id = ${withActivities}`)[0]!.n as number,
        writable: (await tx`select app.can_write_lead(${withActivities}) as ok`)[0]!.ok as boolean,
        update: (await tx`update public.leads set notes = 'x' where id = ${withActivities} returning id`).length,
        rep: 0,
      };
      await become(tx, SALES_REP);
      out.rep = (await tx`select count(*)::int as n from public.leads where id = ${withActivities}`)[0]!.n as number;
      return out;
    });
    expect(r.impact.counts.activities).toBeGreaterThan(0);
    expect(r).toMatchObject({ manager: 0, activities: 0, writable: false, update: 0, rep: 0 });
  });

  it('keeps the deals that came from it (with their link, for a restore)', async () => {
    const r = await as(ADMIN, async (tx) => {
      await tx`select app.trash_delete('lead', ${withDeal})`;
      const [deal] = await tx`select id, lead_id from public.deals where id = ${dealId}`;
      return deal;
    });
    expect(r).toMatchObject({ id: dealId, lead_id: withDeal });
  });

  it('shows in the Trash for people who may delete leads, not for a Sales Rep', async () => {
    const r = await as(SALES_MANAGER, async (tx) => {
      const batch = (await tx`select app.trash_delete('lead', ${withActivities}) as b`)[0]!.b as string;
      await tx`select set_config('app.trash_mode', 'on', true)`;
      const manager = (await tx`select count(*)::int as n from public.trash_items where batch = ${batch}`)[0]!.n as number;
      const inTrashView = (await tx`select count(*)::int as n from public.leads where id = ${withActivities}`)[0]!.n as number;
      await become(tx, SALES_REP);
      const rep = (await tx`select count(*)::int as n from public.trash_items where batch = ${batch}`)[0]!.n as number;
      return { manager, inTrashView, rep };
    });
    expect(r).toEqual({ manager: 1, inTrashView: 1, rep: 0 });
  });

  it('comes back intact on restore', async () => {
    const r = await as(SALES_MANAGER, async (tx) => {
      const before = (await tx`select count(*)::int as n from public.crm_activities where lead_id = ${withActivities}`)[0]!.n as number;
      const batch = (await tx`select app.trash_delete('lead', ${withActivities}) as b`)[0]!.b as string;
      await tx`select app.trash_restore(${batch})`;
      return {
        before,
        lead: (await tx`select count(*)::int as n from public.leads where id = ${withActivities}`)[0]!.n as number,
        after: (await tx`select count(*)::int as n from public.crm_activities where lead_id = ${withActivities}`)[0]!.n as number,
      };
    });
    expect(r.lead).toBe(1);
    expect(r.after).toBe(r.before);
  });

  it('purge (Admin only) removes it for good; the deal and its activities stay', async () => {
    const r = await as(ADMIN, async (tx) => {
      // An activity on both the lead and its deal: it belongs to the deal's history too.
      await tx`select set_config('role', 'postgres', true)`;
      const [shared] = await tx`insert into public.crm_activities (organization_id, lead_id, deal_id, type, subject)
        values (${org}, ${withDeal}, ${dealId}, 'note', 'shared') returning id`;
      await tx`select set_config('role', 'authenticated', true)`;
      const batch = (await tx`select app.trash_delete('lead', ${withDeal}) as b`)[0]!.b as string;
      await become(tx, SALES_MANAGER);
      const managerPurge = await tx
        .savepoint((sp) => sp`select app.trash_purge(${batch})`)
        .then(() => 'ok')
        .catch((e: { code?: string }) => e.code);
      await become(tx, ADMIN);
      await tx`select app.trash_purge(${batch})`;
      await tx`select set_config('role', 'postgres', true)`;
      return {
        managerPurge,
        lead: (await tx`select count(*)::int as n from public.leads where id = ${withDeal}`)[0]!.n as number,
        deal: (await tx`select lead_id from public.deals where id = ${dealId}`)[0] as { lead_id: string | null } | undefined,
        shared: (await tx`select lead_id, deal_id from public.crm_activities where id = ${shared!.id}`)[0] as
          { lead_id: string | null; deal_id: string } | undefined,
      };
    });
    expect(r.managerPurge).toBe('42501');
    expect(r.lead).toBe(0);
    expect(r.deal).toEqual({ lead_id: null });
    expect(r.shared).toEqual({ lead_id: null, deal_id: dealId });
  });
});

describe('service paths skip deleted leads', () => {
  it('a new submission from a deleted lead’s contact starts a fresh lead', async () => {
    const email = `trash-intake-${Date.now()}@example.test`;
    const [old] = await sql<{ id: string }[]>`
      insert into public.leads (organization_id, full_name, email, source, deleted_at)
      values (${org}, 'Deleted Lead', ${email}, 'website_form', now()) returning id`;
    try {
      const r = await ingestLead(
        org,
        {
          fullName: 'Fresh Lead',
          company: null,
          phone: null,
          email,
          source: 'website_form',
          sourceDetail: null,
          services: [],
          budgetRange: 'unknown',
          city: null,
          ownerId: null,
          tags: [],
          notes: '',
          message: 'Hello again',
        },
        'form',
      );
      expect(r.duplicate).toBe(false);
      expect(r.leadId).not.toBe(old!.id);
    } finally {
      await sql`delete from public.domain_events where aggregate_id in (select id from public.leads where email = ${email})`;
      await sql`delete from public.leads where email = ${email}`;
    }
  });
});
