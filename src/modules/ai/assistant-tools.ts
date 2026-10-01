/**
 * The assistant's read-only tools (ADR-090) — the pure half: definitions shown to the model, input validation, text
 * normalization for keyword search and the mock provider's deterministic tool plan. Execution lives in
 * `server/assistant-tools.ts` and always runs as the asking user, inside their RLS.
 */
import { z } from 'zod';

import type { AiToolCall, AiToolSpec } from '@/modules/ai/providers/types';
import { sourceTypes } from '@/modules/ai/types';

export const toolInputs = {
  search_records: z.object({
    query: z.string().trim().min(1).max(200),
    types: z.array(z.enum(sourceTypes)).max(sourceTypes.length).optional(),
  }),
  list_requests: z.object({
    status: z.enum(['open', 'closed', 'all']).default('open'),
    client: z.string().trim().max(120).optional(),
    overdue: z.boolean().optional(),
    limit: z.number().int().min(1).max(25).default(15),
  }),
  list_tasks: z.object({
    due: z.enum(['overdue', 'today', 'this_week', 'any']).default('any'),
    assignee: z.enum(['me', 'anyone']).default('anyone'),
    client: z.string().trim().max(120).optional(),
    include_done: z.boolean().default(false),
    limit: z.number().int().min(1).max(25).default(15),
  }),
  client_overview: z.object({
    client: z.string().trim().min(1).max(120),
    period: z.enum(['this_month', 'last_month', 'last_30_days']).default('this_month'),
  }),
  campaign_metrics: z.object({
    client: z.string().trim().max(120).optional(),
    campaign: z.string().trim().max(120).optional(),
    days: z.number().int().min(1).max(90).default(30),
  }),
} as const;

export type ToolName = keyof typeof toolInputs;
export const toolNames = Object.keys(toolInputs) as ToolName[];
export const isToolName = (v: string): v is ToolName => v in toolInputs;

const clientParam = { type: 'string', description: 'A client name (Arabic or English, partial is fine) or id.' };

