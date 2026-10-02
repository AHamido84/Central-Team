import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

import type { Tx } from '@/lib/db/client';
import type { Locale } from '@/lib/i18n/localized';
import { isToolName, searchTerms, SQL_NORMALIZE_FROM, SQL_NORMALIZE_TO, toolInputs, type ToolName } from '@/modules/ai/assistant-tools';
import { buildChunks, type ChunkDraft } from '@/modules/ai/indexer-core';
import type { TextKit } from '@/modules/ai/insight-text';
import type { AiToolCall, AiToolResult, GroundingSource } from '@/modules/ai/providers/types';
import type { SourceType } from '@/modules/ai/types';
import { addDays } from '@/modules/tasks/constants';

export type ToolSource = GroundingSource & { sourceId: string; url: string };

/** Numbers every record the tools return, once per conversation turn, so the answer can cite `[n]` (ADR-075/090). */
export class SourceRegistry {
  private readonly byKey = new Map<string, ToolSource>();
  static readonly MAX = 40;

  add(d: Pick<ChunkDraft, 'sourceType' | 'sourceId' | 'title' | 'url' | 'content'>): ToolSource | null {
    const key = `${d.sourceType}:${d.sourceId}`;
    const known = this.byKey.get(key);
    if (known) return known;
    if (this.byKey.size >= SourceRegistry.MAX) return null;
    const s: ToolSource = {
      n: this.byKey.size + 1,
      sourceType: d.sourceType,
      sourceId: d.sourceId,
      title: d.title,
      url: d.url,
      content: d.content,
    };
    this.byKey.set(key, s);
    return s;
  }

  list(): ToolSource[] {
    return [...this.byKey.values()];
  }
}

export type ToolContext = {
  tx: Tx;
  userId: string;
  locale: Locale;
  kit: TextKit;
  /** The agency's time zone: "this month" and "today" follow its calendar (gotcha 53). */
  timeZone: string;
  /** The agency's day (Asia/Riyadh by default), YYYY-MM-DD. */
  today: string;
  sources: SourceRegistry;
  /** Vector search when an embedder is configured (and its index has chunks); keyword search otherwise. */
  semantic?: (query: string, types: readonly SourceType[] | undefined) => Promise<{ type: SourceType; id: string }[]>;
};

const SNIPPET = 700;
const idArray = (ids: readonly string[]) =>
  sql`array[${sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  )}]::uuid[]`;
/** Lower-cased text with the Arabic spelling variants folded — the SQL twin of `normalizeArabic`. */
const norm = (expr: SQL) => sql`translate(lower(${expr}), ${SQL_NORMALIZE_FROM}, ${SQL_NORMALIZE_TO})`;
const clientHay = (alias: string) => sql.raw(`coalesce(${alias}.name->>'ar','') || ' ' || coalesce(${alias}.name->>'en','')`);
const like = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Builds the records' text as the user (RLS decides which ids come back) and numbers them, keeping `ids` order. */
async function cite(c: ToolContext, type: SourceType, ids: readonly string[]): Promise<ToolSource[]> {
  if (ids.length === 0) return [];
  const drafts = await buildChunks(c.tx, type, ids, c.kit, c.locale);
  const byId = new Map(drafts.map((d) => [d.sourceId, d]));
  return ids.flatMap((id) => {
    const d = byId.get(id);
    const s = d ? c.sources.add(d) : null;
    return s ? [s] : [];
  });
}

const render = (s: ToolSource, facts?: string) =>
  [`[${s.n}] (${s.sourceType}) ${s.title}`, facts, s.content.split('\n').slice(1).join('\n').slice(0, SNIPPET)].filter(Boolean).join('\n');

