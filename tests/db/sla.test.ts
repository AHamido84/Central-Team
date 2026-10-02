/**
 * Phase 5 SLA: the SQL working calendar matches its TypeScript mirror, requests get their policy targets at submit,
 * waiting on the client pauses the clock, SLA columns are server-owned, and policies / holidays / breaches follow
 * RLS (agency only, `sla:manage` to write, acknowledgement only) — proven against Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addBusinessHours, addWorkingDays, workingDaysBetween, type WorkCalendar } from '@/modules/sla/calendar';
import { matchPolicy, type PolicyCriteria } from '@/modules/sla/constants';

import { as, attempt, clientId, sql, userId } from './helpers';

type Tx = Parameters<Parameters<typeof as>[1]>[0];

const NAJD_OWNER = 'mohammed@najd.test';
const NAJD_MEMBER = 'abeer@najd.test';
const AM = 'noura@ofoq.test'; // Najd account manager: operations:read, requests:triage, no sla:manage
const SPECIALIST = 'khalid@ofoq.test'; // Najd team: requests:read, no operations:read
const ADMIN = 'faisal@ofoq.test'; // sla:manage
const OTHER_AM = 'abdulrahman@ofoq.test'; // no access to Najd

let najd: string;
let org: string;
const types: Record<string, string> = {};

beforeAll(async () => {
  najd = await clientId('najd-heritage');
  const rows = await sql<{ id: string; key: string; organization_id: string }[]>`select id, key, organization_id from public.request_types`;
  for (const r of rows) types[r.key] = r.id;
  org = rows[0]!.organization_id;
});

afterAll(async () => {
  await sql.end();
});

/** Become the table owner with no JWT (a system change) inside the same transaction. */
const asSystem = (tx: Tx) => tx`select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true)`;
async function actAs(tx: Tx, email: string) {
  const sub = await userId(email);
  await tx`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${JSON.stringify({ sub, role: 'authenticated' })}, true)`;
}
const withReason = (tx: Tx, reason: string) => tx`select set_config('app.transition_reason', ${reason}, true)`;

async function insertPolicy(tx: Tx, values: Record<string, unknown>) {
  const [p] =
    await tx`insert into public.sla_policies ${tx({ organization_id: org, name: { ar: 'اختبار', en: 'Test' }, ...values })} returning *`;
  return p!;
}

