import 'server-only';

import { and, eq, gte, sql } from 'drizzle-orm';

import { ActionFailure } from '@/lib/actions/errors';
import { dbAdmin } from '@/lib/db/client';
import { aiSettings, aiUsage } from '@/lib/db/schema';
import { aiMode, getCompleter, getEmbedder } from '@/modules/ai/providers';
import { AiProviderError, type AiEmbedder, type CompleteInput, type CompleteResult } from '@/modules/ai/providers/types';

export type AiSettingsRow = typeof aiSettings.$inferSelect;

export async function loadAiSettings(organizationId: string): Promise<AiSettingsRow> {
  const [row] = await dbAdmin.select().from(aiSettings).where(eq(aiSettings.organizationId, organizationId));
  return (
    row ?? {
      organizationId,
      enabled: false,
      sensitivity: 'normal',
      autoDraftReports: false,
      monthlyTokenBudget: 0,
      updatedBy: null,
      updatedAt: new Date(),
    }
  );
}

/** First day of the current month (UTC) — the budget window. */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function tokensThisMonth(organizationId: string, now = new Date()): Promise<number> {
  const [row] = await dbAdmin
    .select({ total: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::int` })
    .from(aiUsage)
    .where(and(eq(aiUsage.organizationId, organizationId), gte(aiUsage.createdAt, monthStart(now))));
  return row?.total ?? 0;
}

/**
 * Throws a translated failure unless this organization may call a model now: AI switched on (ADR-076), a provider
 * configured (ADR-073) and budget left this month.
 */
export async function assertAiReady(organizationId: string): Promise<AiSettingsRow> {
  const settings = await loadAiSettings(organizationId);
  if (!settings.enabled) throw new ActionFailure('ai_disabled');
  if (aiMode() === 'off') throw new ActionFailure('ai_not_configured');
  if ((await tokensThisMonth(organizationId)) >= settings.monthlyTokenBudget) throw new ActionFailure('ai_budget_exceeded');
  return settings;
}

// Usage rows are bookkeeping written with the service connection after the call (ADR-073): users have no INSERT
// on ai_usage, so nobody can forge or erase what the budget counts.
async function recordUsage(row: typeof aiUsage.$inferInsert): Promise<void> {
  await dbAdmin.insert(aiUsage).values(row);
}

/** One model call with guardrails and a usage record. Refusals come back as `stop: 'refusal'` for the caller to show. */
export async function generate(ctx: { organizationId: string; userId: string | null }, input: CompleteInput): Promise<CompleteResult> {
  await assertAiReady(ctx.organizationId);
  const completer = getCompleter();
  if (!completer) throw new ActionFailure('ai_not_configured');
  let result: CompleteResult;
  try {
    result = await completer.complete(input);
  } catch (error) {
    if (error instanceof AiProviderError) {
      console.error('[ai] completion failed', error.detail);
      throw new ActionFailure(error.code);
    }
    throw error;
  }
  await recordUsage({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    purpose: input.purpose,
    provider: completer.key,
    model: result.model,
    inputTokens: result.usage.input,
    outputTokens: result.usage.output,
  });
  return result;
}

/** The embedder, or null when no provider is configured (the indexer then waits). */
export function currentEmbedder(): AiEmbedder | null {
  return getEmbedder();
}

/** Embeds texts and records the tokens against the organization (indexing and questions both count). */
export async function embedTexts(
  embedder: AiEmbedder,
  ctx: { organizationId: string; userId: string | null },
  texts: string[],
  kind: 'document' | 'query',
): Promise<number[][]> {
  if (texts.length === 0) return [];
  let out: { vectors: number[][]; tokens: number };
  try {
    out = await embedder.embed(texts, kind);
  } catch (error) {
    if (error instanceof AiProviderError) {
      console.error('[ai] embedding failed', error.detail);
      throw new ActionFailure(error.code);
    }
    throw error;
  }
  await recordUsage({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    purpose: 'embedding',
    provider: embedder.key,
    model: embedder.model,
    inputTokens: out.tokens,
    outputTokens: 0,
  });
  return out.vectors;
}
