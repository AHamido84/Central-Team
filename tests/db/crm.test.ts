/**
 * Phase 6 CRM & capacity in Postgres: numbering and stage triggers (status, probability, won/lost stamps, history,
 * lost reason, converted deals stay won), activity → last contact, quote totals owned by the server, and RLS —
 * reps write their own records, managers anyone's, settings need `crm:admin`, client users see nothing, and the
 * capacity readers require `capacity:read`. Everything runs in rolled-back transactions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, attempt, sql, userId } from './helpers';

type Tx = Parameters<Parameters<typeof as>[1]>[0];

const MANAGER = 'majed@ofoq.test'; // sales_manager: crm:manage_all, crm:admin
const REP = 'ruba@ofoq.test'; // sales_rep: leads/deals manage (own)
const AM = 'noura@ofoq.test'; // account manager: leads:read, deals:read, capacity:read
const SPECIALIST = 'khalid@ofoq.test'; // no CRM, no capacity
const TEAM_LEAD = 'reem@ofoq.test'; // capacity:read + capacity:manage
const CLIENT = 'mohammed@najd.test';

let org: string;
let pipeline: string;
const stage: Record<number, string> = {};

beforeAll(async () => {
  const [p] = await sql<{ id: string; organization_id: string }[]>`select id, organization_id from public.pipelines where is_default`;
  pipeline = p!.id;
  org = p!.organization_id;
  const rows = await sql<
    { id: string; sort_order: number }[]
  >`select id, sort_order from public.pipeline_stages where pipeline_id = ${pipeline}`;
  for (const r of rows) stage[r.sort_order] = r.id;
});

afterAll(async () => {
  await sql.end();
});

async function newDeal(tx: Tx, values: Record<string, unknown> = {}) {
  const [d] =
    await tx`insert into public.deals ${tx({ organization_id: org, pipeline_id: pipeline, stage_id: stage[1], title: 'Test deal', value_minor: 1_000_000, ...values })} returning *`;
  return d!;
}

describe('numbering and stage triggers', () => {
  it('numbers leads and deals per organization and lower-cases lead email', async () => {
    const out = await as(REP, async (tx) => {
      const [max] = await tx`select coalesce(max(number), 0)::int as n from public.leads`;
      const [l] =
        await tx`insert into public.leads ${tx({ organization_id: org, full_name: 'Test Lead', email: 'MiXeD@Example.TEST', source: 'manual', owner_id: await userId(REP) })} returning number, email`;
      const [dmax] = await tx`select coalesce(max(number), 0)::int as n from public.deals`;
      const d = await newDeal(tx, { owner_id: await userId(REP) });
      return { lead: l!, leadMax: max!.n as number, deal: d, dealMax: dmax!.n as number };
    });
    expect(out.lead.number).toBe(out.leadMax + 1);
    expect(out.lead.email).toBe('mixed@example.test');
    expect(out.deal.number).toBe(out.dealMax + 1);
    expect(out.deal.status).toBe('open');
    expect(out.deal.probability).toBe(10);
  });

  it('derives status, probability and stamps from the stage and records history', async () => {
    const out = await as(MANAGER, async (tx) => {
      const d = await newDeal(tx);
      await tx`update public.deals set stage_id = ${stage[4]!} where id = ${d.id}`;
      const [mid] = await tx`select status, probability from public.deals where id = ${d.id}`;
      await tx`update public.deals set stage_id = ${stage[6]!} where id = ${d.id}`;
      const [won] = await tx`select status, probability, won_at, lost_at from public.deals where id = ${d.id}`;
      const history =
        await tx`select from_stage_id, to_stage_id from public.deal_stage_history where deal_id = ${d.id} order by created_at, id`;
      return { mid: mid!, won: won!, history };
    });
    expect(out.mid).toMatchObject({ status: 'open', probability: 60 });
    expect(out.won.status).toBe('won');
    expect(out.won.probability).toBe(100);
    expect(out.won.won_at).not.toBeNull();
    expect(out.won.lost_at).toBeNull();
    // One transaction shares one now(), so compare the from → to chain rather than the timestamps.
    expect(new Set(out.history.map((h) => `${h.from_stage_id}>${h.to_stage_id}`))).toEqual(
      new Set([`null>${stage[1]}`, `${stage[1]}>${stage[4]}`, `${stage[4]}>${stage[6]}`]),
    );
  });

  it('requires a reason to lose a deal', async () => {
    const err = await attempt(MANAGER, async (tx) => {
      const d = await newDeal(tx);
      await tx`update public.deals set stage_id = ${stage[7]!} where id = ${d.id}`;
    });
    expect(err).not.toBeNull();
    const ok = await attempt(MANAGER, async (tx) => {
      const d = await newDeal(tx);
      await tx`update public.deals set stage_id = ${stage[7]!}, lost_reason = 'price' where id = ${d.id}`;
    });
    expect(ok).toBeNull();
  });

  it('keeps a converted deal won', async () => {
    const [d] = await sql<{ id: string }[]>`select id from public.deals where converted_at is not null limit 1`;
    expect(d).toBeDefined();
    const err = await attempt(MANAGER, (tx) => tx`update public.deals set stage_id = ${stage[5]!} where id = ${d!.id}`);
    expect(err?.message).toContain('invalid_transition');
  });

  it('a completed activity counts as contact; a scheduled one does not', async () => {
    const out = await as(REP, async (tx) => {
      const me = await userId(REP);
      const [l] =
        await tx`insert into public.leads ${tx({ organization_id: org, full_name: 'Contact test', phone: '+966559990001', source: 'manual', owner_id: me })} returning id, status`;
      await tx`insert into public.crm_activities ${tx({ organization_id: org, lead_id: l!.id, type: 'call', subject: 'Later', due_at: new Date(Date.now() + 86_400_000).toISOString() })}`;
      const [afterScheduled] = await tx`select status from public.leads where id = ${l!.id}`;
      await tx`insert into public.crm_activities ${tx({ organization_id: org, lead_id: l!.id, type: 'call', subject: 'Called', completed_at: new Date().toISOString() })}`;
      const [afterDone] = await tx`select status from public.leads where id = ${l!.id}`;
      return { before: l!.status, afterScheduled: afterScheduled!.status, afterDone: afterDone!.status };
    });
    expect(out).toEqual({ before: 'new', afterScheduled: 'new', afterDone: 'contacted' });
  });

  it('computes quote totals on the server and ignores client-sent totals', async () => {
    const out = await as(MANAGER, async (tx) => {
      const d = await newDeal(tx);
      const [q] =
        await tx`insert into public.quotes ${tx({ organization_id: org, deal_id: d.id, title: 'Q', discount_minor: 50_000, total_minor: 1 })} returning id, total_minor`;
      await tx`insert into public.quote_items ${tx([
        { organization_id: org, quote_id: q!.id, description: 'A', quantity: 2, unit_price_minor: 100_000 },
        { organization_id: org, quote_id: q!.id, description: 'B', quantity: 1.5, unit_price_minor: 30_000 },
      ])}`;
      await tx`update public.quotes set total_minor = 5 where id = ${q!.id}`;
      const [after] = await tx`select subtotal_minor, total_minor from public.quotes where id = ${q!.id}`;
      return { inserted: q!.total_minor, after: after! };
    });
    expect(out.inserted).toBe(0);
    expect(out.after).toEqual({ subtotal_minor: 245_000, total_minor: 195_000 });
  });
});

describe('RLS', () => {
  it('reps read the pipeline but only change their own (or unassigned) deals; managers change any', async () => {
    const [majedDeal] = await sql<
      { id: string }[]
    >`select d.id from public.deals d join auth.users u on u.id = d.owner_id where u.email = ${MANAGER} and d.status = 'open' limit 1`;
    const [rubaDeal] = await sql<
      { id: string }[]
    >`select d.id from public.deals d join auth.users u on u.id = d.owner_id where u.email = ${REP} and d.status = 'open' limit 1`;
    const repView = await as(REP, async (tx) => {
      const [n] = await tx`select count(*)::int as n from public.deals`;
      const other = await tx`update public.deals set title = 'x' where id = ${majedDeal!.id} returning id`;
      const own = await tx`update public.deals set title = 'x' where id = ${rubaDeal!.id} returning id`;
      return { visible: n!.n as number, other: other.length, own: own.length };
    });
    const [all] = await sql<{ n: number }[]>`select count(*)::int as n from public.deals`;
    expect(repView.visible).toBe(all!.n);
    expect(repView).toMatchObject({ other: 0, own: 1 });
    const managerUpdate = await as(MANAGER, (tx) => tx`update public.deals set title = 'x' where id = ${rubaDeal!.id} returning id`);
    expect(managerUpdate).toHaveLength(1);
  });

  it('a rep cannot hand a new lead to someone else', async () => {
    const err = await attempt(
      REP,
      async (tx) =>
        tx`insert into public.leads ${tx({ organization_id: org, full_name: 'Not mine', phone: '+966559990002', source: 'manual', owner_id: await userId(MANAGER) })}`,
    );
    expect(err).not.toBeNull();
  });

  it('read-only CRM roles cannot write; people without CRM access see nothing', async () => {
    const am = await as(AM, async (tx) => {
      const [n] = await tx`select count(*)::int as n from public.leads`;
      return n!.n as number;
    });
    expect(am).toBeGreaterThan(0);
    expect(
      await attempt(
        AM,
        (tx) =>
          tx`insert into public.leads ${tx({ organization_id: org, full_name: 'AM lead', phone: '+966559990003', source: 'manual' })}`,
      ),
    ).not.toBeNull();
    const specialist = await as(SPECIALIST, async (tx) => {
      const [l] = await tx`select count(*)::int as n from public.leads`;
      const [d] = await tx`select count(*)::int as n from public.deals`;
      return [l!.n, d!.n];
    });
    expect(specialist).toEqual([0, 0]);
  });

  it('client users never see CRM data', async () => {
    const counts = await as(CLIENT, async (tx) => {
      const out: number[] = [];
      for (const t of [
        'leads',
        'deals',
        'deal_contacts',
        'crm_activities',
        'quotes',
        'quote_items',
        'lead_forms',
        'sales_targets',
        'crm_settings',
        'crm_files',
        'member_capacity',
        'time_off',
        'service_efforts',
      ]) {
        const [r] = await tx.unsafe(`select count(*)::int as n from public.${t}`);
        out.push(r!.n as number);
      }
      return out;
    });
    expect(counts.every((n) => n === 0)).toBe(true);
    expect(
      await attempt(
        CLIENT,
        (tx) => tx`insert into public.leads ${tx({ organization_id: org, full_name: 'x', phone: '+966559990004', source: 'manual' })}`,
      ),
    ).not.toBeNull();
  });

  it('settings need crm:admin', async () => {
    expect(
      await attempt(REP, (tx) =>
        tx`update public.crm_settings set stale_days = 3 where organization_id = ${org} returning 1`.then((r) => {
          if (!r.length) throw new Error('no rows');
        }),
      ),
    ).not.toBeNull();
    expect(
      await attempt(MANAGER, (tx) =>
        tx`update public.crm_settings set stale_days = 3 where organization_id = ${org} returning 1`.then((r) => {
          if (!r.length) throw new Error('no rows');
        }),
      ),
    ).toBeNull();
    expect(
      await attempt(
        REP,
        (tx) => tx`insert into public.sales_targets ${tx({ organization_id: org, month: '2030-01-01', amount_minor: 1 })}`,
      ),
    ).not.toBeNull();
  });

  it('the private crm-files bucket is agency-only', async () => {
    const [bucket] = await sql<{ public: boolean }[]>`select public from storage.buckets where id = 'crm-files'`;
    expect(bucket?.public).toBe(false);
  });
});

describe('capacity', () => {
  it('demand readers require capacity:read and return numbers only', async () => {
    expect((await attempt(SPECIALIST, (tx) => tx`select * from app.capacity_tasks(${org}::uuid)`))?.code).toBe('42501');
    expect((await attempt(CLIENT, (tx) => tx`select * from app.capacity_deals(${org}::uuid)`))?.code).toBe('42501');
    const lead = await as(TEAM_LEAD, async (tx) => {
      const tasks = await tx`select * from app.capacity_tasks(${org}::uuid)`;
      const packages = await tx`select * from app.capacity_packages(${org}::uuid, current_date)`;
      const deals = await tx`select * from app.capacity_deals(${org}::uuid)`;
      return { tasks, packages, deals };
    });
    expect(lead.tasks.length).toBeGreaterThan(0);
    expect(lead.packages.length).toBeGreaterThan(0);
    expect(lead.deals.length).toBeGreaterThan(0);
    expect(Object.keys(lead.deals[0]!)).toEqual(['deal_id', 'probability', 'expected_close_date', 'item_type', 'quantity']);
  });

  it('hours and time off are writable with capacity:manage only', async () => {
    const khalid = await userId(SPECIALIST);
    expect(
      await attempt(
        TEAM_LEAD,
        (tx) =>
          tx`insert into public.member_capacity ${tx({ organization_id: org, user_id: khalid, hours_per_week: 35 })} on conflict (organization_id, user_id) do update set hours_per_week = 35`,
      ),
    ).toBeNull();
    expect(
      await attempt(
        AM,
        (tx) =>
          tx`insert into public.time_off ${tx({ organization_id: org, user_id: khalid, start_date: '2030-01-01', end_date: '2030-01-02' })}`,
      ),
    ).not.toBeNull();
    // Only agency members can have capacity rows.
    const client = await userId(CLIENT);
    expect(
      (
        await attempt(
          TEAM_LEAD,
          (tx) =>
            tx`insert into public.time_off ${tx({ organization_id: org, user_id: client, start_date: '2030-01-01', end_date: '2030-01-02' })}`,
        )
      )?.message,
    ).toContain('invalid_assignee');
    // Everyone sees their own time off.
    const own = await as(
      SPECIALIST,
      async (tx) => (await tx`select count(*)::int as n from public.time_off where user_id = ${khalid}`)[0]!.n as number,
    );
    expect(own).toBeGreaterThan(0);
  });
});
