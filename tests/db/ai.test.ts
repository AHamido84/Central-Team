/**
 * Phase 8 in the database. RLS (rolled back, as real personas): the assistant's chunks are never more visible than
 * their source records (ADR-075); insights follow campaign access and only their status is editable; usage, settings
 * and conversations are scoped; client users see nothing. Service paths (committed, cleaned up): the detector run is
 * idempotent, resolves and reopens; the indexer redacts, re-embeds on change and drops deleted sources; the budget stops
 * model calls.
 */
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key-for-signing-0000';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mockEmbed } from '@/modules/ai/providers/mock-embedder';
import { catchUpIndex, indexTargets } from '@/modules/ai/server/indexer';
import { runCampaignAnalysis } from '@/modules/ai/server/insights';
import { assertAiReady } from '@/modules/ai/server/runtime';

import { as, attempt, sql, userId } from './helpers';

const AGENCY = ['sara@ofoq.test', 'faisal@ofoq.test', 'noura@ofoq.test', 'khalid@ofoq.test', 'majed@ofoq.test', 'ruba@ofoq.test'];
const vec = (text: string) => `[${mockEmbed(text).join(',')}]`;

let org: string;
let futureSmile: string;
let lujain: string;

beforeAll(async () => {
  const [c] = await sql<
    { id: string; organization_id: string }[]
  >`select id, organization_id from public.clients where slug = 'future-smile'`;
  if (!c) throw new Error('Seed missing — run pnpm db:reset');
  futureSmile = c.id;
  org = c.organization_id;
  [{ id: lujain }] = (await sql<{ id: string }[]>`select id from public.clients where slug = 'lujain-fashion'`) as unknown as [
    { id: string },
  ];
  const [n] = await sql<{ n: number }[]>`select count(*)::int as n from public.ai_chunks`;
  if (!n?.n) throw new Error('AI seed missing — run pnpm db:reset');
});

afterAll(async () => {
  await sql.end();
});