describe('working calendar (SQL ↔ TypeScript)', () => {
  it('adds working days, counts them and adds business hours the same way, holidays included', async () => {
    const result = await as(ADMIN, async (tx) => {
      await tx`insert into public.holidays (organization_id, date, name) values
        (${org}, '2026-10-04', '{"ar":"عطلة","en":"Holiday"}'), (${org}, '2026-12-01', '{"ar":"عطلة","en":"Holiday"}')
        on conflict do nothing`;
      const [o] = await tx`select default_timezone, business_hours_start, business_hours_end from public.organizations where id = ${org}`;
      const holidays = (await tx`select date::text as d from public.holidays where organization_id = ${org}`).map((r) => r.d as string);
      const instants = [
        '2026-09-29T07:00:00Z',
        '2026-09-29T19:00:00Z',
        '2026-10-01T13:00:00Z',
        '2026-11-30T14:59:00Z',
        '2026-10-02T09:00:00Z',
      ];
      const hours = [1, 4, 8, 13, 40];
      const sqlHours: string[] = [];
      for (const at of instants)
        for (const h of hours) {
          const [row] = await tx`select app.org_add_business_hours(${org}, ${at}::timestamptz, ${h}) as v`;
          sqlHours.push(new Date(row!.v as string).toISOString());
        }
      const days = ['2026-09-29', '2026-10-01', '2026-11-30'];
      const sqlDays: string[] = [];
      const sqlBetween: number[] = [];
      for (const d of days)
        for (const n of [1, 3, 10]) {
          const [row] = await tx`select app.org_add_working_days(${org}, ${d}::date, ${n}::int)::text as v,
            app.org_working_days_between(${org}, ${d}::date, (${d}::date + ${n}::int))::int as b`;
          sqlDays.push(row!.v as string);
          sqlBetween.push(row!.b as number);
        }
      return { o: o!, holidays, instants, hours, sqlHours, days, sqlDays, sqlBetween };
    });
    const cal: WorkCalendar = {
      timeZone: result.o.default_timezone as string,
      startMinute: result.o.business_hours_start as number,
      endMinute: result.o.business_hours_end as number,
      holidays: new Set(result.holidays),
    };
    const tsHours = result.instants.flatMap((at) => result.hours.map((h) => addBusinessHours(new Date(at), h, cal)!.toISOString()));
    expect(tsHours).toEqual(result.sqlHours);
    const tsDays = result.days.flatMap((d) => [1, 3, 10].map((n) => addWorkingDays(d, n, cal)));
    expect(tsDays).toEqual(result.sqlDays);
    const shift = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const tsBetween = result.days.flatMap((d) => [1, 3, 10].map((n) => workingDaysBetween(d, shift(d, n), cal)));
    expect(tsBetween).toEqual(result.sqlBetween);
  });

  it('policy resolution in SQL matches matchPolicy()', async () => {
    const out = await as(ADMIN, async (tx) => {
      await tx`update public.sla_policies set is_active = false where organization_id = ${org}`;
      const def = await insertPolicy(tx, {});
      const urgent = await insertPolicy(tx, { priority: 'urgent' });
      const reel = await insertPolicy(tx, { request_type_id: types['reel-video'] });
      const client = await insertPolicy(tx, { client_id: najd, sort_order: 1 });
      const clientFirst = await insertPolicy(tx, { client_id: najd, sort_order: 0 });
      const policies = (await tx`select * from public.sla_policies where organization_id = ${org}`).map((p): PolicyCriteria => ({
        id: p.id as string,
        clientId: p.client_id as string | null,
        requestTypeId: p.request_type_id as string | null,
        priority: p.priority as PolicyCriteria['priority'],
        isActive: p.is_active as boolean,
        sortOrder: p.sort_order as number,
        createdAt: new Date(p.created_at as string).toISOString(),
      }));
      const cases = [
        { clientId: najd, requestTypeId: types['social-post']!, priority: 'normal' as const },
        { clientId: await clientId('darb-coffee'), requestTypeId: types['social-post']!, priority: 'urgent' as const },
        { clientId: await clientId('darb-coffee'), requestTypeId: types['reel-video']!, priority: 'urgent' as const },
        { clientId: await clientId('darb-coffee'), requestTypeId: types['story']!, priority: 'low' as const },
      ];
      const fromSql: (string | null)[] = [];
      for (const c of cases) {
        const [row] = await tx`select (app.sla_policy_for(${org}, ${c.clientId}, ${c.requestTypeId}, ${c.priority})).id as id`;
        fromSql.push(row!.id as string | null);
      }
      return {
        ids: { def: def.id, urgent: urgent.id, reel: reel.id, client: client.id, clientFirst: clientFirst.id },
        policies,
        cases,
        fromSql,
      };
    });
    expect(out.fromSql).toEqual([out.ids.clientFirst, out.ids.urgent, out.ids.reel, out.ids.def]);
    expect(out.cases.map((c) => matchPolicy(out.policies, c)?.id ?? null)).toEqual(out.fromSql);
  });
});

