import 'server-only';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { ActionFailure } from '@/lib/actions/errors';
import type { AgencyContext } from '@/lib/auth/context';
import type { Tx } from '@/lib/db/client';
import { withRls } from '@/lib/db/rls';
import { dbAdmin } from '@/lib/db/client';
import { aiChunks, aiConversations, aiMessages } from '@/lib/db/schema';
import type { Locale } from '@/lib/i18n/localized';
import { isAiFailureCode, type AiFailureCode } from '@/modules/ai/errors';
import { textKit } from '@/modules/ai/kit';
import { ASSISTANT_HISTORY, assistantToolsPrompt, resolveCitations } from '@/modules/ai/prompts';
import { AiProviderError, type AiEmbedder, type AiToolResult, type AiTurn, type GroundingSource } from '@/modules/ai/providers/types';
import { runTool, SourceRegistry } from '@/modules/ai/server/assistant-tools';
import { getAIClient } from '@/modules/ai/server/client';
import { assertAiReady, embedTexts, generate } from '@/modules/ai/server/runtime';
import type { Citation, SourceType } from '@/modules/ai/types';
import { dayInZone } from '@/modules/tasks/constants';

export const RETRIEVAL_K = 8;

export type RetrievedChunk = GroundingSource & { sourceId: string; url: string; similarity: number };

/**
 * Nearest chunks to a query vector **as the caller** (ADR-075): runs in the user's RLS transaction, so the chunk
 * policy (ai:use + the source row visible to them) filters the candidates. HNSW iterative scan keeps returning
 * candidates until k rows pass the filter.
 */
export async function searchChunks(tx: Tx, vector: number[], model: string, minSimilarity: number): Promise<RetrievedChunk[]> {
  const literal = `[${vector.join(',')}]`;
  await tx.execute(sql`select set_config('hnsw.iterative_scan', 'relaxed_order', true)`);
  const rows = await tx.execute<{
    source_type: SourceType;
    source_id: string;
    title: string;
    url: string;
    content: string;
    similarity: number;
  }>(sql`
    select source_type, source_id, title, url, content,
      1 - (embedding operator(extensions.<=>) ${literal}::extensions.vector) as similarity
    from public.ai_chunks
    where embedding_model = ${model}
    order by embedding operator(extensions.<=>) ${literal}::extensions.vector
    limit ${RETRIEVAL_K}`);
  return rows
    .filter((r) => Number(r.similarity) >= minSimilarity)
    .map((r, i) => ({
      n: i + 1,
      sourceType: r.source_type,
      sourceId: r.source_id,
      title: r.title,
      url: r.url,
      content: r.content,
      similarity: Number(r.similarity),
    }));
}

export type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  status: 'ok' | 'failed' | 'refused' | 'budget' | 'disabled' | 'no_sources';
  /** Why a reply failed (FR3.2) — translated as a specific reason in the thread. */
  reason: AiFailureCode | null;
  /** The model that answered, or the configured model when it was the problem (`ai_model_unavailable`). */
  model: string | null;
  createdAt: string;
};

const statusOf = (code: AiFailureCode): AssistantMessage['status'] =>
  code === 'ai_disabled' ? 'disabled' : code === 'ai_budget_exceeded' ? 'budget' : code === 'ai_refused' ? 'refused' : 'failed';

/** Saves the question (creating the conversation when needed) in the caller's transaction. */
export async function recordQuestion(
  tx: Tx,
  ctx: AgencyContext,
  input: { conversationId?: string; question: string },
): Promise<{ conversationId: string; history: AiTurn[] }> {
  let conversationId = input.conversationId;
  if (conversationId) {
    const [c] = await tx.select({ id: aiConversations.id }).from(aiConversations).where(eq(aiConversations.id, conversationId));
    if (!c) throw new ActionFailure('not_found');
  } else {
    conversationId = crypto.randomUUID();
    const title = input.question.replace(/\s+/g, ' ').slice(0, 80);
    await tx.insert(aiConversations).values({ id: conversationId, organizationId: ctx.organization.id, userId: ctx.session.userId, title });
  }
  const previous = await tx
    .select({ role: aiMessages.role, content: aiMessages.content })
    .from(aiMessages)
    .where(and(eq(aiMessages.conversationId, conversationId), eq(aiMessages.status, 'ok')))
    .orderBy(desc(aiMessages.createdAt))
    .limit(ASSISTANT_HISTORY);
  await tx.insert(aiMessages).values({ organizationId: ctx.organization.id, conversationId, role: 'user', content: input.question });
  const history = previous.reverse().map((m) => ({ role: m.role as AiTurn['role'], content: m.content }));
  // The API wants turns to alternate starting with the user; drop a leading assistant turn.
  while (history[0]?.role === 'assistant') history.shift();
  return { conversationId, history };
}

