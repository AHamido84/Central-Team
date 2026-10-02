/**
 * The assistant's index (ADR-075/076): one redacted text chunk per source record, embedded and stored in `ai_chunks`.
 * Deliberately not `server-only`: the seed builds the demo index with the mock embedder. Runs in the caller's
 * transaction — the service path (indexer consumer, sweep, rebuild) passes an owner connection, because the index
 * covers the whole organization and visibility is decided at read time by the chunk policy.
 */
import { createHash } from 'node:crypto';

import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db/client';
import { aiChunks } from '@/lib/db/schema';
import { localized, type LocalizedText } from '@/lib/i18n/localized';
import { insightBody, insightTitle, recommendationTitle, formatValue, type TextKit } from '@/modules/ai/insight-text';
import type { AiEmbedder } from '@/modules/ai/providers/types';
import type { InsightFacts, RecommendationFacts, SourceType } from '@/modules/ai/types';
import { sourceTypes } from '@/modules/ai/types';

/** Longest text kept per chunk (characters) — the table allows 8000. */
export const CHUNK_MAX = 4000;

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
/** 8+ digits with optional +, spaces, dashes, dots or brackets between them (Saudi mobiles, landlines, E.164). */
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;

/** Removes e-mail addresses and phone numbers (ADR-076) — before anything is stored, embedded or sent. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function redact(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 8 && !ISO_DATE.test(m.trim()) ? '[phone]' : m));
}

export type ChunkDraft = {
  organizationId: string;
  sourceType: SourceType;
  sourceId: string;
  clientId: string | null;
  title: string;
  url: string;
  content: string;
  sourceUpdatedAt: Date | null;
};

const name = (v: unknown, locale: 'ar' | 'en') => (v && typeof v === 'object' ? localized(v as LocalizedText, locale) : String(v ?? ''));
const bothNames = (v: unknown) => {
  if (!v || typeof v !== 'object') return String(v ?? '');
  const t = v as LocalizedText;
  return [...new Set([t.ar, t.en].filter(Boolean))].join(' / ');
};
const line = (label: string, value: unknown) => {
  const s = typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value);
  return s ? `${label}: ${s}` : null;
};
/** Raw `execute` returns Postgres text for timestamps ("2026-09-30 10:00:00.1+00"); make it ISO before parsing. */
const iso = (d: unknown) => {
  if (d instanceof Date) return d;
  if (!d) return null;
  const parsed = new Date(
    String(d)
      .replace(' ', 'T')
      .replace(/([+-]\d\d)$/, '$1:00'),
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Text values of a request brief (answers only), flattened. */
function briefText(brief: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'number') out.push(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(brief);
  return out.join(' · ').slice(0, 1500);
}

function finish(kit: TextKit, typeLabel: string, d: Omit<ChunkDraft, 'content'>, lines: (string | null)[]): ChunkDraft {
  const header = kit.t('index.header', { type: typeLabel, title: d.title });
  const content = redact([header, ...lines.filter(Boolean)].join('\n')).slice(0, CHUNK_MAX);
  return { ...d, title: redact(d.title).slice(0, 300), content };
}

type Row = Record<string, unknown>;

/** Builds chunks for existing rows of one source type (ids that no longer exist are simply absent). */
export async function buildChunks(
  tx: Tx,
  type: SourceType,
  ids: readonly string[],
  kit: TextKit,
  locale: 'ar' | 'en',
): Promise<ChunkDraft[]> {
  if (ids.length === 0) return [];
  const idList = sql`array[${sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  )}]`;
  const label = kit.t(`assistant.sourceType.${type}`);
  const L = (k: string) => kit.t(`index.${k}`);
  switch (type) {
    case 'client': {
      const rows = await tx.execute<Row>(sql`
        select c.id, c.organization_id, c.name, c.industry, c.city, c.status, c.updated_at, p.full_name as am
        from public.clients c left join public.profiles p on p.id = c.account_manager_id
        where c.id = any(${idList})`);
      return rows.map((r) =>
        finish(kit, label, base(r, 'client', r.id as string, name(r.name, locale), `/clients/${r.id}`), [
          line(L('client'), bothNames(r.name)),
          line(L('status'), r.status),
          line(L('industry'), r.industry),
          line(L('city'), r.city),
          line(L('accountManager'), r.am),
        ]),
      );
    }
    case 'campaign': {
      const rows = await tx.execute<Row>(sql`
        select c.id, c.organization_id, c.client_id, c.name, c.status, c.objective, c.start_date, c.end_date, c.budget_minor,
          c.currency, c.health, c.updated_at, cl.name as client_name,
          (select coalesce(sum(m.spend_minor),0) from public.metrics_daily m where m.campaign_id = c.id) as spend,
          (select coalesce(sum(m.impressions),0) from public.metrics_daily m where m.campaign_id = c.id) as impressions,
          (select coalesce(sum(m.clicks),0) from public.metrics_daily m where m.campaign_id = c.id) as clicks,
          (select coalesce(sum(m.leads),0) from public.metrics_daily m where m.campaign_id = c.id) as leads,
          (select coalesce(sum(m.conversions),0) from public.metrics_daily m where m.campaign_id = c.id) as conversions,
          (select string_agg(coalesce(nullif(ch.name,''), ch.platform), ', ') from public.campaign_channels ch where ch.campaign_id = c.id) as channels,
          (select string_agg(k.metric || ' ' || k.target::text, ', ') from public.campaign_kpis k where k.campaign_id = c.id) as kpis,
          (select count(*) from public.ai_insights i where i.campaign_id = c.id and i.status in ('open','acknowledged')) as open_insights
        from public.campaigns c join public.clients cl on cl.id = c.client_id
        where c.id = any(${idList})`);
      return rows.map((r) => {
        const cur = String(r.currency ?? 'SAR');
        const n = (v: unknown) => formatValue(kit.f, 'count', Number(v ?? 0));
        const totals = [
          `${kit.metric('spend')} ${formatValue(kit.f, 'money', Number(r.spend ?? 0), cur)}`,
          `${kit.metric('impressions')} ${n(r.impressions)}`,
          `${kit.metric('clicks')} ${n(r.clicks)}`,
          `${kit.metric('leads')} ${n(r.leads)}`,
          `${kit.metric('conversions')} ${n(r.conversions)}`,
        ].join(' · ');
        return finish(kit, label, base(r, 'campaign', r.client_id as string, String(r.name), `/campaigns/${r.id}`), [
          line(L('client'), bothNames(r.client_name)),
          line(L('status'), r.status),
          line(L('objective'), r.objective),
          line(L('flight'), `${r.start_date} → ${r.end_date}`),
          line(L('budget'), formatValue(kit.f, 'money', Number(r.budget_minor ?? 0), cur)),
          line(L('health'), r.health),
          line(L('totals'), totals),
          line(L('channels'), r.channels),
          line(L('kpis'), r.kpis),
          line(L('openInsights'), Number(r.open_insights ?? 0) > 0 ? String(r.open_insights) : null),
        ]);
      });
    }
    case 'request': {
      const rows = await tx.execute<Row>(sql`
        select r.id, r.organization_id, r.client_id, r.reference, r.title, r.status, r.priority, r.due_date, r.brief, r.updated_at,
          cl.name as client_name, rt.name as type_name, p.full_name as assignee
        from public.requests r join public.clients cl on cl.id = r.client_id
        left join public.request_types rt on rt.id = r.request_type_id
        left join public.profiles p on p.id = r.assignee_id
        where r.id = any(${idList}) and r.status <> 'draft'`);
      return rows.map((r) =>
        finish(kit, label, base(r, 'request', r.client_id as string, String(r.title), `/requests/${r.id}`), [
          line(L('reference'), r.reference),
          line(L('client'), bothNames(r.client_name)),
          line(L('type'), name(r.type_name, locale)),
          line(L('status'), r.status),
          line(L('priority'), r.priority),
          line(L('due'), r.due_date),
          line(L('assignees'), r.assignee),
          line(L('brief'), briefText(r.brief)),
        ]),
      );
    }
    case 'task': {
      const rows = await tx.execute<Row>(sql`
        select t.id, t.organization_id, t.client_id, t.title, t.description, t.priority, t.due_date, t.updated_at,
          cl.name as client_name, s.name as status_name,
          (select string_agg(p.full_name, ', ') from public.task_members a join public.profiles p on p.id = a.user_id where a.task_id = t.id and a.role = 'assignee') as assignees
        from public.tasks t join public.clients cl on cl.id = t.client_id
        left join public.task_statuses s on s.id = t.status_id
        where t.id = any(${idList})`);
      return rows.map((r) =>
        finish(kit, label, base(r, 'task', r.client_id as string, String(r.title), `/tasks?task=${r.id}`), [
          line(L('client'), bothNames(r.client_name)),
          line(L('status'), name(r.status_name, locale)),
          line(L('priority'), r.priority),
          line(L('due'), r.due_date),
          line(L('assignees'), r.assignees),
          line(L('description'), String(r.description ?? '').slice(0, 1500)),
        ]),
      );
    }
    case 'report': {
      const rows = await tx.execute<Row>(sql`
        select r.id, r.organization_id, r.client_id, r.title, r.status, r.period_start, r.period_end, r.updated_at, cl.name as client_name,
          (select string_agg(s.body, E'\n') from public.report_sections s where s.report_id = r.id and s.body <> '') as bodies
        from public.reports r join public.clients cl on cl.id = r.client_id
        where r.id = any(${idList})`);
      return rows.map((r) =>
        finish(kit, label, base(r, 'report', r.client_id as string, String(r.title), `/reports/${r.id}`), [
          line(L('client'), bothNames(r.client_name)),
          line(L('status'), r.status),
          line(L('period'), `${r.period_start} → ${r.period_end}`),
          line(L('commentary'), String(r.bodies ?? '').slice(0, 2000)),
        ]),
      );
    }
    case 'lead': {
      const rows = await tx.execute<Row>(sql`
        select l.id, l.organization_id, l.full_name, l.company, l.source, l.source_detail, l.services, l.budget_range, l.city,
          l.status, l.notes, l.tags, l.updated_at, p.full_name as owner
        from public.leads l left join public.profiles p on p.id = l.owner_id
        where l.id = any(${idList}) and l.merged_into_id is null`);
      return rows.map((r) =>
        finish(kit, label, base(r, 'lead', null, String(r.full_name), `/crm/leads/${r.id}`), [
          line(L('company'), r.company),
          line(L('status'), r.status),
          line(L('source'), [r.source, r.source_detail].filter(Boolean).join(' · ')),
          line(L('services'), Array.isArray(r.services) ? r.services.join(', ') : r.services),
          line(L('city'), r.city),
          line(L('owner'), r.owner),
          line(L('notes'), String(r.notes ?? '').slice(0, 1500)),
        ]),
      );
    }
    case 'deal': {
      const rows = await tx.execute<Row>(sql`
        select d.id, d.organization_id, d.client_id, d.title, d.company, d.status, d.value_minor, d.currency, d.expected_close_date,
          d.updated_at, st.name as stage_name, p.full_name as owner, l.full_name as lead_name
        from public.deals d left join public.pipeline_stages st on st.id = d.stage_id
        left join public.profiles p on p.id = d.owner_id left join public.leads l on l.id = d.lead_id
        where d.id = any(${idList})`);
      return rows.map((r) =>
        finish(kit, label, base(r, 'deal', null, String(r.title), `/crm/deals/${r.id}`), [
          line(L('company'), r.company ?? r.lead_name),
          line(L('stage'), name(r.stage_name, locale)),
          line(L('status'), r.status),
          line(L('value'), formatValue(kit.f, 'money', Number(r.value_minor ?? 0), String(r.currency ?? 'SAR'))),
          line(L('expectedClose'), r.expected_close_date),
          line(L('owner'), r.owner),
        ]),
      );
    }
    case 'insight': {
      const rows = await tx.execute<Row>(sql`
        select i.id, i.organization_id, i.client_id, i.kind, i.metric, i.severity, i.status, i.facts, i.updated_at,
          c.name as campaign_name, cl.name as client_name,
          (select coalesce(jsonb_agg(jsonb_build_object('kind', r.kind, 'facts', r.facts)), '[]'::jsonb)
             from public.ai_recommendations r where r.insight_id = i.id and r.status <> 'dismissed') as recs
        from public.ai_insights i join public.campaigns c on c.id = i.campaign_id join public.clients cl on cl.id = i.client_id
        where i.id = any(${idList})`);
      return rows.map((r) => {
        const like = { kind: String(r.kind), metric: (r.metric as string | null) ?? null, facts: r.facts as InsightFacts };
        const recs = (r.recs as { kind: string; facts: RecommendationFacts }[]).map((x) => recommendationTitle(kit, x));
        return finish(kit, label, base(r, 'insight', r.client_id as string, insightTitle(kit, like), `/insights/${r.id}`), [
          line(L('campaign'), r.campaign_name),
          line(L('client'), bothNames(r.client_name)),
          line(L('severity'), kit.t(`severity.${r.severity}`)),
          line(L('status'), kit.t(`status.${r.status}`)),
          insightBody(kit, like),
          line(L('recommendations'), recs.join(' · ')),
        ]);
      });
    }
  }
}

function base(r: Row, type: SourceType, clientId: string | null, title: string, url: string): Omit<ChunkDraft, 'content'> {
  return {
    organizationId: String(r.organization_id),
    sourceType: type,
    sourceId: String(r.id),
    clientId,
    title: title || '—',
    url,
    sourceUpdatedAt: iso(r.updated_at),
  };
}

export const contentHash = (d: Pick<ChunkDraft, 'title' | 'content' | 'url'>) =>
  createHash('sha256').update(`${d.title}\n${d.url}\n${d.content}`).digest('hex');

/**
 * Reconciles the chunks of the given sources: rebuilds changed ones (content hash or embedding model differs),
 * deletes chunks whose source is gone, and leaves the rest untouched. Returns how many were embedded.
 */
export async function indexSources(
  tx: Tx,
  type: SourceType,
  ids: readonly string[],
  opts: { kit: TextKit; locale: 'ar' | 'en'; embedder: AiEmbedder; embed: (texts: string[]) => Promise<number[][]> },
): Promise<{ embedded: number; deleted: number }> {
  if (ids.length === 0) return { embedded: 0, deleted: 0 };
  const drafts = await buildChunks(tx, type, ids, opts.kit, opts.locale);
  const present = new Set(drafts.map((d) => d.sourceId));
  const gone = ids.filter((i) => !present.has(i));
  let deleted = 0;
  if (gone.length) {
    const removed = await tx
      .delete(aiChunks)
      .where(and(eq(aiChunks.sourceType, type), inArray(aiChunks.sourceId, gone)))
      .returning({ id: aiChunks.id });
    deleted = removed.length;
  }
  if (drafts.length === 0) return { embedded: 0, deleted };
  const existing = await tx
    .select({ sourceId: aiChunks.sourceId, contentHash: aiChunks.contentHash, model: aiChunks.embeddingModel })
    .from(aiChunks)
    .where(
      and(
        eq(aiChunks.sourceType, type),
        inArray(
          aiChunks.sourceId,
          drafts.map((d) => d.sourceId),
        ),
      ),
    );
  const known = new Map(existing.map((e) => [e.sourceId, e]));
  const changed = drafts
    .map((d) => ({ d, hash: contentHash(d) }))
    .filter(({ d, hash }) => {
      const k = known.get(d.sourceId);
      return !k || k.contentHash !== hash || k.model !== opts.embedder.model;
    });
  const now = new Date();
  // Unchanged text: mark it checked, so a touched-but-identical record doesn't stay "stale".
  const unchanged = drafts.filter((d) => !changed.some((c) => c.d.sourceId === d.sourceId)).map((d) => d.sourceId);
  if (unchanged.length) {
    await tx
      .update(aiChunks)
      .set({ indexedAt: now })
      .where(and(eq(aiChunks.sourceType, type), inArray(aiChunks.sourceId, unchanged)));
  }
  if (changed.length === 0) return { embedded: 0, deleted };
  const vectors = await opts.embed(changed.map(({ d }) => `${d.title}\n${d.content}`));
  for (const [i, { d, hash }] of changed.entries()) {
    const values = {
      organizationId: d.organizationId,
      sourceType: d.sourceType,
      sourceId: d.sourceId,
      clientId: d.clientId,
      title: d.title,
      url: d.url,
      content: d.content,
      contentHash: hash,
      embedding: vectors[i]!,
      embeddingModel: opts.embedder.model,
      sourceUpdatedAt: d.sourceUpdatedAt,
      indexedAt: now,
    };
    await tx
      .insert(aiChunks)
      .values(values)
      .onConflictDoUpdate({ target: [aiChunks.sourceType, aiChunks.sourceId], set: values });
  }
  return { embedded: changed.length, deleted };
}

const sourceTable: Record<SourceType, string> = {
  client: 'clients',
  campaign: 'campaigns',
  request: 'requests',
  task: 'tasks',
  report: 'reports',
  lead: 'leads',
  deal: 'deals',
  insight: 'ai_insights',
};

/**
 * Sources of an organization whose chunk is missing, older than the record, or embedded with another model — the
 * daily catch-up and "Rebuild index" work through these in batches.
 */
export async function staleSources(
  tx: Tx,
  organizationId: string,
  model: string,
  limit: number,
): Promise<{ type: SourceType; id: string }[]> {
  const parts = sourceTypes.map(
    (type) => sql`
      select ${type}::text as type, s.id from public.${sql.raw(sourceTable[type])} s
      left join public.ai_chunks c on c.source_type = ${type} and c.source_id = s.id
      where s.organization_id = ${organizationId}
        ${type === 'request' ? sql`and s.status <> 'draft'` : sql``}
        ${type === 'lead' ? sql`and s.merged_into_id is null` : sql``}
        and (c.id is null or c.embedding_model <> ${model} or s.updated_at > c.indexed_at)`,
  );
  const rows = await tx.execute<{ type: SourceType; id: string }>(sql`${sql.join(parts, sql` union all `)} limit ${limit}`);
  return rows.map((r) => ({ type: r.type, id: r.id }));
}

/** Removes chunks whose source row is gone (deleted without an event the indexer follows, e.g. a cascade). */
export async function pruneOrphans(tx: Tx, organizationId: string): Promise<number> {
  let removed = 0;
  for (const type of sourceTypes) {
    const rows = await tx.execute<{ id: string }>(sql`
      delete from public.ai_chunks c
      where c.organization_id = ${organizationId} and c.source_type = ${type}
        and not exists (select 1 from public.${sql.raw(sourceTable[type])} s where s.id = c.source_id)
      returning c.id`);
    removed += rows.length;
  }
  return removed;
}

/** Counts for the admin page: indexed chunks per type, and how many sources are waiting. */
export async function indexStatus(
  tx: Tx,
  organizationId: string,
  model: string,
): Promise<{ byType: Record<string, number>; stale: number }> {
  const rows = await tx.execute<{ source_type: string; n: number }>(sql`
    select source_type, count(*)::int as n from public.ai_chunks where organization_id = ${organizationId} group by source_type`);
  const stale = await staleSources(tx, organizationId, model, 100_000);
  return { byType: Object.fromEntries(rows.map((r) => [r.source_type, r.n])), stale: stale.length };
}