describe('request targets', () => {
  it('a submitted request gets the policy, a business-hours response target and a working-day due date', async () => {
    const row = await as(ADMIN, async (tx) => {
      const p = await insertPolicy(tx, { client_id: najd, request_type_id: types['social-post'], response_hours: 4, resolution_days: 2 });
      await actAs(tx, NAJD_MEMBER);
      const [r] = await tx`insert into public.requests (organization_id, client_id, request_type_id, title, status)
        values (${org}, ${najd}, ${types['social-post']!}, 'طلب بسياسة', 'submitted') returning *`;
      const [expected] = await tx`select app.org_add_business_hours(${org}, ${r!.submitted_at}, 4) as response,
        app.org_add_working_days(${org}, (${r!.submitted_at}::timestamptz at time zone 'Asia/Riyadh')::date, 2)::text as due`;
      return { r: r!, p, expected: expected! };
    });
    expect(row.r.sla_policy_id).toBe(row.p.id);
    expect(new Date(row.r.response_due_at).toISOString()).toBe(new Date(row.expected.response).toISOString());
    expect(new Date(row.r.due_date).toISOString().slice(0, 10) <= row.expected.due).toBe(true);
    const [due] = await sql`select ${row.r.due_date}::date::text as d`;
    expect(due!.d).toBe(row.expected.due);
  });

  it('without a matching policy there is no response target and the type SLA still sets the due date', async () => {
    const r = await as(ADMIN, async (tx) => {
      await tx`update public.sla_policies set is_active = false where organization_id = ${org}`;
      await actAs(tx, NAJD_MEMBER);
      const [row] = await tx`insert into public.requests (organization_id, client_id, request_type_id, title, status)
        values (${org}, ${najd}, ${types['social-post']!}, 'طلب بدون سياسة', 'submitted') returning sla_policy_id, response_due_at, due_date::text as due`;
      return row!;
    });
    expect(r.sla_policy_id).toBeNull();
    expect(r.response_due_at).toBeNull();
    expect(r.due).not.toBeNull();
  });

  it('SLA columns are server-owned: crafted values are ignored on insert and update', async () => {
    const r = await as(ADMIN, async (tx) => {
      await tx`update public.sla_policies set is_active = false where organization_id = ${org}`;
      await actAs(tx, NAJD_MEMBER);
      const [ins] =
        await tx`insert into public.requests (organization_id, client_id, request_type_id, title, status, response_due_at, sla_paused_days)
        values (${org}, ${najd}, ${types['social-post']!}, 'طلب', 'submitted', '2099-01-01', 9) returning *`;
      await actAs(tx, AM);
      await tx`update public.requests set response_due_at = '2099-01-01', sla_paused_days = 7, sla_paused_at = now() where id = ${ins!.id}`;
      const [after] = await tx`select response_due_at, sla_paused_days, sla_paused_at from public.requests where id = ${ins!.id}`;
      return { ins: ins!, after: after! };
    });
    expect(r.ins.response_due_at).toBeNull();
    expect(r.ins.sla_paused_days).toBe(0);
    expect(r.after).toEqual({ response_due_at: null, sla_paused_days: 0, sla_paused_at: null });
  });

  it('waiting on the client pauses the clock and resuming extends the due date by the working days waited', async () => {
    const out = await as(ADMIN, async (tx) => {
      const p = await insertPolicy(tx, { client_id: najd, resolution_days: 5, pause_on_client: true });
      await actAs(tx, NAJD_MEMBER);
      const [r] = await tx`insert into public.requests (organization_id, client_id, request_type_id, title, status)
        values (${org}, ${najd}, ${types['social-post']!}, 'طلب للإيقاف', 'submitted') returning *`;
      await actAs(tx, AM);
      await tx`update public.requests set status = 'under_review' where id = ${r!.id}`;
      await withReason(tx, 'نحتاج الشعار');
      await tx`update public.requests set status = 'needs_info' where id = ${r!.id}`;
      const [paused] = await tx`select sla_paused_at, due_date::text as due from public.requests where id = ${r!.id}`;
      // Pretend the client took a while: move the pause start back (a system change).
      await asSystem(tx);
      await tx`update public.requests set sla_paused_at = now() - interval '6 days' where id = ${r!.id}`;
      const [expected] = await tx`select app.org_working_days_between(${org},
          ((now() - interval '6 days') at time zone 'Asia/Riyadh')::date, (now() at time zone 'Asia/Riyadh')::date) as n`;
      await actAs(tx, NAJD_MEMBER);
      await tx`update public.requests set status = 'under_review' where id = ${r!.id}`;
      const [resumed] = await tx`select sla_paused_at, sla_paused_days, due_date::text as due from public.requests where id = ${r!.id}`;
      const [shouldBe] = await tx`select app.org_add_working_days(${org}, ${paused!.due}::date, ${expected!.n as number})::text as d`;
      const [event] =
        await tx`select actor_side, actor_id from public.request_events where request_id = ${r!.id} and type = 'due_date_changed'`;
      return { p, paused: paused!, resumed: resumed!, n: expected!.n as number, shouldBe: shouldBe!.d as string, event };
    });
    expect(out.paused.sla_paused_at).not.toBeNull();
    expect(out.n).toBeGreaterThan(0);
    expect(out.resumed.sla_paused_at).toBeNull();
    expect(out.resumed.sla_paused_days).toBe(out.n);
    expect(out.resumed.due).toBe(out.shouldBe);
    expect(out.event).toMatchObject({ actor_side: 'system', actor_id: null });
  });

  it('policies that do not pause leave the due date alone', async () => {
    const r = await as(ADMIN, async (tx) => {
      await insertPolicy(tx, { client_id: najd, resolution_days: 5, pause_on_client: false });
      await actAs(tx, NAJD_MEMBER);
      const [req] = await tx`insert into public.requests (organization_id, client_id, request_type_id, title, status)
        values (${org}, ${najd}, ${types['social-post']!}, 'طلب', 'submitted') returning id`;
      await actAs(tx, AM);
      await withReason(tx, 'سؤال');
      await tx`update public.requests set status = 'needs_info' where id = ${req!.id}`;
      const [row] = await tx`select sla_paused_at from public.requests where id = ${req!.id}`;
      return row!;
    });
    expect(r.sla_paused_at).toBeNull();
  });
});