describe('RLS on every AI table', () => {
  it('is enabled everywhere, with no anon access', async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'ai\\_%'`;
    expect(rows.map((r) => r.relname).sort()).toEqual(
      ['ai_chunks', 'ai_conversations', 'ai_insights', 'ai_messages', 'ai_recommendations', 'ai_settings', 'ai_usage'].sort(),
    );
    expect(rows.every((r) => r.relrowsecurity)).toBe(true);
    for (const t of rows) expect((await attempt(null, (tx) => tx.unsafe(`select * from public.${t.relname}`)))?.code).toBe('42501');
  });

  for (const email of ['mohammed@najd.test', 'abeer@najd.test', 'saad@najd.test']) {
    it(`client user ${email} sees nothing and writes nothing`, async () => {
      await as(email, async (tx) => {
        for (const t of ['ai_chunks', 'ai_insights', 'ai_recommendations', 'ai_settings', 'ai_usage', 'ai_conversations', 'ai_messages']) {
          const rows = await tx.unsafe(`select 1 from public.${t}`);
          expect(rows.length, t).toBe(0);
        }
      });
      const e = await attempt(
        email,
        (tx) =>
          tx`insert into public.ai_conversations (organization_id, user_id, title) values (${org}, ${'00000000-0000-0000-0000-000000000000'}, 'x')`,
      );
      expect(e?.code).toBe('42501');
    });
  }
});

describe('permission-aware retrieval (ADR-075)', () => {
  const sourceTable: Record<string, string> = {
    client: 'clients',
    campaign: 'campaigns',
    request: 'requests',
    task: 'tasks',
    report: 'reports',
    lead: 'leads',
    deal: 'deals',
    insight: 'ai_insights',
  };

  for (const email of AGENCY) {
    it(`${email}: every visible chunk's source is visible, and every indexed visible source has its chunk`, async () => {
      await as(email, async (tx) => {
        for (const [type, table] of Object.entries(sourceTable)) {
          const [r] = await tx.unsafe<{ chunks: number; sources: number }[]>(`
            select (select count(*)::int from public.ai_chunks where source_type = '${type}') as chunks,
                   (select count(*)::int from public.${table} s where exists (
                      select 1 from public.ai_chunks c where c.source_type = '${type}' and c.source_id = s.id)) as sources`);
          expect(r!.chunks, `${email} ${type}`).toBe(r!.sources);
        }
      });
    });
  }

  it('a Specialist only retrieves chunks of assigned clients and nothing from the CRM', async () => {
    const [all] = await sql<{ lead: number; clients: number }[]>`
      select count(*) filter (where source_type = 'lead')::int as lead, count(*) filter (where source_type = 'client')::int as clients from public.ai_chunks`;
    expect(all!.lead).toBeGreaterThan(0);
    await as('khalid@ofoq.test', async (tx) => {
      const rows = await tx<{ source_type: string; client_id: string | null }[]>`select source_type, client_id from public.ai_chunks`;
      expect(rows.some((r) => r.source_type === 'lead' || r.source_type === 'deal')).toBe(false);
      const clientIds = new Set(rows.map((r) => r.client_id).filter(Boolean));
      const [assigned] = await tx<{ n: number }[]>`select count(*)::int as n from public.clients`;
      expect(clientIds.size).toBeLessThanOrEqual(assigned!.n);
      expect(rows.filter((r) => r.source_type === 'client').length).toBeLessThan(all!.clients);
    });
  });

  it('a nearest-neighbour search as the user never returns what they cannot open', async () => {
    const [lead] = await sql<
      { full_name: string }[]
    >`select full_name from public.leads where merged_into_id is null order by created_at limit 1`;
    const q = vec(`عميل محتمل ${lead!.full_name}`);
    const search = (email: string) =>
      as(
        email,
        (tx) =>
          tx<{ source_type: string }[]>`
          select source_type from public.ai_chunks
          order by embedding operator(extensions.<=>) ${q}::extensions.vector limit 8`,
      );
    expect((await search('sara@ofoq.test')).some((r) => r.source_type === 'lead')).toBe(true);
    expect((await search('khalid@ofoq.test')).some((r) => r.source_type === 'lead')).toBe(false);
  });

  it('without ai:use nothing is retrievable, even with access to the sources', async () => {
    const khalid = await userId('khalid@ofoq.test');
    await as('sara@ofoq.test', async (tx) => {
      await tx`insert into public.user_permission_overrides (organization_id, user_id, permission_key, effect) values (${org}, ${khalid}, 'ai:use', 'deny')`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: khalid, role: 'authenticated' })}, true)`;
      const rows = await tx`select 1 from public.ai_chunks`;
      expect(rows.length).toBe(0);
      const [campaigns] = await tx<{ n: number }[]>`select count(*)::int as n from public.campaigns`;
      expect(campaigns!.n).toBeGreaterThan(0);
    });
  });

  it('nobody writes chunks directly', async () => {
    for (const email of ['sara@ofoq.test', 'faisal@ofoq.test']) {
      expect((await attempt(email, (tx) => tx`delete from public.ai_chunks`))?.code).toBe('42501');
      expect((await attempt(email, (tx) => tx`update public.ai_chunks set title = 'x'`))?.code).toBe('42501');
    }
  });
});

describe('insights and recommendations', () => {
  it('follow campaign access: Noura (not on Future Smile) sees none of its insights, Khalid (assigned) does', async () => {
    const count = (email: string) =>
      as(email, (tx) => tx<{ n: number }[]>`select count(*)::int as n from public.ai_insights where client_id = ${futureSmile}`);
    expect((await count('noura@ofoq.test'))[0]!.n).toBe(0);
    expect((await count('khalid@ofoq.test'))[0]!.n).toBeGreaterThan(0);
    expect(
      (
        await as(
          'noura@ofoq.test',
          (tx) => tx<{ n: number }[]>`select count(*)::int as n from public.ai_insights where client_id = ${lujain}`,
        )
      )[0]!.n,
    ).toBeGreaterThan(0);
  });

  it('only status changes stick; resolution belongs to the detectors; read-only roles change nothing', async () => {
    await as('noura@ofoq.test', async (tx) => {
      const [i] = await tx<{ id: string; severity: string; facts: unknown }[]>`
        select id, severity, facts from public.ai_insights where client_id = ${lujain} and status = 'open' limit 1`;
      await tx`update public.ai_insights set status = 'acknowledged', severity = 'info', facts = '{}'::jsonb where id = ${i!.id}`;
      const [after] = await tx<{ status: string; severity: string; facts: unknown; acted_by: string }[]>`
        select status, severity, facts, acted_by from public.ai_insights where id = ${i!.id}`;
      expect(after).toMatchObject({
        status: 'acknowledged',
        severity: i!.severity,
        facts: i!.facts,
        acted_by: await userId('noura@ofoq.test'),
      });
    });
    const resolved = await attempt(
      'noura@ofoq.test',
      (tx) => tx`update public.ai_insights set status = 'resolved' where client_id = ${lujain}`,
    );
    expect(resolved?.message).toBe('invalid_status');
    await as('khalid@ofoq.test', async (tx) => {
      const updated = await tx`update public.ai_insights set status = 'dismissed' where client_id = ${futureSmile} returning id`;
      expect(updated.length).toBe(0);
    });
    expect((await attempt('faisal@ofoq.test', (tx) => tx`delete from public.ai_insights`))?.code).toBe('42501');
  });

  it('a recommendation is decided once, by someone who can manage the campaign', async () => {
    await as('noura@ofoq.test', async (tx) => {
      const [r] = await tx<
        { id: string }[]
      >`select id from public.ai_recommendations where client_id = ${lujain} and status = 'proposed' limit 1`;
      await tx`update public.ai_recommendations set status = 'dismissed', dismiss_reason = 'seasonal', kind = 'check_tracking' where id = ${r!.id}`;
      const [after] = await tx<
        { status: string; kind: string; decided_by: string }[]
      >`select status, kind, decided_by from public.ai_recommendations where id = ${r!.id}`;
      expect(after!.status).toBe('dismissed');
      expect(after!.kind).not.toBe('check_tracking');
      expect(after!.decided_by).toBe(await userId('noura@ofoq.test'));
      await expect(tx.savepoint((sp) => sp`update public.ai_recommendations set status = 'accepted' where id = ${r!.id}`)).rejects.toThrow(
        'invalid_status',
      );
    });
  });
});

describe('settings, usage and conversations', () => {
  it('settings: everyone with ai:use reads the switch; only ai:manage changes it; updated_by is the caller', async () => {
    expect((await as('noura@ofoq.test', (tx) => tx`select enabled from public.ai_settings`)).length).toBe(1);
    await as('noura@ofoq.test', async (tx) => {
      expect((await tx`update public.ai_settings set enabled = false returning 1`).length).toBe(0);
    });
    await as('faisal@ofoq.test', async (tx) => {
      const [r] = await tx<
        { updated_by: string }[]
      >`update public.ai_settings set sensitivity = 'high', updated_by = null returning updated_by`;
      expect(r!.updated_by).toBe(await userId('faisal@ofoq.test'));
    });
  });

  it('usage: read with ai:manage only, written by nobody', async () => {
    await sql`insert into public.ai_usage (organization_id, purpose, provider, model, input_tokens) values (${org}, 'assistant', 'mock', 'mock-writer-1', 1)`;
    try {
      expect((await as('faisal@ofoq.test', (tx) => tx`select 1 from public.ai_usage`)).length).toBeGreaterThan(0);
      expect((await as('noura@ofoq.test', (tx) => tx`select 1 from public.ai_usage`)).length).toBe(0);
      expect(
        (
          await attempt(
            'faisal@ofoq.test',
            (tx) => tx`insert into public.ai_usage (organization_id, purpose, provider, model) values (${org}, 'assistant', 'mock', 'x')`,
          )
        )?.code,
      ).toBe('42501');
    } finally {
      await sql`delete from public.ai_usage where model = 'mock-writer-1' and input_tokens = 1 and user_id is null`;
    }
  });

  it('conversations are private; the owner is always the caller', async () => {
    const [c] = await sql<{ id: string }[]>`select id from public.ai_conversations limit 1`;
    expect((await as('faisal@ofoq.test', (tx) => tx`select 1 from public.ai_conversations where id = ${c!.id}`)).length).toBe(0);
    expect((await as('faisal@ofoq.test', (tx) => tx`select 1 from public.ai_messages where conversation_id = ${c!.id}`)).length).toBe(0);
    const forged = await attempt(
      'faisal@ofoq.test',
      (tx) => tx`insert into public.ai_messages (organization_id, conversation_id, role, content) values (${org}, ${c!.id}, 'user', 'hi')`,
    );
    expect(forged?.code).toBe('42501');
    await as('faisal@ofoq.test', async (tx) => {
      const sara = await userId('sara@ofoq.test');
      const [mine] = await tx<
        { user_id: string }[]
      >`insert into public.ai_conversations (organization_id, user_id, title) values (${org}, ${sara}, 'x') returning user_id`;
      expect(mine!.user_id).toBe(await userId('faisal@ofoq.test'));
    });
  });
});

// ---------------------------------------------------------------------------
// Service paths (committed, cleaned up)
// ---------------------------------------------------------------------------

describe('detector runs (ADR-074)', () => {
  const tag = Date.now().toString(36);
  let campaignId: string;
  let channelId: string;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());

  beforeAll(async () => {
    const sara = await userId('sara@ofoq.test');
    const [camp] = await sql<{ id: string }[]>`
      insert into public.campaigns (organization_id, client_id, name, status, start_date, end_date, owner_id)
      values (${org}, ${lujain}, ${`AI test ${tag}`}, 'active', ${today}::date - 30, ${today}::date + 30, ${sara}) returning id`;
    campaignId = camp!.id;
    const [ch] = await sql<{ id: string }[]>`
      insert into public.campaign_channels (organization_id, client_id, campaign_id, platform, name) values (${org}, ${lujain}, ${campaignId}, 'meta', '') returning id`;
    channelId = ch!.id;
    // 20 steady days, then a collapse in leads yesterday.
    await sql`
      insert into public.metrics_daily (organization_id, client_id, campaign_id, channel_id, date, impressions, clicks, spend_minor, leads, source)
      select ${org}, ${lujain}, ${campaignId}, ${channelId}, ${today}::date - d, 50000 + (d % 3) * 500, 800 + (d % 3) * 10, 100000 + (d % 3) * 1000,
        case when d = 1 then 4 else 40 + (d % 3) end, 'manual'
      from generate_series(1, 20) d`;
  });

  afterAll(async () => {
    await sql`delete from public.domain_events where aggregate_type = 'campaign' and aggregate_id = ${campaignId}`;
    await sql`delete from public.campaigns where id = ${campaignId}`;
  });

  it('finds the collapse once, and a second run changes nothing', async () => {
    const first = await runCampaignAnalysis(campaignId);
    expect(first!.created).toBeGreaterThan(0);
    const insights = await sql<
      { kind: string; metric: string; status: string }[]
    >`select kind, metric, status from public.ai_insights where campaign_id = ${campaignId}`;
    expect(insights).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'drop', metric: 'leads', status: 'open' })]));
    const recs = await sql`select kind from public.ai_recommendations where campaign_id = ${campaignId}`;
    expect(recs.map((r) => r.kind)).toContain('check_tracking');
    const second = await runCampaignAnalysis(campaignId);
    expect(second).toMatchObject({ created: 0, reopened: 0, resolved: 0 });
    const [events] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.domain_events where type = 'ai_insight.detected' and aggregate_id = ${campaignId}`;
    expect(events!.n).toBe(first!.created);
  });

  it('a pacing insight resolves when the condition clears and reopens when it returns', async () => {
    await sql`insert into public.campaign_kpis (organization_id, client_id, campaign_id, metric, target) values (${org}, ${lujain}, ${campaignId}, 'leads', 100000)`;
    await runCampaignAnalysis(campaignId);
    const status = async () =>
      (
        await sql<
          { status: string }[]
        >`select status from public.ai_insights where campaign_id = ${campaignId} and dedupe_key like '%:kpi:leads'`
      )[0]?.status;
    expect(await status()).toBe('open');
    await sql`update public.campaign_kpis set target = 1 where campaign_id = ${campaignId}`;
    expect((await runCampaignAnalysis(campaignId))!.resolved).toBeGreaterThan(0);
    expect(await status()).toBe('resolved');
    await sql`update public.campaign_kpis set target = 100000 where campaign_id = ${campaignId}`;
    expect((await runCampaignAnalysis(campaignId))!.reopened).toBe(1);
    expect(await status()).toBe('open');
  });
});

