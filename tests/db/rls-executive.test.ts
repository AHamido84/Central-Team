/**
 * FR7 (ADR-096/097/098): the Executive / Board roles. Executives read every client and every module but write
 * nothing operational; their own rows (views, notes, schedules, targets) follow their own rules; portal users and
 * normal roles see none of it. The per-statement policy checks (ADR-098) grant exactly what the per-row functions
 * did. And the Executive Center's numbers equal the other screens' for the same period.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { runWithSession } from '@/lib/db/rls';
import { compliance } from '@/modules/sla/constants';
import { listCampaigns } from '@/modules/campaigns/server/queries';
import { winRate } from '@/modules/crm/metrics';
import { getSalesData } from '@/modules/crm/server/dashboard';
import { defaultViewConfig } from '@/modules/executive/config';
import { getExecutiveReport } from '@/modules/executive/server/data';
import { agencyContextFor } from '@/modules/executive/server/run-as';
import { getOpsOverview } from '@/modules/operations/server/queries';

import { as, attempt, sql, userId } from './helpers';

const CHAIRMAN = 'chairman@ofoq.test';
const VIEWER = 'board@ofoq.test';
const ADMIN = 'faisal@ofoq.test';
const ACCOUNT_MANAGER = 'noura@ofoq.test';
const SPECIALIST = 'khalid@ofoq.test';

let org: string;
let portalEmail: string;

beforeAll(async () => {
  const [o] = await sql<{ id: string }[]>`select id from public.organizations where slug = 'ofoq'`;
  org = o!.id;
  const [p] = await sql<{ email: string }[]>`
    select u.email from public.client_users cu join auth.users u on u.id = cu.user_id where cu.status = 'active' order by u.email limit 1`;
  portalEmail = p!.email;
});

const scalar = async (email: string, query: (tx: Parameters<Parameters<typeof as>[1]>[0]) => Promise<{ n: number }[]>) =>
  as(email, async (tx) => Number((await query(tx))[0]?.n ?? 0));

describe('executive roles and permissions', () => {
  it('seeds the board and viewer roles with read-only permissions', async () => {
    const rows = await sql<{ key: string; n: number; writes: number }[]>`
      select r.key, count(*)::int as n,
        count(*) filter (where rp.permission_key ~ ':(create|update|delete|manage|purge|invite|assign|approve|import|send)')::int as writes
      from public.roles r join public.role_permissions rp on rp.role_id = r.id
      where r.organization_id = ${org} and r.key in ('executive_board', 'executive_viewer') group by r.key order by r.key`;
    expect(rows.map((r) => r.key)).toEqual(['executive_board', 'executive_viewer']);
    for (const r of rows) expect(r.writes).toBe(0);
  });

  it('is_executive: the board roles (and admins, who hold every agency permission), not operational roles', async () => {
    const check = (email: string) => as(email, async (tx) => (await tx<{ ok: boolean }[]>`select app.is_executive(${org}) as ok`)[0]!.ok);
    expect(await check(CHAIRMAN)).toBe(true);
    expect(await check(VIEWER)).toBe(true);
    expect(await check(ADMIN)).toBe(true);
    expect(await check(ACCOUNT_MANAGER)).toBe(false);
    expect(await check(SPECIALIST)).toBe(false);
    expect(await check(portalEmail)).toBe(false);
  });

  it('export and schedule belong to the board role, not the viewer', async () => {
    const perm = (email: string, p: string) =>
      as(email, async (tx) => (await tx<{ ok: boolean }[]>`select app.has_permission(${org}, ${p}) as ok`)[0]!.ok);
    expect(await perm(CHAIRMAN, 'executive:export')).toBe(true);
    expect(await perm(CHAIRMAN, 'executive:schedule')).toBe(true);
    expect(await perm(VIEWER, 'executive:view')).toBe(true);
    expect(await perm(VIEWER, 'executive:export')).toBe(false);
    expect(await perm(VIEWER, 'executive:schedule')).toBe(false);
  });
});

describe('executives read everything', () => {
  it.each([
    'clients',
    'requests',
    'tasks',
    'deals',
    'leads',
    'metrics_daily',
    'time_entries',
    'campaigns',
    'deliverables',
    'quotes',
    'sla_breaches',
  ])('sees every row of %s that an admin sees', async (table) => {
    // The admin (clients:read_all and every agency permission) is the reference for "everything".
    const admin = await scalar(ADMIN, (tx) => tx`select count(*)::int as n from ${sql(table)}`);
    const chairman = await scalar(CHAIRMAN, (tx) => tx`select count(*)::int as n from ${sql(table)}`);
    const viewer = await scalar(VIEWER, (tx) => tx`select count(*)::int as n from ${sql(table)}`);
    expect(admin).toBeGreaterThan(0);
    expect(chairman).toBe(admin);
    expect(viewer).toBe(admin);
  });

  it('reads internal threads and AI usage', async () => {
    expect(await scalar(CHAIRMAN, (tx) => tx`select count(*)::int as n from public.threads where visibility = 'internal'`)).toBeGreaterThan(
      0,
    );
    const usage = await attempt(CHAIRMAN, (tx) => tx`select count(*) from public.ai_usage`);
    expect(usage).toBeNull();
  });
});

describe('executives write nothing operational', () => {
  const blocked = async (email: string, statement: (tx: Parameters<Parameters<typeof as>[1]>[0]) => PromiseLike<readonly unknown[]>) => {
    const result = await as(email, async (tx) => {
      try {
        const rows = await statement(tx);
        return { error: null as string | null, rows: rows.length };
      } catch (error) {
        return { error: (error as { code?: string }).code ?? 'error', rows: 0 };
      }
    });
    // Either RLS rejects the write (42501) or it matches no row.
    expect(result.error === '42501' || (result.error === null && result.rows === 0)).toBe(true);
  };

  it.each([CHAIRMAN, VIEWER])('%s cannot change clients, tasks, requests, deals, leads, campaigns or metrics', async (email) => {
    await blocked(email, (tx) => tx`update public.clients set city = 'jeddah' returning id`);
    await blocked(email, (tx) => tx`update public.tasks set title = 'x' returning id`);
    await blocked(email, (tx) => tx`update public.requests set title = 'x' returning id`);
    await blocked(email, (tx) => tx`update public.deals set title = 'x' returning id`);
    await blocked(email, (tx) => tx`update public.leads set full_name = 'x' returning id`);
    await blocked(email, (tx) => tx`update public.campaigns set name = 'x' returning id`);
    await blocked(email, (tx) => tx`delete from public.metrics_daily returning campaign_id`);
    await blocked(email, (tx) => tx`delete from public.clients returning id`);
    await blocked(email, (tx) => tx`update public.packages set price_minor = 1 returning id`);
    const [c] = await sql<{ id: string }[]>`select id from public.clients where organization_id = ${org} limit 1`;
    await blocked(
      email,
      (tx) => tx`insert into public.client_notes (client_id, organization_id, body) values (${c!.id}, ${org}, 'x') returning client_id`,
    );
  });

  it('cannot write KPI snapshots (the job does)', async () => {
    const code = await attempt(
      CHAIRMAN,
      (tx) => tx`insert into public.kpi_snapshots (organization_id, day, metric, value) values (${org}, '2020-01-01', 'x', 1)`,
    );
    expect(code).not.toBeNull();
  });
});

describe('their own rows', () => {
  it('saved views are private to their owner', async () => {
    const chairman = await userId(CHAIRMAN);
    await as(CHAIRMAN, async (tx) => {
      await tx`insert into public.executive_views (organization_id, user_id, name, config) values (${org}, ${chairman}, 'Mine', ${tx.json(defaultViewConfig)})`;
      const [n] = await tx<{ n: number }[]>`select count(*)::int as n from public.executive_views where name = 'Mine'`;
      expect(n!.n).toBe(1);
    });
    // The seeded pinned view isn't visible to the viewer, nor can anyone save a view for someone else.
    expect(await scalar(VIEWER, (tx) => tx`select count(*)::int as n from public.executive_views`)).toBe(0);
    const denied = await attempt(
      VIEWER,
      (tx) => tx`insert into public.executive_views (organization_id, user_id, name, config) values (${org}, ${chairman}, 'Theirs', '{}')`,
    );
    expect(denied?.code).toBe('42501');
  });

  it('notes are read by executives and the owner they are addressed to, nobody else', async () => {
    expect(await scalar(CHAIRMAN, (tx) => tx`select count(*)::int as n from public.executive_notes`)).toBeGreaterThan(0);
    expect(await scalar(VIEWER, (tx) => tx`select count(*)::int as n from public.executive_notes`)).toBeGreaterThan(0);
    expect(await scalar(ACCOUNT_MANAGER, (tx) => tx`select count(*)::int as n from public.executive_notes`)).toBeGreaterThan(0);
    expect(await scalar(SPECIALIST, (tx) => tx`select count(*)::int as n from public.executive_notes`)).toBe(0);
    // Only an executive writes one, as themselves.
    const noura = await userId(ACCOUNT_MANAGER);
    const denied = await attempt(
      ACCOUNT_MANAGER,
      (tx) =>
        tx`insert into public.executive_notes (organization_id, author_id, kpi, context, body) values (${org}, ${noura}, 'revenue', '{}', 'x')`,
    );
    expect(denied?.code).toBe('42501');
    // The owner marks it resolved.
    await as(ACCOUNT_MANAGER, async (tx) => {
      const rows = await tx`update public.executive_notes set resolved_at = now() where owner_id = ${noura} returning id`;
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  it('schedules and targets need executive:schedule', async () => {
    const chairman = await userId(CHAIRMAN);
    expect(await scalar(CHAIRMAN, (tx) => tx`select count(*)::int as n from public.executive_schedules`)).toBe(1);
    expect(await scalar(VIEWER, (tx) => tx`select count(*)::int as n from public.executive_schedules`)).toBe(0);
    const viewerInsert = await attempt(
      VIEWER,
      (tx) =>
        tx`insert into public.executive_schedules (organization_id, created_by, recipients, next_run_on) values (${org}, ${chairman}, '{a@b.test}', '2030-01-01')`,
    );
    expect(viewerInsert?.code).toBe('42501');
    expect(await scalar(CHAIRMAN, (tx) => tx`select count(*)::int as n from public.kpi_targets`)).toBeGreaterThan(0);
    // Viewers read targets (they see progress) but can't set them; normal roles don't read them.
    expect(await scalar(VIEWER, (tx) => tx`select count(*)::int as n from public.kpi_targets`)).toBeGreaterThan(0);
    const viewerTarget = await attempt(
      VIEWER,
      (tx) => tx`insert into public.kpi_targets (organization_id, metric, year, value) values (${org}, 'revenue', 2031, 1)`,
    );
    expect(viewerTarget?.code).toBe('42501');
    expect(await scalar(SPECIALIST, (tx) => tx`select count(*)::int as n from public.kpi_targets`)).toBe(0);
    // Admins (organization:update) may set targets too.
    expect(
      await attempt(
        ADMIN,
        (tx) => tx`insert into public.kpi_targets (organization_id, metric, year, value) values (${org}, 'revenue', 2031, 1)`,
      ),
    ).toBeNull();
  });
});

describe('portal users and normal roles', () => {
  it.each(['kpi_snapshots', 'kpi_targets', 'executive_views', 'executive_notes', 'executive_schedules'])(
    'a portal user sees no %s',
    async (table) => {
      expect(await scalar(portalEmail, (tx) => tx`select count(*)::int as n from ${sql(table)}`)).toBe(0);
    },
  );

  it('snapshots are for executives only', async () => {
    expect(await scalar(CHAIRMAN, (tx) => tx`select count(*)::int as n from public.kpi_snapshots`)).toBeGreaterThan(0);
    expect(await scalar(ACCOUNT_MANAGER, (tx) => tx`select count(*)::int as n from public.kpi_snapshots`)).toBe(0);
    expect(await scalar(SPECIALIST, (tx) => tx`select count(*)::int as n from public.kpi_snapshots`)).toBe(0);
  });
});

describe('audit', () => {
  it('logs executive sign-ins and exports, and nothing for anyone else', async () => {
    const count = async (email: string) =>
      as(email, async (tx) => {
        await tx`select app.log_executive_event('executive_export', '{"format":"pdf"}'::jsonb)`;
        const [n] = await tx<
          { n: number }[]
        >`select count(*)::int as n from public.activity_log where action = 'executive_export' and actor_id = auth.uid()`;
        return n!.n;
      });
    expect(await count(CHAIRMAN)).toBeGreaterThan(0);
    expect(await count(ACCOUNT_MANAGER)).toBe(0);
    const bad = await attempt(CHAIRMAN, (tx) => tx`select app.log_executive_event('delete_everything', '{}'::jsonb)`);
    expect(bad?.code).toBe('22023');
  });
});

describe('per-statement policy checks (ADR-098) grant exactly what the per-row functions did', () => {
  const cases: [string, string][] = [
    ['metrics_daily', `app.agency_can_task(client_id, 'campaigns:read') or app.client_can_see_campaign(campaign_id)`],
    ['campaigns', `app.agency_can_task(client_id, 'campaigns:read') or app.client_can_see_campaign(id)`],
    [
      'time_entries',
      `client_id = any (app.agency_task_client_ids()) and (user_id = auth.uid() or app.has_permission(organization_id, 'time:read_all'))`,
    ],
    ['leads', `app.has_permission(organization_id, 'leads:read') and deleted_at is null`],
  ];
  it.each([ADMIN, ACCOUNT_MANAGER, SPECIALIST, CHAIRMAN, 'ruba@ofoq.test'])('for %s', async (email) => {
    for (const [table, rule] of cases) {
      const visible = await scalar(email, (tx) => tx`select count(*)::int as n from ${sql(table)}`);
      const expected = await scalar(email, (tx) => tx.unsafe(`select count(*)::int as n from public.${table} where ${rule}`) as never);
      expect({ table, visible }).toEqual({ table, visible: expected });
    }
  });

  it('for a portal user', async () => {
    const visible = await scalar(portalEmail, (tx) => tx`select count(*)::int as n from public.metrics_daily`);
    const expected = await sql<{ n: number }[]>`
      select count(*)::int as n from public.metrics_daily m join public.campaigns c on c.id = m.campaign_id
      join public.client_users cu on cu.client_id = c.client_id join auth.users u on u.id = cu.user_id
      where u.email = ${portalEmail} and cu.status = 'active' and c.visibility = 'client' and c.status in ('planned', 'active', 'paused', 'completed')`;
    expect(visible).toBe(expected[0]!.n);
  });
});

describe('the numbers match the other screens', () => {
  it('for last month, as the chairman', async () => {
    const ctx = await agencyContextFor(await userId(CHAIRMAN), org, 'executive:view');
    expect(ctx).not.toBeNull();
    await runWithSession(ctx!.session, async () => {
      const config = { ...defaultViewConfig, preset: 'last_month' as const };
      const report = await getExecutiveReport(ctx!, config);
      const { from, to } = report.period;

      // Sales dashboard: win rate and pipeline from the same deals and the same function.
      const sales = (await getSalesData(ctx!, { period: 'year', ownerId: null, pipelineId: null }))!;
      expect(report.kpis.win_rate.value).toBe(winRate(sales.deals, from, to));
      expect(report.kpis.pipeline_value.value).toBe(sales.deals.filter((d) => d.status === 'open').reduce((n, d) => n + d.valueMinor, 0));

      // Operations dashboard: average client health.
      const ops = await getOpsOverview(ctx!, { kind: 'all' });
      expect(report.kpis.avg_health.value).toBeCloseTo(ops.clients.reduce((n, c) => n + c.score, 0) / ops.clients.length);

      // Campaign list: campaigns at risk or off track.
      const campaigns = await listCampaigns();
      expect(report.kpis.campaigns_at_risk.value).toBe(
        campaigns.filter((c) => c.status === 'active' && (c.health === 'at_risk' || c.health === 'off_track')).length,
      );

      // Campaign analytics: spend is the sum of the daily numbers in the period.
      const [spend] = await sql<{ n: number }[]>`
        select coalesce(sum(spend_minor), 0)::float8 as n from public.metrics_daily where organization_id = ${org} and date between ${from} and ${to}`;
      expect(report.kpis.ad_spend.value).toBe(spend!.n);

      // SLA monitor: compliance over the requests submitted in the period, by the same function.
      const rows = await sql<
        {
          submitted_at: Date;
          response_due_at: Date | null;
          first_response_at: Date | null;
          due_date: string | null;
          delivered_at: Date | null;
        }[]
      >`
        select submitted_at, response_due_at, first_response_at, due_date::text, delivered_at from public.requests
        where organization_id = ${org} and status <> 'draft' and deleted_at is null
          and (submitted_at at time zone 'Asia/Riyadh')::date between ${from} and ${to}`;
      const c = compliance(
        rows.map((r) => ({
          submittedAt: r.submitted_at.toISOString(),
          responseDueAt: r.response_due_at?.toISOString() ?? null,
          firstResponseAt: r.first_response_at?.toISOString() ?? null,
          dueDate: r.due_date,
          deliveredAt: r.delivered_at?.toISOString() ?? null,
        })),
        new Date(`${to}T23:59:59Z`),
      );
      expect(report.kpis.on_time_rate.parts).toEqual({ num: c.resolution.met, den: c.resolution.total });
      expect(report.kpis.sla_compliance.parts).toEqual({ num: c.response.met, den: c.response.total });
    });
  });
});