describe('RLS', () => {
  it('policies and holidays: agency members read, only sla:manage writes, clients see nothing', async () => {
    const seen = await as(NAJD_OWNER, async (tx) => ({
      policies: (await tx`select count(*)::int as n from public.sla_policies`)[0]!.n,
      holidays: (await tx`select count(*)::int as n from public.holidays`)[0]!.n,
      breaches: (await tx`select count(*)::int as n from public.sla_breaches`)[0]!.n,
    }));
    expect(seen).toEqual({ policies: 0, holidays: 0, breaches: 0 });

    expect(await attempt(ADMIN, (tx) => insertPolicy(tx, {}))).toBeNull();
    expect(
      await attempt(
        ADMIN,
        (tx) => tx`insert into public.holidays (organization_id, date, name) values (${org}, '2031-01-01', '{"ar":"س","en":"x"}')`,
      ),
    ).toBeNull();
    const amInsert = await attempt(AM, (tx) => insertPolicy(tx, {}));
    expect(amInsert?.code).toBe('42501');
    const amHoliday = await attempt(
      AM,
      (tx) => tx`insert into public.holidays (organization_id, date, name) values (${org}, '2031-01-01', '{"ar":"س","en":"x"}')`,
    );
    expect(amHoliday?.code).toBe('42501');
    const clientInsert = await attempt(NAJD_OWNER, (tx) => insertPolicy(tx, {}));
    expect(clientInsert?.code).toBe('42501');
    const amRead = await as(AM, async (tx) => (await tx`select count(*)::int as n from public.sla_policies`)[0]!.n);
    const total = (await sql`select count(*)::int as n from public.sla_policies`)[0]!.n;
    expect(amRead).toBe(total);
  });

  it('policies reject request types or escalation people from outside the organization', async () => {
    const outsider = await userId(NAJD_OWNER);
    const bad = await attempt(ADMIN, (tx) => insertPolicy(tx, { escalate_to: outsider }));
    expect(bad?.message).toContain('invalid_assignee');
  });

  it('business hours: only sla:manage may change them', async () => {
    expect(await attempt(ADMIN, (tx) => tx`select app.set_business_hours(${org}, 480, 960)`)).toBeNull();
    expect((await attempt(AM, (tx) => tx`select app.set_business_hours(${org}, 480, 960)`))?.code).toBe('42501');
    expect((await attempt(ADMIN, (tx) => tx`select app.set_business_hours(${org}, 960, 480)`))?.code).toBe('23514');
  });

  it('breaches: readable with request access, only acknowledgement is writable, stamped by the server', async () => {
    const [req] = await sql<{ id: string }[]>`select id from public.requests where client_id = ${najd} and status <> 'draft' limit 1`;
    const out = await as(ADMIN, async (tx) => {
      await asSystem(tx);
      const [b] = await tx`insert into public.sla_breaches (organization_id, client_id, request_id, kind, level, due_at)
        values (${org}, ${najd}, ${req!.id}, 'resolution', 'breached', now() - interval '1 day')
        on conflict (request_id, kind, level) do update set acknowledged_at = null, acknowledged_by = null, note = null
        returning id`;
      await actAs(tx, AM);
      const amSees = (await tx`select count(*)::int as n from public.sla_breaches where id = ${b!.id}`)[0]!.n;
      await tx`update public.sla_breaches set acknowledged_at = '2000-01-01', acknowledged_by = ${await userId(ADMIN)}, note = 'نتابع مع العميل' where id = ${b!.id}`;
      const [ack] = await tx`select acknowledged_at, acknowledged_by, note from public.sla_breaches where id = ${b!.id}`;
      await actAs(tx, OTHER_AM);
      const otherSees = (await tx`select count(*)::int as n from public.sla_breaches where id = ${b!.id}`)[0]!.n;
      await actAs(tx, NAJD_OWNER);
      const clientSees = (await tx`select count(*)::int as n from public.sla_breaches where id = ${b!.id}`)[0]!.n;
      return { amSees, ack: ack!, otherSees, clientSees, id: b!.id as string };
    });
    expect(out.amSees).toBe(1);
    expect(out.ack.note).toBe('نتابع مع العميل');
    expect(out.ack.acknowledged_by).toBe(await userId(AM));
    expect(new Date(out.ack.acknowledged_at).getFullYear()).toBeGreaterThan(2020);
    expect(out.otherSees).toBe(0);
    expect(out.clientSees).toBe(0);

    const specialist = await as(SPECIALIST, async (tx) => {
      const rows = await tx`update public.sla_breaches set note = 'x' where client_id = ${najd} returning id`;
      return rows.length;
    });
    expect(specialist).toBe(0);
    const levelChange = await attempt(AM, (tx) => tx`update public.sla_breaches set level = 'at_risk' where client_id = ${najd}`);
    expect(levelChange?.code).toBe('42501');
    const insert = await attempt(
      AM,
      (tx) => tx`insert into public.sla_breaches (organization_id, client_id, request_id, kind, level, due_at)
      values (${org}, ${najd}, ${req!.id}, 'response', 'breached', now())`,
    );
    expect(insert?.code).toBe('42501');
  });
});