/** Tool rounds per question; the last one must answer (tools declared, `tool_choice: none`). */
export const MAX_TOOL_ROUNDS = 4;
/** Stop starting new rounds after this long, so the route's 300 s limit is never what ends the turn (ADR-089). */
export const ASSISTANT_DEADLINE_MS = 200_000;

export type AssistantStep = 'tools' | 'answer';
export type AssistantOutcome =
  | {
      ok: true;
      text: string;
      citations: Citation[];
      sources: number;
      tools: string[];
      retrieval: 'semantic' | 'keyword';
      model: string;
      usage: { input: number; output: number };
    }
  | { ok: false; reason: AiFailureCode; model: string | null; usage: { input: number; output: number } };

/** The configured writer model, for messages about it — never throws. */
async function configuredModel(organizationId: string): Promise<string | null> {
  try {
    return (await getAIClient(organizationId)).completer?.model ?? null;
  } catch {
    return null;
  }
}

/** Whether vector search can serve this organization: an embedder, and chunks of its model (else keyword search). */
async function semanticReady(organizationId: string, embedder: AiEmbedder | null): Promise<boolean> {
  if (!embedder) return false;
  // Service path: index status is organization-wide bookkeeping (ADR-075); readers still see only their chunks.
  const [row] = await dbAdmin
    .select({ n: sql<number>`count(*)::int` })
    .from(aiChunks)
    .where(and(eq(aiChunks.organizationId, organizationId), eq(aiChunks.embeddingModel, embedder.model)));
  return (row?.n ?? 0) > 0;
}

/**
 * Answers a question with read-only tools that run as the user (ADR-090): the model plans tool calls, each round's
 * calls run in one RLS transaction (`withRls`, the caller's session), results come back numbered, and the final text's
 * `[n]` markers are validated against what the tools returned (ADR-075). Model and embedding calls never run inside a
 * transaction (ADR-079). Throws `ActionFailure` with an `ai_*` code; `answerQuestion` turns that into a reply.
 */
export async function runAssistant(
  ctx: AgencyContext,
  locale: Locale,
  history: readonly AiTurn[],
  question: string,
  onStep?: (step: AssistantStep, detail: string) => void,
): Promise<AssistantOutcome> {
  const started = Date.now();
  const ids = { organizationId: ctx.organization.id, userId: ctx.session.userId };
  await assertAiReady(ctx.organization.id);
  const client = await getAIClient(ctx.organization.id);
  const embedder = client.embedder;
  const semantic = await semanticReady(ctx.organization.id, embedder);
  const today = dayInZone(new Date(), ctx.organization.defaultTimezone);
  const kit = textKit(locale, ctx.organization.defaultTimezone);
  const sources = new SourceRegistry();
  const base = assistantToolsPrompt(locale, question, history, today);
  const turns: AiTurn[] = [...base.messages];
  const usage = { input: 0, output: 0 };
  const toolsUsed: string[] = [];
  let model = client.completer?.model ?? '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (Date.now() - started > ASSISTANT_DEADLINE_MS) throw new ActionFailure('ai_timeout');
    const last = round === MAX_TOOL_ROUNDS - 1;
    const result = await generate(ids, {
      ...base,
      messages: turns,
      toolChoice: last ? 'none' : 'auto',
      grounding: { kind: 'assistant', question, sources: sources.list() },
    });
    usage.input += result.usage.input;
    usage.output += result.usage.output;
    model = result.model;
    if (result.stop === 'refusal') throw new ActionFailure('ai_refused');
    const calls = result.stop === 'tool_use' && !last ? (result.toolCalls ?? []) : [];
    if (calls.length === 0) {
      const { text, citations } = resolveCitations(result.text, sources.list());
      onStep?.('answer', `${citations.length}`);
      return {
        ok: true,
        text,
        citations,
        sources: sources.list().length,
        tools: toolsUsed,
        retrieval: semantic ? 'semantic' : 'keyword',
        model,
        usage,
      };
    }
    // Query vectors first (a provider call), so the RLS transaction below only runs SQL.
    const vectors = new Map<string, number[]>();
    if (semantic && embedder) {
      for (const call of calls) {
        const q = (call.input as { query?: unknown } | null)?.query;
        if (call.name === 'search_records' && typeof q === 'string' && q.trim()) {
          const [v] = await embedTexts(embedder, ids, [q], 'query');
          if (v) vectors.set(call.id, v);
        }
      }
    }
    const results = await withRls(async (tx) => {
      const out: AiToolResult[] = [];
      for (const call of calls) {
        const vector = vectors.get(call.id);
        out.push(
          await runTool(
            {
              tx,
              userId: ctx.session.userId,
              locale,
              kit,
              timeZone: ctx.organization.defaultTimezone,
              today,
              sources,
              semantic:
                vector && embedder
                  ? async (_q, types) =>
                      (await searchChunks(tx, vector, embedder.model, embedder.key === 'mock' ? 0.15 : 0.2))
                        .filter((c) => !types?.length || types.includes(c.sourceType))
                        .map((c) => ({ type: c.sourceType, id: c.sourceId }))
                  : undefined,
            },
            call,
          ),
        );
      }
      return out;
    }, ctx.session);
    toolsUsed.push(...calls.map((c) => c.name));
    onStep?.('tools', calls.map((c) => c.name).join(', '));
    turns.push({ role: 'assistant', content: result.text, toolCalls: calls, raw: result.raw });
    turns.push({ role: 'user', content: '', toolResults: results });
  }
  throw new ActionFailure('ai_timeout');
}