describe('indexer (ADR-075/076)', () => {
  let leadId: string;

  afterAll(async () => {
    await sql`delete from public.ai_usage where purpose = 'embedding' and user_id is null and created_at > now() - interval '10 minutes'`;
    if (leadId) {
      await sql`delete from public.leads where id = ${leadId}`;
      await sql`delete from public.ai_chunks where source_id = ${leadId}`;
    }
  });

  it('redacts, skips unchanged text, re-embeds changes and drops deleted sources', async () => {
    const [l] = await sql<{ id: string }[]>`
      insert into public.leads (organization_id, full_name, company, phone, email, source, notes)
      values (${org}, 'Test Indexer', 'Acme', '+966551112233', 'idx@example.sa', 'manual', 'Call +966 55 111 2233 or mail idx@example.sa') returning id`;
    leadId = l!.id;
    expect(await indexTargets(org, [{ type: 'lead', id: leadId }])).toBe(1);
    const [chunk] = await sql<
      { content: string; content_hash: string }[]
    >`select content, content_hash from public.ai_chunks where source_id = ${leadId}`;
    expect(chunk!.content).toContain('Test Indexer');
    expect(chunk!.content).not.toMatch(/2233|idx@example/);
    expect(await indexTargets(org, [{ type: 'lead', id: leadId }])).toBe(0);
    await sql`update public.leads set company = 'Acme Holding' where id = ${leadId}`;
    expect(await indexTargets(org, [{ type: 'lead', id: leadId }])).toBe(1);
    await sql`delete from public.leads where id = ${leadId}`;
    await indexTargets(org, [{ type: 'lead', id: leadId }]);
    expect((await sql`select 1 from public.ai_chunks where source_id = ${leadId}`).length).toBe(0);
  });
});

