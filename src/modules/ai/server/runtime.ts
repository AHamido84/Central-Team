import 'server-only';

import { and, eq, gte, sql } from 'drizzle-orm';

import { ActionFailure } from '@/lib/actions/errors';
import { dbAdmin } from '@/lib/db/client';
import { aiSettings, aiUsage } from '@/lib/db/schema';
import { getAIClient, type AiClient } from '@/modules/ai/server/client';
import { AiProviderError, type AiEmbedder, type AiErrorCode, type CompleteInput, type CompleteResult } from '@/modules/ai/providers/types';

export type AiSettingsRow = typeof aiSettings.$inferSelect;

/**
 * A provider failure as an action failure (translated code for people) that keeps the provider's own words, so
 * "Test assistant" can show admins exactly what Anthropic or Voyage answered (FR3.5). The detail is never sent to
 * the thread or to non-admins.
 */
export class AiCallFailure extends ActionFailure {
  constructor(
    code: AiErrorCode,
    readonly detail: string,
  ) {
    super(code);
  }
}

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

export async function tokensThisMonth(organizationId: string, now = new Date(), provider?: string): Promise<number> {
  const [row] = await dbAdmin
    .select({ total: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::int` })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.organizationId, organizationId),
        gte(aiUsage.createdAt, monthStart(now)),
        provider ? eq(aiUsage.provider, provider) : undefined,
      ),
    );
  return row?.total ?? 0;
}

/** A credential's own monthly limit (FR1.5), on top of the organization budget. */
async function assertCredentialLimit(organizationId: string, client: AiClient, provider: 'anthropic' | 'voyage') {
  const source = client.sources[provider];
  if (source?.monthlyTokenLimit == null) return;
  if ((await tokensThisMonth(organizationId, new Date(), provider)) >= source.monthlyTokenLimit) {
    throw new ActionFailure('ai_budget_exceeded');
  }
}

/**
 * Throws a translated failure unless this organization may call a model now: AI switched on (ADR-076), a provider
 * configured (ADR-073) and budget left this month.
 */
export async function assertAiReady(organizationId: string): Promise<AiSettingsRow> {
  const settings = await loadAiSettings(organizationId);
  if (!settings.enabled) throw new ActionFailure('ai_disabled');
  if ((await getAIClient(organizationId)).mode === 'off') throw new ActionFailure('ai_not_configured');
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
  const client = await getAIClient(ctx.organizationId);
  const completer = client.completer;
  if (!completer) throw new ActionFailure('ai_not_configured');
  await assertCredentialLimit(ctx.organizationId, client, 'anthropic');
  let result: CompleteResult;
  try {
    result = await completer.complete(input);
  } catch (error) {
    if (error instanceof AiProviderError) {
      console.error('[ai] completion failed', error.detail);
      throw new AiCallFailure(error.code, error.detail);
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

/** The organization's embedder, or null when no provider is configured (the indexer then waits). */
export async function currentEmbedder(organizationId: string): Promise<AiEmbedder | null> {
  return (await getAIClient(organizationId)).embedder;
}

/** Embeds texts and records the tokens against the organization (indexing and questions both count). */
export async function embedTexts(
  embedder: AiEmbedder,
  ctx: { organizationId: string; userId: string | null },
  texts: string[],
  kind: 'document' | 'query',
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (embedder.key === 'voyage') await assertCredentialLimit(ctx.organizationId, await getAIClient(ctx.organizationId), 'voyage');
  let out: { vectors: number[][]; tokens: number };
  try {
    out = await embedder.embed(texts, kind);
  } catch (error) {
    if (error instanceof AiProviderError) {
      console.error('[ai] embedding failed', error.detail);
      throw new AiCallFailure(error.code, error.detail);
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
