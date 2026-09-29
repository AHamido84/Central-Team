/**
 * Phase 4 security & integrity: clients see only their client-visible, non-draft campaigns, those campaigns'
 * channels/KPIs/metrics, and published reports — never drafts, internal campaigns, imports, schedules or other
 * clients; agency access follows `campaigns:read` / `campaigns:manage` / `metrics:manage` / `reports:manage` and client
 * access; the cached health only changes through `app.campaign_store_health`; child rows can't cross campaigns or
 * clients; published reports are frozen — proven against Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, attempt, clientId, sql, userId } from './helpers';

type Tx = Parameters<Parameters<typeof as>[1]>[0];

const NAJD_OWNER = 'mohammed@najd.test';
const NAJD_VIEWER = 'saad@najd.test';
const DARB_MEMBER = 'dana@darb.test';
const LUJAIN_OWNER = 'lujain@lujain.test';
const AM = 'noura@ofoq.test'; // Najd account manager: campaigns + metrics + reports
const SPECIALIST = 'khalid@ofoq.test'; // Najd team: campaigns:read + metrics:manage only

let najd: string;
let darb: string;
let lujain: string;
let org: string;

beforeAll(async () => {
  najd = await clientId('najd-heritage');
  darb = await clientId('darb-coffee');
  lujain = await clientId('lujain-fashion');
  const [row] = await sql<{ organization_id: string }[]>`select organization_id from public.clients where id = ${najd}`;
  org = row!.organization_id;
});

afterAll(async () => {
  await sql.end();
});

const count = async (tx: Tx, table: string, where = sql`true`) =>
  ((await tx`select count(*)::int as n from ${tx(table)} where ${where}`)[0] as { n: number }).n;

async function ownerCount(table: string, where: ReturnType<typeof sql>) {
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)} where ${where}`;
  return row!.n;
}

async function campaignOf(client: string, status: string) {
  const [row] = await sql<{ id: string }[]>`select id from public.campaigns where client_id = ${client} and status = ${status} limit 1`;
  return row!.id;
}

describe('portal visibility', () => {
  it('clients see their client-visible campaigns (not drafts) and nothing of other clients', async () => {
    const expected = await ownerCount(
      'campaigns',
      sql`client_id = ${najd} and visibility = 'client' and status in ('planned','active','paused','completed')`,
    );
    const drafts = await ownerCount('campaigns', sql`client_id = ${najd} and status = 'draft'`);
    expect(expected).toBeGreaterThan(0);
    expect(drafts).toBeGreaterThan(0);
    const seen = await as(NAJD_VIEWER, async (tx) => ({
      najd: await count(tx, 'campaigns', sql`client_id = ${najd}`),
      drafts: await count(tx, 'campaigns', sql`status = 'draft'`),
      others: await count(tx, 'campaigns', sql`client_id <> ${najd}`),
      otherMetrics: await count(tx, 'metrics_daily', sql`client_id <> ${najd}`),
      imports: await count(tx, 'metric_imports'),
      schedules: await count(tx, 'report_schedules'),
    }));
    expect(seen).toEqual({ najd: expected, drafts: 0, others: 0, otherMetrics: 0, imports: 0, schedules: 0 });
  });

  it('internal campaigns and their channels, KPIs and metrics stay agency-only', async () => {
    const [internal] = await sql<{ id: string }[]>`select id from public.campaigns where client_id = ${lujain} and visibility = 'internal'`;
    expect(internal).toBeDefined();
    expect(await ownerCount('metrics_daily', sql`campaign_id = ${internal!.id}`)).toBeGreaterThan(0);
    const seen = await as(LUJAIN_OWNER, async (tx) => ({
      campaign: await count(tx, 'campaigns', sql`id = ${internal!.id}`),
      channels: await count(tx, 'campaign_channels', sql`campaign_id = ${internal!.id}`),
      kpis: await count(tx, 'campaign_kpis', sql`campaign_id = ${internal!.id}`),
      metrics: await count(tx, 'metrics_daily', sql`campaign_id = ${internal!.id}`),
      visible: await count(tx, 'campaigns'),
    }));
    expect(seen).toMatchObject({ campaign: 0, channels: 0, kpis: 0, metrics: 0 });
    expect(seen.visible).toBeGreaterThan(0);
  });

  it('clients see metrics of their visible campaigns', async () => {
    const active = await campaignOf(najd, 'active');
    const total = await ownerCount('metrics_daily', sql`campaign_id = ${active}`);
    expect(total).toBeGreaterThan(0);
    expect(await as(NAJD_OWNER, (tx) => count(tx, 'metrics_daily', sql`campaign_id = ${active}`))).toBe(total);
  });

  it('clients see published reports only (with their sections)', async () => {
    const published = await ownerCount('reports', sql`client_id = ${najd} and status = 'published'`);
    const drafts = await ownerCount('reports', sql`client_id = ${najd} and status = 'draft'`);
    expect(published).toBeGreaterThan(0);
    expect(drafts).toBeGreaterThan(0);
    const seen = await as(NAJD_OWNER, async (tx) => ({
      reports: await count(tx, 'reports'),
      drafts: await count(tx, 'reports', sql`status = 'draft'`),
      draftSections: await count(tx, 'report_sections', sql`report_id in (select id from public.reports where status = 'draft')`),
    }));
    expect(seen).toEqual({ reports: published, drafts: 0, draftSections: 0 });
    expect(await as(DARB_MEMBER, (tx) => count(tx, 'reports', sql`client_id = ${najd}`))).toBe(0);
  });

  it('turning the module off hides campaigns and reports from the portal', async () => {
    const seen = await as(NAJD_OWNER, async (tx) => {
      await tx`set local role postgres`;
      await tx`insert into public.organization_features (organization_id, flag_key, enabled) values (${org}, 'module.campaigns', false)
               on conflict (organization_id, flag_key) do update set enabled = false`;
      await tx`set local role authenticated`;
      return { campaigns: await count(tx, 'campaigns'), reports: await count(tx, 'reports') };
    });
    expect(seen).toEqual({ campaigns: 0, reports: 0 });
  });

  it('clients cannot write campaigns, metrics or reports', async () => {
    const active = await campaignOf(najd, 'active');
    const [channel] = await sql<{ id: string }[]>`select id from public.campaign_channels where campaign_id = ${active} limit 1`;
    const insertCampaign = await attempt(
      NAJD_OWNER,
      (tx) =>
        tx`insert into public.campaigns (organization_id, client_id, name, start_date, end_date) values (${org}, ${najd}, 'x', current_date, current_date)`,
    );
    const insertMetric = await attempt(
      NAJD_OWNER,
      (tx) =>
        tx`insert into public.metrics_daily (organization_id, client_id, campaign_id, channel_id, date) values (${org}, ${najd}, ${active}, ${channel!.id}, '2020-01-01')`,
    );
    const insertReport = await attempt(
      NAJD_OWNER,
      (tx) =>
        tx`insert into public.reports (organization_id, client_id, title, period_start, period_end) values (${org}, ${najd}, 'x', current_date, current_date)`,
    );
    for (const r of [insertCampaign, insertMetric, insertReport]) expect(r?.code).toBe('42501');
    const updated = await as(
      NAJD_OWNER,
      async (tx) => (await tx`update public.campaigns set name = 'hacked' where client_id = ${najd} returning id`).length,
    );
    expect(updated).toBe(0);
  });
});

describe('agency permissions', () => {
  it('follows client access: a specialist sees only campaigns of clients on their team', async () => {
    const seen = await as(SPECIALIST, async (tx) => ({
      najd: await count(tx, 'campaigns', sql`client_id = ${najd}`),
      darb: await count(tx, 'campaigns', sql`client_id = ${darb}`),
    }));
    expect(seen.najd).toBe(await ownerCount('campaigns', sql`client_id = ${najd}`));
    expect(seen.darb).toBe(0);
  });

  it('metrics:manage may enter numbers but not edit the campaign or its reports', async () => {
    const active = await campaignOf(najd, 'active');
    const [channel] = await sql<{ id: string }[]>`select id from public.campaign_channels where campaign_id = ${active} limit 1`;
    const metric = await attempt(
      SPECIALIST,
      (tx) =>
        tx`insert into public.metrics_daily (organization_id, client_id, campaign_id, channel_id, date, clicks) values (${org}, ${najd}, ${active}, ${channel!.id}, '2020-01-01', 5)`,
    );
    expect(metric).toBeNull();
    const renamed = await as(
      SPECIALIST,
      async (tx) => (await tx`update public.campaigns set name = 'x' where id = ${active} returning id`).length,
    );
    expect(renamed).toBe(0);
    const report = await attempt(
      SPECIALIST,
      (tx) =>
        tx`insert into public.reports (organization_id, client_id, title, period_start, period_end) values (${org}, ${najd}, 'x', current_date, current_date)`,
    );
    expect(report?.code).toBe('42501');
  });

  it('numbers campaigns per organization and records who created them', async () => {
    const res = await as(AM, async (tx) => {
      const [{ max }] = (await tx`select coalesce(max(number), 0)::int as max from public.campaigns`) as unknown as [{ max: number }];
      const [row] = await tx`insert into public.campaigns (organization_id, client_id, name, start_date, end_date, created_by)
        values (${org}, ${najd}, 'جديدة', current_date, current_date + 10, ${await userId(SPECIALIST)}) returning number, created_by, health`;
      return { max, row: row! };
    });
    expect(res.row.number).toBe(res.max + 1);
    expect(res.row.created_by).toBe(await userId(AM));
    expect(res.row.health).toBe('no_data');
  });
});

describe('health cache', () => {
  it('ignores direct writes and accepts app.campaign_store_health from someone who may edit metrics', async () => {
    const active = await campaignOf(najd, 'active');
    const result = await as(SPECIALIST, async (tx) => {
      const [before] = await tx`select health from public.campaigns where id = ${active}`;
      await tx`update public.campaigns set health = 'off_track' where id = ${active}`;
      const [direct] = await tx`select health from public.campaigns where id = ${active}`;
      await tx`select app.campaign_store_health(${active}::uuid, 'at_risk', current_date - 1, 'at_risk')`;
      const [stored] = await tx`select health, health_notified from public.campaigns where id = ${active}`;
      return { before: before!.health, direct: direct!.health, stored: stored! };
    });
    expect(result.direct).toBe(result.before);
    expect(result.stored).toEqual({ health: 'at_risk', health_notified: 'at_risk' });
  });

  it('refuses health writes from clients', async () => {
    const active = await campaignOf(najd, 'active');
    const r = await attempt(NAJD_OWNER, (tx) => tx`select app.campaign_store_health(${active}::uuid, 'on_track', null, null)`);
    expect(r?.code).toBe('42501');
  });
});

describe('integrity', () => {
  it('metric rows take their campaign and client from the channel (no cross-client writes)', async () => {
    const darbCampaign = await campaignOf(darb, 'active');
    const najdCampaign = await campaignOf(najd, 'active');
    const [darbChannel] = await sql<{ id: string }[]>`select id from public.campaign_channels where campaign_id = ${darbCampaign} limit 1`;
    // A Najd metrics editor (no Darb access) claims a Najd campaign but uses Darb's channel: the trigger moves the row
    // to Darb → RLS refuses it.
    const r = await attempt(
      SPECIALIST,
      (tx) =>
        tx`insert into public.metrics_daily (organization_id, client_id, campaign_id, channel_id, date) values (${org}, ${najd}, ${najdCampaign}, ${darbChannel!.id}, '2020-01-01')`,
    );
    expect(r?.code).toBe('42501');
  });

  it('KPIs may only target a channel of the same campaign', async () => {
    const najdCampaign = await campaignOf(najd, 'active');
    const other = await campaignOf(najd, 'completed');
    const [otherChannel] = await sql<{ id: string }[]>`select id from public.campaign_channels where campaign_id = ${other} limit 1`;
    const r = await attempt(
      AM,
      (tx) =>
        tx`insert into public.campaign_kpis (organization_id, client_id, campaign_id, channel_id, metric, target) values (${org}, ${najd}, ${najdCampaign}, ${otherChannel!.id}, 'clicks', 100)`,
    );
    expect(r?.message).toBe('organization_mismatch');
  });

  it('requests and deliverables link only to campaigns of their own client; deliverables inherit the request’s', async () => {
    const darbCampaign = await campaignOf(darb, 'active');
    const najdCampaign = await campaignOf(najd, 'active');
    const [req] = await sql<{ id: string }[]>`select id from public.requests where client_id = ${najd} limit 1`;
    const cross = await attempt(AM, (tx) => tx`update public.requests set campaign_id = ${darbCampaign} where id = ${req!.id}`);
    expect(cross?.message).toBe('organization_mismatch');
    const inherited = await as(AM, async (tx) => {
      await tx`update public.requests set campaign_id = ${najdCampaign} where id = ${req!.id}`;
      const [d] =
        await tx`insert into public.deliverables (organization_id, client_id, request_id, type, title) values (${org}, ${najd}, ${req!.id}, 'design', 'x') returning campaign_id`;
      return d!.campaign_id;
    });
    expect(inherited).toBe(najdCampaign);
  });

  it('published reports are frozen until taken back to draft', async () => {
    const [report] = await sql<{ id: string }[]>`select id from public.reports where client_id = ${najd} and status = 'published' limit 1`;
    const rename = await attempt(AM, (tx) => tx`update public.reports set title = 'x' where id = ${report!.id}`);
    expect(rename?.message).toBe('report_published');
    const section = await attempt(
      AM,
      (tx) =>
        tx`insert into public.report_sections (organization_id, client_id, report_id, kind) values (${org}, ${najd}, ${report!.id}, 'commentary')`,
    );
    expect(section?.message).toBe('report_published');
    const deleted = await as(AM, async (tx) => (await tx`delete from public.reports where id = ${report!.id} returning id`).length);
    expect(deleted).toBe(0);
    const draft = await as(AM, async (tx) => {
      const [r] = await tx`update public.reports set status = 'draft' where id = ${report!.id} returning snapshot, published_at`;
      return r!;
    });
    expect(draft).toEqual({ snapshot: null, published_at: null });
  });
});