describe('guardrails (ADR-073/076)', () => {
  it('AI off or budget spent → no model calls', async () => {
    const [before] = await sql<
      { enabled: boolean; monthly_token_budget: number }[]
    >`select enabled, monthly_token_budget from public.ai_settings where organization_id = ${org}`;
    try {
      await sql`update public.ai_settings set enabled = false where organization_id = ${org}`;
      await expect(assertAiReady(org)).rejects.toMatchObject({ code: 'ai_disabled' });
      await sql`update public.ai_settings set enabled = true, monthly_token_budget = 0 where organization_id = ${org}`;
      await expect(assertAiReady(org)).rejects.toMatchObject({ code: 'ai_budget_exceeded' });
      await sql`update public.ai_settings set monthly_token_budget = 1000000000 where organization_id = ${org}`;
      await expect(assertAiReady(org)).resolves.toBeTruthy();
      // Nothing is indexed while AI is off.
      await sql`update public.ai_settings set enabled = false where organization_id = ${org}`;
      const [c] = await sql<{ id: string }[]>`select id from public.clients where id = ${lujain}`;
      expect(await indexTargets(org, [{ type: 'client', id: c!.id }])).toBe(0);
    } finally {
      await sql`update public.ai_settings set enabled = ${before!.enabled}, monthly_token_budget = ${before!.monthly_token_budget} where organization_id = ${org}`;
    }
  });
});

describe('index catch-up', () => {
  it('drops chunks whose source row is gone', async () => {
    const ghost = crypto.randomUUID();
    await sql`
      insert into public.ai_chunks (organization_id, source_type, source_id, title, url, content, content_hash, embedding, embedding_model)
      values (${org}, 'client', ${ghost}, 'Ghost', '/clients/x', 'Ghost', 'x', ${vec('ghost')}::extensions.vector, 'mock-hash-1024')`;
    await catchUpIndex(org, 1);
    expect((await sql`select 1 from public.ai_chunks where source_id = ${ghost}`).length).toBe(0);
  });
});