/** Any failure as one of our codes (an unexpected exception is a provider/service problem from the user's side). */
export function failureCode(error: unknown): AiFailureCode {
  if (error instanceof ActionFailure && isAiFailureCode(error.code)) return error.code;
  if (error instanceof AiProviderError) return error.code;
  return 'ai_unavailable';
}

/**
 * Answers a recorded question and stores the reply. Every outcome — including "AI is off", a rejected key or a timeout
 * — becomes an assistant message with a specific reason (FR3.2), and nothing here throws: the thread explains itself
 * and the page never falls back to the error screen.
 */
export async function answerQuestion(
  ctx: AgencyContext,
  locale: Locale,
  prepared: { conversationId: string; history: AiTurn[] },
  question: string,
): Promise<AssistantMessage> {
  const save = async (row: {
    content: string;
    citations?: Citation[];
    status: AssistantMessage['status'];
    reason?: AiFailureCode | null;
    model?: string | null;
    usage?: { input: number; output: number };
  }): Promise<AssistantMessage> => {
    const fallback: AssistantMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: row.content,
      citations: row.citations ?? [],
      status: row.status,
      reason: row.reason ?? null,
      model: row.model ?? null,
      createdAt: new Date().toISOString(),
    };
    try {
      const m = await withRls(async (tx) => {
        const [inserted] = await tx
          .insert(aiMessages)
          .values({
            organizationId: ctx.organization.id,
            conversationId: prepared.conversationId,
            role: 'assistant',
            content: row.content.slice(0, 20000),
            citations: row.citations ?? [],
            status: row.status,
            reason: row.reason ?? null,
            model: row.model ?? null,
            inputTokens: row.usage?.input ?? 0,
            outputTokens: row.usage?.output ?? 0,
          })
          .returning();
        return inserted!;
      }, ctx.session);
      return toMessage(m);
    } catch (error) {
      // Still show the reply: a storage hiccup must not turn into the error screen.
      console.error('[ai] saving the reply failed', error);
      return fallback;
    }
  };

  try {
    const r = await runAssistant(ctx, locale, prepared.history, question);
    if (r.ok) {
      return await save({ content: r.text, citations: r.citations, status: 'ok', model: r.model, usage: r.usage });
    }
    return await save({ content: '', status: statusOf(r.reason), reason: r.reason, model: r.model, usage: r.usage });
  } catch (error) {
    const reason = failureCode(error);
    if (!(error instanceof ActionFailure)) console.error('[ai] assistant failed', error);
    return save({ content: '', status: statusOf(reason), reason, model: await configuredModel(ctx.organization.id) });
  }
}

function toMessage(m: typeof aiMessages.$inferSelect): AssistantMessage {
  return {
    id: m.id,
    role: m.role as AssistantMessage['role'],
    content: m.content,
    citations: m.citations,
    status: m.status as AssistantMessage['status'],
    reason: isAiFailureCode(m.reason) ? m.reason : null,
    model: m.model,
    createdAt: m.createdAt.toISOString(),
  };
}

export type ConversationSummary = { id: string; title: string; lastMessageAt: string };

export async function listConversations(): Promise<ConversationSummary[]> {
  const rows = await withRls((tx) =>
    tx
      .select({ id: aiConversations.id, title: aiConversations.title, lastMessageAt: aiConversations.lastMessageAt })
      .from(aiConversations)
      .orderBy(desc(aiConversations.lastMessageAt))
      .limit(100),
  );
  return rows.map((r) => ({ id: r.id, title: r.title, lastMessageAt: r.lastMessageAt.toISOString() }));
}

export async function getConversation(conversationId: string): Promise<{ id: string; title: string; messages: AssistantMessage[] } | null> {
  return withRls(async (tx) => {
    const [c] = await tx.select().from(aiConversations).where(eq(aiConversations.id, conversationId));
    if (!c) return null;
    const rows = await tx
      .select()
      .from(aiMessages)
      .where(inArray(aiMessages.conversationId, [c.id]))
      .orderBy(asc(aiMessages.createdAt));
    return {
      id: c.id,
      title: c.title,
      messages: rows.map(toMessage),
    };
  });
}