/** Clients the user can see whose name matches (or whose id is) `q`, best match first. */
async function findClients(c: ToolContext, q: string, limit = 3): Promise<string[]> {
  if (/^[0-9a-f-]{36}$/i.test(q)) {
    const rows = await c.tx.execute<{ id: string }>(sql`select id from public.clients where id = ${q}::uuid`);
    return rows.map((r) => r.id);
  }
  const terms = [...new Set([searchTerms(q).join(' '), ...searchTerms(q)].filter(Boolean))];
  if (terms.length === 0) return [];
  const score = sql.join(
    terms.map((t) => sql`(${norm(clientHay('c'))} like ${like(t)})::int`),
    sql` + `,
  );
  const rows = await c.tx.execute<{ id: string }>(sql`
    select c.id from public.clients c
    where (${score}) > 0
    order by (${score}) desc, c.updated_at desc
    limit ${limit}`);
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Keyword search over each source type (no embedder)
// ---------------------------------------------------------------------------

const haystacks: Record<SourceType, { from: SQL; hay: SQL; where?: SQL }> = {
  client: {
    from: sql`public.clients s`,
    hay: sql.raw(
      `coalesce(s.name->>'ar','') || ' ' || coalesce(s.name->>'en','') || ' ' || coalesce(s.industry,'') || ' ' || coalesce(s.city,'')`,
    ),
  },
  campaign: {
    from: sql`public.campaigns s join public.clients cl on cl.id = s.client_id`,
    hay: sql.raw(`s.name || ' ' || coalesce(cl.name->>'ar','') || ' ' || coalesce(cl.name->>'en','')`),
  },
  request: {
    from: sql`public.requests s join public.clients cl on cl.id = s.client_id`,
    hay: sql.raw(`s.title || ' ' || coalesce(s.reference,'') || ' ' || coalesce(cl.name->>'ar','') || ' ' || coalesce(cl.name->>'en','')`),
    where: sql`s.status <> 'draft'`,
  },
  task: {
    from: sql`public.tasks s join public.clients cl on cl.id = s.client_id`,
    hay: sql.raw(`s.title || ' ' || coalesce(cl.name->>'ar','') || ' ' || coalesce(cl.name->>'en','')`),
  },
  report: {
    from: sql`public.reports s join public.clients cl on cl.id = s.client_id`,
    hay: sql.raw(`s.title || ' ' || coalesce(cl.name->>'ar','') || ' ' || coalesce(cl.name->>'en','')`),
  },
  lead: { from: sql`public.leads s`, hay: sql.raw(`s.full_name || ' ' || coalesce(s.company,'')`), where: sql`s.merged_into_id is null` },
  deal: { from: sql`public.deals s`, hay: sql.raw(`s.title || ' ' || coalesce(s.company,'')`) },
  insight: {
    from: sql`public.ai_insights s join public.campaigns ca on ca.id = s.campaign_id`,
    hay: sql.raw(`ca.name || ' ' || s.kind || ' ' || s.metric`),
  },
};

async function keywordSearch(c: ToolContext, query: string, types: readonly SourceType[]): Promise<{ type: SourceType; id: string }[]> {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const hits: { type: SourceType; id: string; score: number }[] = [];
  for (const type of types) {
    const h = haystacks[type];
    const score = sql.join(
      terms.map((t) => sql`(${norm(h.hay)} like ${like(t)})::int`),
      sql` + `,
    );
    const rows = await c.tx.execute<{ id: string; score: number }>(sql`
      select s.id, (${score})::int as score from ${h.from}
      where (${score}) > 0 ${h.where ? sql`and ${h.where}` : sql``}
      order by score desc, s.updated_at desc
      limit 5`);
    hits.push(...rows.map((r) => ({ type, id: r.id, score: Number(r.score) })));
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 8);
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

type Out = { text: string; isError?: boolean };

async function searchRecords(c: ToolContext, input: { query: string; types?: SourceType[] }): Promise<Out> {
  const types = input.types?.length ? input.types : (Object.keys(haystacks) as SourceType[]);
  let found = c.semantic ? await c.semantic(input.query, input.types) : [];
  if (found.length === 0) found = await keywordSearch(c, input.query, types);
  const out: ToolSource[] = [];
  for (const type of new Set(found.map((f) => f.type))) {
    out.push(
      ...(await cite(
        c,
        type,
        found.filter((f) => f.type === type).map((f) => f.id),
      )),
    );
  }
  if (out.length === 0) return { text: 'No matching records the user can open.' };
  return { text: out.map((s) => render(s)).join('\n\n') };
}

const openStatuses = sql`('submitted','under_review','needs_info','accepted','in_progress','in_review','delivered')`;
const closedStatuses = sql`('closed','rejected','cancelled')`;

async function clientFilter(c: ToolContext, client: string | undefined, column: SQL): Promise<{ sql: SQL; none: boolean }> {
  if (!client) return { sql: sql``, none: false };
  const ids = await findClients(c, client);
  if (ids.length === 0) return { sql: sql``, none: true };
  return { sql: sql`and ${column} = any(${idArray(ids)})`, none: false };
}

async function listRequests(
  c: ToolContext,
  input: { status: 'open' | 'closed' | 'all'; client?: string; overdue?: boolean; limit: number },
): Promise<Out> {
  const client = await clientFilter(c, input.client, sql`r.client_id`);
  if (client.none) return { text: `No client the user can open matches "${input.client}".` };
  const where = sql`r.status <> 'draft'
    ${input.status === 'open' ? sql`and r.status in ${openStatuses}` : input.status === 'closed' ? sql`and r.status in ${closedStatuses}` : sql``}
    ${input.overdue ? sql`and r.due_date < ${c.today}::date and r.status not in ${closedStatuses}` : sql``}
    ${client.sql}`;
  const [count] = await c.tx.execute<{ n: number }>(sql`select count(*)::int as n from public.requests r where ${where}`);
  const rows = await c.tx.execute<{ id: string }>(sql`
    select r.id from public.requests r where ${where}
    order by (r.due_date is null), r.due_date, r.created_at desc limit ${input.limit}`);
  const out = await cite(
    c,
    'request',
    rows.map((r) => r.id),
  );
  const total = Number(count?.n ?? 0);
  return { text: [`Matching requests: ${total} (showing ${out.length}). Today is ${c.today}.`, ...out.map((s) => render(s))].join('\n\n') };
}

async function listTasks(
  c: ToolContext,
  input: {
    due: 'overdue' | 'today' | 'this_week' | 'any';
    assignee: 'me' | 'anyone';
    client?: string;
    include_done: boolean;
    limit: number;
  },
): Promise<Out> {
  const client = await clientFilter(c, input.client, sql`t.client_id`);
  if (client.none) return { text: `No client the user can open matches "${input.client}".` };
  const due =
    input.due === 'overdue'
      ? sql`and t.due_date < ${c.today}::date and t.status_category <> 'done'`
      : input.due === 'today'
        ? sql`and t.due_date = ${c.today}::date`
        : input.due === 'this_week'
          ? sql`and t.due_date between ${c.today}::date and ${addDays(c.today, 6)}::date`
          : sql``;
  const where = sql`true
    ${input.include_done || input.due === 'overdue' ? sql`` : sql`and t.status_category <> 'done'`}
    ${due}
    ${input.assignee === 'me' ? sql`and exists (select 1 from public.task_members m where m.task_id = t.id and m.user_id = ${c.userId}::uuid and m.role = 'assignee')` : sql``}
    ${client.sql}`;
  const [count] = await c.tx.execute<{ n: number }>(sql`select count(*)::int as n from public.tasks t where ${where}`);
  const rows = await c.tx.execute<{ id: string }>(sql`
    select t.id from public.tasks t where ${where}
    order by (t.due_date is null), t.due_date, t.updated_at desc limit ${input.limit}`);
  const out = await cite(
    c,
    'task',
    rows.map((r) => r.id),
  );
  const total = Number(count?.n ?? 0);
  return { text: [`Matching tasks: ${total} (showing ${out.length}). Today is ${c.today}.`, ...out.map((s) => render(s))].join('\n\n') };
}

/** Inclusive date range of a period in the agency's calendar. */
export function periodRange(period: 'this_month' | 'last_month' | 'last_30_days', today: string): { from: string; to: string } {
  if (period === 'last_30_days') return { from: addDays(today, -29), to: today };
  const first = `${today.slice(0, 7)}-01`;
  if (period === 'this_month') return { from: first, to: today };
  const lastOfPrev = addDays(first, -1);
  return { from: `${lastOfPrev.slice(0, 7)}-01`, to: lastOfPrev };
}

const money = (minor: number, currency: string) =>
  `${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const count = (n: number) => n.toLocaleString('en-US');

type CampaignTotals = {
  id: string;
  currency: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  conversions: number;
};

async function campaignTotals(c: ToolContext, from: string, to: string, filter: SQL, limit: number): Promise<CampaignTotals[]> {
  const rows = await c.tx.execute<Record<string, unknown>>(sql`
    select ca.id, ca.currency,
      coalesce(sum(m.spend_minor),0)::bigint as spend, coalesce(sum(m.impressions),0)::bigint as impressions,
      coalesce(sum(m.clicks),0)::bigint as clicks, coalesce(sum(m.leads),0)::bigint as leads,
      coalesce(sum(m.conversions),0)::bigint as conversions
    from public.campaigns ca
    join public.metrics_daily m on m.campaign_id = ca.id and m.date between ${from}::date and ${to}::date
    where true ${filter}
    group by ca.id, ca.currency
    order by spend desc
    limit ${limit}`);
  return rows.map((r) => ({
    id: String(r.id),
    currency: String(r.currency ?? 'SAR').trim(),
    spend: Number(r.spend),
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
    leads: Number(r.leads),
    conversions: Number(r.conversions),
  }));
}

const totalsLine = (t: CampaignTotals) =>
  [
    `spend ${money(t.spend, t.currency)}`,
    `impressions ${count(t.impressions)}`,
    `clicks ${count(t.clicks)}`,
    `leads ${count(t.leads)}`,
    `conversions ${count(t.conversions)}`,
    t.leads > 0 ? `cost per lead ${money(Math.round(t.spend / t.leads), t.currency)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

async function campaignMetrics(c: ToolContext, input: { client?: string; campaign?: string; days: number }): Promise<Out> {
  const client = await clientFilter(c, input.client, sql`ca.client_id`);
  if (client.none) return { text: `No client the user can open matches "${input.client}".` };
  const terms = input.campaign ? searchTerms(input.campaign) : [];
  const named = terms.length
    ? sql`and (${sql.join(
        terms.map((t) => sql`(${norm(sql`ca.name`)} like ${like(t)})::int`),
        sql` + `,
      )}) > 0`
    : sql``;
  const to = c.today;
  const from = addDays(to, -(input.days - 1));
  const totals = await campaignTotals(c, from, to, sql`${client.sql} ${named}`, 10);
  const out = await cite(
    c,
    'campaign',
    totals.map((t) => t.id),
  );
  if (out.length === 0) return { text: `No campaign the user can open has numbers between ${from} and ${to}.` };
  const byId = new Map(totals.map((t) => [t.id, t]));
  return {
    text: [
      `Campaign totals from ${from} to ${to} (computed by the platform):`,
      ...out.map((s) => render(s, `Period totals: ${totalsLine(byId.get(s.sourceId)!)}`)),
    ].join('\n\n'),
  };
}

async function clientOverview(
  c: ToolContext,
  input: { client: string; period: 'this_month' | 'last_month' | 'last_30_days' },
): Promise<Out> {
  const [clientId] = await findClients(c, input.client, 1);
  if (!clientId) return { text: `No client the user can open matches "${input.client}".` };
  const [client] = await cite(c, 'client', [clientId]);
  if (!client) return { text: `No client the user can open matches "${input.client}".` };
  const { from, to } = periodRange(input.period, c.today);
  const tz = c.timeZone;
  const [req] = await c.tx.execute<Record<string, number>>(sql`
    select count(*)::int as received,
      count(*) filter (where r.status in ${openStatuses})::int as still_open,
      count(*) filter (where r.status = 'closed')::int as closed
    from public.requests r
    where r.client_id = ${clientId}::uuid and r.status <> 'draft'
      and (coalesce(r.submitted_at, r.created_at) at time zone ${tz})::date between ${from}::date and ${to}::date`);
  const [openReq] = await c.tx.execute<{ n: number }>(sql`
    select count(*)::int as n from public.requests r where r.client_id = ${clientId}::uuid and r.status in ${openStatuses}`);
  const [tasks] = await c.tx.execute<Record<string, number>>(sql`
    select count(*) filter (where t.completed_at is not null and (t.completed_at at time zone ${tz})::date between ${from}::date and ${to}::date)::int as completed,
      count(*) filter (where t.status_category <> 'done')::int as open,
      count(*) filter (where t.status_category <> 'done' and t.due_date < ${c.today}::date)::int as overdue
    from public.tasks t where t.client_id = ${clientId}::uuid`);
  const totals = await campaignTotals(c, from, to, sql`and ca.client_id = ${clientId}::uuid`, 5);
  const campaignsCited = await cite(
    c,
    'campaign',
    totals.map((t) => t.id),
  );
  const recent = await c.tx.execute<{ id: string }>(sql`
    select r.id from public.requests r
    where r.client_id = ${clientId}::uuid and r.status <> 'draft'
      and (coalesce(r.submitted_at, r.created_at) at time zone ${tz})::date between ${from}::date and ${to}::date
    order by r.created_at desc limit 5`);
  const requestsCited = await cite(
    c,
    'request',
    recent.map((r) => r.id),
  );
  const byId = new Map(totals.map((t) => [t.id, t]));
  const facts = [
    `Client overview [${client.n}] for ${from} to ${to} (computed by the platform; today is ${c.today}):`,
    `Requests received in the period: ${req?.received ?? 0} (still open: ${req?.still_open ?? 0}, closed: ${req?.closed ?? 0}). Open requests now: ${openReq?.n ?? 0}.`,
    `Tasks completed in the period: ${tasks?.completed ?? 0}. Open tasks now: ${tasks?.open ?? 0}, of which overdue: ${tasks?.overdue ?? 0}.`,
    campaignsCited.length ? 'Campaigns with numbers in the period:' : 'No campaign numbers in the period.',
  ];
  return {
    text: [
      facts.join('\n'),
      render(client),
      ...campaignsCited.map((s) => render(s, `Period totals: ${totalsLine(byId.get(s.sourceId)!)}`)),
      ...(requestsCited.length ? ['Requests received in the period:', ...requestsCited.map((s) => render(s))] : []),
    ].join('\n\n'),
  };
}

/**
 * Runs one tool call as the user (ADR-090). Inputs are re-validated; an unknown tool, invalid input or a query error
 * becomes an `is_error` result the model can recover from — never an exception that ends the turn.
 */
export async function runTool(c: ToolContext, call: AiToolCall): Promise<AiToolResult> {
  if (!isToolName(call.name)) return { toolUseId: call.id, content: `Unknown tool "${call.name}".`, isError: true };
  const name: ToolName = call.name;
  const parsed = toolInputs[name].safeParse(call.input ?? {});
  if (!parsed.success)
    return { toolUseId: call.id, content: `Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}`, isError: true };
  // Each tool runs in a savepoint: a failed query must not abort the user's transaction for the next tool.
  try {
    const out = await c.tx.transaction(async (sp) => {
      const sc = { ...c, tx: sp };
      switch (name) {
        case 'search_records':
          return searchRecords(sc, parsed.data as z.infer<(typeof toolInputs)['search_records']>);
        case 'list_requests':
          return listRequests(sc, parsed.data as z.infer<(typeof toolInputs)['list_requests']>);
        case 'list_tasks':
          return listTasks(sc, parsed.data as z.infer<(typeof toolInputs)['list_tasks']>);
        case 'client_overview':
          return clientOverview(sc, parsed.data as z.infer<(typeof toolInputs)['client_overview']>);
        case 'campaign_metrics':
          return campaignMetrics(sc, parsed.data as z.infer<(typeof toolInputs)['campaign_metrics']>);
      }
    });
    return { toolUseId: call.id, content: out.text, isError: out.isError };
  } catch (error) {
    console.error('[ai] tool failed', name, error);
    return {
      toolUseId: call.id,
      content: 'The tool failed; answer from the other results or say the data could not be read.',
      isError: true,
    };
  }
}
