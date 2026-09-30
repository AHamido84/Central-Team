import 'server-only';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { ActionFailure } from '@/lib/actions/errors';
import type { AgencyContext } from '@/lib/auth/context';
import type { Tx } from '@/lib/db/client';
import { withRls } from '@/lib/db/rls';
import { aiConversations, aiMessages } from '@/lib/db/schema';
import type { Locale } from '@/lib/i18n/localized';
import { ASSISTANT_HISTORY, assistantPrompt, resolveCitations } from '@/modules/ai/prompts';
import type { AiTurn, GroundingSource } from '@/modules/ai/providers/types';
import { assertAiReady, currentEmbedder, embedTexts, generate } from '@/modules/ai/server/runtime';
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
  createdAt: string;
};

const statusOf: Record<string, AssistantMessage['status']> = {
  ai_disabled: 'disabled',
  ai_not_configured: 'disabled',
  ai_budget_exceeded: 'budget',
  ai_refused: 'refused',
};

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

/**
 * Answers a recorded question: embed → RLS-scoped search → grounded completion → validated citations. Every
 * outcome (including "AI is off" or "nothing found") is stored as the assistant's reply, so the thread explains itself.
 */
export async function answerQuestion(
  ctx: AgencyContext,
  locale: Locale,
  prepared: { conversationId: string; history: AiTurn[] },
  question: string,
): Promise<AssistantMessage> {
  const save = (row: {
    content: string;
    citations?: Citation[];
    status: AssistantMessage['status'];
    model?: string | null;
    usage?: { input: number; output: number };
  }) =>
    withRls(async (tx) => {
      const [m] = await tx
        .insert(aiMessages)
        .values({
          organizationId: ctx.organization.id,
          conversationId: prepared.conversationId,
          role: 'assistant',
          content: row.content,
          citations: row.citations ?? [],
          status: row.status,
          model: row.model ?? null,
          inputTokens: row.usage?.input ?? 0,
          outputTokens: row.usage?.output ?? 0,
        })
        .returning();
      return m!;
    }, ctx.session);
  const toMessage = (m: typeof aiMessages.$inferSelect): AssistantMessage => ({
    id: m.id,
    role: 'assistant',
    content: m.content,
    citations: m.citations,
    status: m.status as AssistantMessage['status'],
    createdAt: m.createdAt.toISOString(),
  });

  try {
    await assertAiReady(ctx.organization.id);
    const embedder = currentEmbedder();
    if (!embedder) throw new ActionFailure('ai_not_configured');
    const [vector] = await embedTexts(embedder, { organizationId: ctx.organization.id, userId: ctx.session.userId }, [question], 'query');
    const sources = await withRls((tx) => searchChunks(tx, vector!, embedder.model, embedder.key === 'mock' ? 0.15 : 0.2), ctx.session);
    if (sources.length === 0) return toMessage(await save({ content: '', status: 'no_sources' }));
    const today = dayInZone(new Date(), ctx.organization.defaultTimezone);
    const result = await generate(
      { organizationId: ctx.organization.id, userId: ctx.session.userId },
      assistantPrompt(locale, question, prepared.history, sources, today),
    );
    if (result.stop === 'refusal')
      return toMessage(await save({ content: '', status: 'refused', model: result.model, usage: result.usage }));
    const { text, citations } = resolveCitations(result.text, sources);
    return toMessage(await save({ content: text, citations, status: 'ok', model: result.model, usage: result.usage }));
  } catch (error) {
    if (error instanceof ActionFailure) {
      const status = statusOf[error.code] ?? 'failed';
      return toMessage(await save({ content: '', status }));
    }
    console.error('[ai] assistant failed', error);
    return toMessage(await save({ content: '', status: 'failed' }));
  }
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
      messages: rows.map((m) => ({
        id: m.id,
        role: m.role as AssistantMessage['role'],
        content: m.content,
        citations: m.citations,
        status: m.status as AssistantMessage['status'],
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });
}