/** Descriptions are instructions to the model: English, and explicit about when to use each tool. */
export const toolSpecs: AiToolSpec[] = [
  {
    name: 'search_records',
    description:
      'Find records by name or topic across clients, campaigns, requests, tasks, reports, leads, deals and insights. Use it when the question names something (a person, a campaign, a request) or for open-ended questions. Returns numbered sources.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for, in the language of the records (usually Arabic).' },
        types: { type: 'array', items: { type: 'string', enum: [...sourceTypes] }, description: 'Optional: only these record types.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_requests',
    description:
      'List client requests (briefs submitted through the portal), newest first, with status, priority and due date. Use it for questions about open, pending, late or closed requests.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Default open (not closed, rejected or cancelled).' },
        client: clientParam,
        overdue: { type: 'boolean', description: 'Only requests past their due date.' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_tasks',
    description:
      'List tasks with status, due date and assignees. Use it for questions about overdue tasks, today’s or this week’s work, or a client’s open tasks. "overdue" means due before today and not done.',
    inputSchema: {
      type: 'object',
      properties: {
        due: { type: 'string', enum: ['overdue', 'today', 'this_week', 'any'] },
        assignee: { type: 'string', enum: ['me', 'anyone'], description: '"me" for the asking user’s own tasks.' },
        client: clientParam,
        include_done: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'client_overview',
    description:
      'A computed summary of one client for a period: requests received and their status, tasks completed / open / overdue, and campaign spend, leads and clicks. Use it to summarize a client’s month.',
    inputSchema: {
      type: 'object',
      properties: { client: clientParam, period: { type: 'string', enum: ['this_month', 'last_month', 'last_30_days'] } },
      required: ['client'],
      additionalProperties: false,
    },
  },
  {
    name: 'campaign_metrics',
    description:
      'Totals per campaign for the last N days (spend, impressions, clicks, leads, conversions, cost per lead), optionally for one client or campaign. Numbers are computed by the platform; quote them as given.',
    inputSchema: {
      type: 'object',
      properties: {
        client: clientParam,
        campaign: { type: 'string', description: 'A campaign name (partial is fine).' },
        days: { type: 'integer', minimum: 1, maximum: 90 },
      },
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Keyword search terms (no embedder, ADR-090)
// ---------------------------------------------------------------------------

/** Folds Arabic spelling variants (alef forms, yaa / alef maqsura, taa marbuta), drops diacritics and tatweel. */
export function normalizeArabic(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

/** Question words and fillers (MSA, Gulf / Egyptian colloquial, English) that never identify a record. */
const STOP = new Set(
  [
    'ما',
    'ماذا',
    'ايه',
    'إيه',
    'ايش',
    'وش',
    'كم',
    'هل',
    'من',
    'في',
    'على',
    'عن',
    'الى',
    'إلى',
    'مع',
    'او',
    'أو',
    'و',
    'يا',
    'عايز',
    'عاوز',
    'ابغى',
    'أبغى',
    'ابي',
    'أبي',
    'اريد',
    'أريد',
    'ممكن',
    'لو',
    'سمحت',
    'اعطني',
    'أعطني',
    'هات',
    'لي',
    'لنا',
    'تقرير',
    'ملخص',
    'لخص',
    'لخّص',
    'وضع',
    'حالة',
    'كل',
    'جميع',
    'اليوم',
    'النهارده',
    'النهاردة',
    'الان',
    'الآن',
    'هذا',
    'هذه',
    'the',
    'a',
    'an',
    'of',
    'for',
    'to',
    'in',
    'on',
    'and',
    'or',
    'is',
    'are',
    'what',
    'which',
    'who',
    'how',
    'show',
    'me',
    'my',
    'give',
    'list',
    'all',
    'summarize',
    'summary',
    'report',
    'status',
    'please',
    'today',
    'this',
    'month',
    'client',
    "client's",
    'about',
  ].map(normalizeArabic),
);

/** Strips the common Arabic clitics and plural suffixes so "بطلبات" finds "طلب" (light stemming, not morphology). */
function stem(word: string): string {
  let w = word;
  for (const p of ['وبال', 'بال', 'وال', 'فال', 'كال', 'لل', 'ال']) {
    if (w.startsWith(p) && w.length - p.length >= 3) {
      w = w.slice(p.length);
      break;
    }
  }
  if (w.length >= 4 && /^[وبفل]/.test(w) && !STOP.has(w.slice(1))) w = w.slice(1);
  for (const s of ['ات', 'ون', 'ين', 'ها', 'هم', 'ه']) {
    if (w.endsWith(s) && w.length - s.length >= 3) {
      w = w.slice(0, -s.length);
      break;
    }
  }
  return w;
}

/** Search terms of a query: normalized, stemmed, without fillers and duplicates; at most six. */
export function searchTerms(query: string): string[] {
  const words = normalizeArabic(query)
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/['’]s$/, '').replace(/^['’-]+|['’-]+$/g, ''))
    .filter(Boolean)
    .filter((w) => !STOP.has(w));
  const terms = words.map(stem).filter((w) => w.length >= 2 && !STOP.has(w));
  return [...new Set(terms)].slice(0, 6);
}

/** The SQL twin of `normalizeArabic` for a text expression (diacritics, alef / yaa / taa marbuta forms). */
export const SQL_NORMALIZE_FROM = 'أإآٱىةؤئ';
export const SQL_NORMALIZE_TO = 'ااااياهوي';

// ---------------------------------------------------------------------------
// Mock provider plan
// ---------------------------------------------------------------------------

const REQUESTS = /طلب|request|brief/i;
const TASKS = /مهم|مهام|task|todo/i;
const OVERDUE = /متأخر|متاخر|overdue|late|past due/i;
const TODAY = /اليوم|النهارد|today/i;
const CAMPAIGNS = /حمل|campaign|اعلان|إعلان|ads?\b|spend|leads?\b/i;
const CLIENT_SUMMARY = /(?:summari[sz]e|overview|ملخص|لخ[ّ]?ص)\s+(?:client\s+|العميل\s+|عميل\s+)?([^\s'’?؟]+)/i;

/**
 * The mock's tool plan for a question (ADR-073/090): deterministic keyword rules so demos and tests exercise the same
 * loop, tools and RLS as the live model. The live model plans for itself.
 */
export function planMockTools(question: string): AiToolCall[] {
  const calls: Omit<AiToolCall, 'id'>[] = [];
  const summary = CLIENT_SUMMARY.exec(question);
  if (summary && /client|عميل|العميل/i.test(question))
    calls.push({ name: 'client_overview', input: { client: summary[1], period: 'this_month' } });
  if (TASKS.test(question)) {
    calls.push({ name: 'list_tasks', input: { due: OVERDUE.test(question) ? 'overdue' : TODAY.test(question) ? 'today' : 'any' } });
  } else if (REQUESTS.test(question)) {
    calls.push({
      name: 'list_requests',
      input: { status: /مغلق|closed/i.test(question) ? 'closed' : 'open', overdue: OVERDUE.test(question) },
    });
  }
  if (calls.length === 0 && CAMPAIGNS.test(question) && !searchTerms(question).length)
    calls.push({ name: 'campaign_metrics', input: { days: 30 } });
  if (calls.length === 0) calls.push({ name: 'search_records', input: { query: question } });
  return calls.map((c, i) => ({ ...c, id: `mock_tool_${i + 1}` }));
}
