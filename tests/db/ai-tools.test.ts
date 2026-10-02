/**
 * FR3.3 / ADR-090 in the database: the assistant's tools work without an embedder (keyword search, lists, overviews)
 * and run as the asking user — every record they return is one the user can open; a Specialist gets nothing from other
 * clients or the CRM, and a client they can't see is "not found" rather than summarized.
 */
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'test-publishable-key';
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key-for-signing-0000';

import { beforeAll, describe, expect, it } from 'vitest';

import { runAs } from '@/lib/db/rls';
import { textKit } from '@/modules/ai/kit';
import { runTool, SourceRegistry, type ToolSource } from '@/modules/ai/server/assistant-tools';
import { dayInZone } from '@/modules/tasks/constants';

import { as, sql, userId } from './helpers';

const TZ = 'Asia/Riyadh';
const today = dayInZone(new Date(), TZ);

/** Runs one tool call as `email` (no embedder: keyword search) and returns the text and the records it numbered. */
async function tool(email: string, name: string, input: unknown): Promise<{ text: string; sources: ToolSource[]; isError?: boolean }> {
  const sub = await userId(email);
  return runAs({ sub, role: 'authenticated' }, async (tx) => {
    const sources = new SourceRegistry();
    const r = await runTool(
      { tx, userId: sub, locale: 'ar', kit: textKit('ar', TZ), timeZone: TZ, today, sources },
      { id: 't1', name, input },
    );
    return { text: r.content, sources: sources.list(), isError: r.isError };
  });
}

/** The ids `email` can SELECT in `table` — ground truth straight from RLS. */
async function visibleIds(email: string, table: string): Promise<Set<string>> {
  const rows = await as(email, (tx) => tx.unsafe<{ id: string }[]>(`select id from public.${table}`));
  return new Set(rows.map((r) => r.id));
}

let khalidClients: Set<string>;
let lujainName: string;
let lujainId: string;

beforeAll(async () => {
  khalidClients = await visibleIds('khalid@ofoq.test', 'clients');
  const [lujain] = await sql<
    { id: string; name: string }[]
  >`select id, name->>'ar' as name from public.clients where slug = 'lujain-fashion'`;
  if (!lujain) throw new Error('Seed missing — run pnpm db:reset');
  lujainId = lujain.id;
  lujainName = lujain.name;
  expect(khalidClients.size).toBeGreaterThan(0);
  expect(khalidClients.has(lujainId), 'khalid must not be assigned to Lujain for this test').toBe(false);
});

describe('assistant tools without an embedder (ADR-090)', () => {
  it('list_requests (open) for an admin matches the open requests in the database', async () => {
    const [n] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.requests
      where status in ('submitted','under_review','needs_info','accepted','in_progress','in_review','delivered') and deleted_at is null`;
    const r = await tool('sara@ofoq.test', 'list_requests', { status: 'open', limit: 25 });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain(`Matching requests: ${n!.n}`);
    expect(r.sources.length).toBe(Math.min(25, n!.n));
    expect(r.sources.every((s) => s.sourceType === 'request' && s.url === `/requests/${s.sourceId}`)).toBe(true);
  });

  it("a Specialist's lists only hold records of their assigned clients", async () => {
    const visibleRequests = await visibleIds('khalid@ofoq.test', 'requests');
    const visibleTasks = await visibleIds('khalid@ofoq.test', 'tasks');
    const req = await tool('khalid@ofoq.test', 'list_requests', { status: 'all', limit: 25 });
    const tasks = await tool('khalid@ofoq.test', 'list_tasks', { due: 'any', include_done: true, limit: 25 });
    expect(req.sources.length + tasks.sources.length).toBeGreaterThan(0);
    for (const s of req.sources) expect(visibleRequests.has(s.sourceId)).toBe(true);
    for (const s of tasks.sources) expect(visibleTasks.has(s.sourceId)).toBe(true);
    const [other] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.requests where id = any(${req.sources.map((s) => s.sourceId)}::uuid[]) and client_id = ${lujainId}`;
    expect(other!.n).toBe(0);
  });

  it('search_records by keyword finds a client by name for an admin, and nothing of it for a Specialist', async () => {
    const admin = await tool('sara@ofoq.test', 'search_records', { query: `عايز ملخص عن ${lujainName}` });
    expect(admin.sources.some((s) => s.sourceType === 'client' && s.sourceId === lujainId)).toBe(true);
    const specialist = await tool('khalid@ofoq.test', 'search_records', { query: lujainName });
    expect(specialist.sources.some((s) => s.sourceId === lujainId)).toBe(false);
    const lujainCampaigns = await sql<{ id: string }[]>`select id from public.campaigns where client_id = ${lujainId}`;
    const ids = new Set(lujainCampaigns.map((c) => c.id));
    expect(specialist.sources.some((s) => ids.has(s.sourceId))).toBe(false);
  });

  it('a Specialist without CRM access never gets leads or deals', async () => {
    const [lead] = await sql<{ full_name: string }[]>`select full_name from public.leads where merged_into_id is null limit 1`;
    const r = await tool('khalid@ofoq.test', 'search_records', { query: lead!.full_name });
    expect(r.sources.some((s) => s.sourceType === 'lead' || s.sourceType === 'deal')).toBe(false);
    const admin = await tool('sara@ofoq.test', 'search_records', { query: lead!.full_name, types: ['lead'] });
    expect(admin.sources.some((s) => s.sourceType === 'lead')).toBe(true);
  });

  it("client_overview refuses a client the user can't open, and summarizes one they can", async () => {
    const denied = await tool('khalid@ofoq.test', 'client_overview', { client: lujainName, period: 'this_month' });
    expect(denied.text).toMatch(/No client the user can open/);
    expect(denied.sources).toHaveLength(0);
    const ok = await tool('sara@ofoq.test', 'client_overview', { client: lujainName, period: 'last_30_days' });
    expect(ok.sources[0]).toMatchObject({ sourceType: 'client', sourceId: lujainId });
    expect(ok.text).toMatch(/Requests received in the period: \d+/);
    expect(ok.text).toMatch(/Open tasks now: \d+, of which overdue: \d+/);
  });

  it('list_tasks (overdue) only returns unfinished tasks due before today', async () => {
    const r = await tool('sara@ofoq.test', 'list_tasks', { due: 'overdue', limit: 25 });
    const ids = r.sources.map((s) => s.sourceId);
    if (ids.length === 0) return;
    const rows = await sql<{ due_date: string; status_category: string }[]>`
      select due_date::text, status_category from public.tasks where id = any(${ids}::uuid[])`;
    for (const t of rows) {
      expect(t.status_category).not.toBe('done');
      expect(t.due_date < today).toBe(true);
    }
  });

  it('invalid input and unknown tools come back as tool errors, not exceptions', async () => {
    expect((await tool('sara@ofoq.test', 'list_tasks', { due: 'yesterday' })).isError).toBe(true);
    expect((await tool('sara@ofoq.test', 'drop_tables', {})).isError).toBe(true);
  });
});
