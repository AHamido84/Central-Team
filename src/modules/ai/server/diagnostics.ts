import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { ActionFailure } from '@/lib/actions/errors';
import type { AgencyContext } from '@/lib/auth/context';
import { dbAdmin } from '@/lib/db/client';
import { withRls } from '@/lib/db/rls';
import { aiChunks, aiCredentials } from '@/lib/db/schema';
import type { Locale } from '@/lib/i18n/localized';
import type { AiFailureCode } from '@/modules/ai/errors';
import { textKit } from '@/modules/ai/kit';
import { failureCode, runAssistant } from '@/modules/ai/server/assistant';
import { runTool, SourceRegistry } from '@/modules/ai/server/assistant-tools';
import { getAIClient, invalidateAiClient } from '@/modules/ai/server/client';
import { AiCallFailure, embedTexts, generate, loadAiSettings, tokensThisMonth } from '@/modules/ai/server/runtime';
import { AiProviderError } from '@/modules/ai/providers/types';
import { dayInZone } from '@/modules/tasks/constants';

export const diagnosticSteps = ['switch', 'budget', 'key', 'model', 'embedder', 'retrieval', 'answer'] as const;
export type DiagnosticKey = (typeof diagnosticSteps)[number];

export type DiagnosticStep = {
  key: DiagnosticKey;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  /** A note under `ai.admin.test.note.*` with its values, for passes and warnings. */
  note?: string;
  values?: Record<string, string | number>;
  /** For failures: the translated reason (`errors.<code>`) and, for admins, the provider's own words. */
  code?: AiFailureCode;
  detail?: string;
  ms?: number;
};

const detailOf = (error: unknown) =>
  error instanceof AiProviderError || error instanceof AiCallFailure
    ? error.detail.slice(0, 300)
    : error instanceof ActionFailure
      ? ''
      : String((error as Error)?.message ?? '').slice(0, 300);

/**
 * "Test assistant" (FR3.5): the whole chain once, as the admin who runs it — switch, budget, key decrypt, a call with
 * the configured model, the embedder (or the keyword fallback), retrieval through the user's RLS and a final answer.
 * Each step reports pass / fail with the reason; after a blocking failure the rest is skipped. Spends a few thousand
 * tokens (counted like any other call).
 */
export async function runDiagnostics(ctx: AgencyContext, locale: Locale): Promise<DiagnosticStep[]> {
  const org = ctx.organization.id;
  const ids = { organizationId: org, userId: ctx.session.userId };
  const steps: DiagnosticStep[] = [];
  const skipRest = () => {
    for (const key of diagnosticSteps) if (!steps.some((s) => s.key === key)) steps.push({ key, status: 'skip' });
    return steps;
  };
  const timed = async <T>(fn: () => Promise<T>) => {
    const t0 = Date.now();
    const value = await fn();
    return { value, ms: Date.now() - t0 };
  };

  // 1. Switch
  const settings = await loadAiSettings(org);
  if (!settings.enabled) {
    steps.push({ key: 'switch', status: 'fail', code: 'ai_disabled' });
    return skipRest();
  }
  steps.push({ key: 'switch', status: 'pass', note: 'switchOn' });

  // 2. Budget
  const used = await tokensThisMonth(org);
  if (used >= settings.monthlyTokenBudget) {
    steps.push({ key: 'budget', status: 'fail', code: 'ai_budget_exceeded', values: { used, budget: settings.monthlyTokenBudget } });
    return skipRest();
  }
  steps.push({ key: 'budget', status: 'pass', note: 'budgetLeft', values: { used, budget: settings.monthlyTokenBudget } });

  // 3. Key decrypt (fresh: not the cached client)
  invalidateAiClient(org);
  const client = await getAIClient(org);
  if (client.decryptFailed.includes('anthropic')) {
    steps.push({ key: 'key', status: 'fail', code: 'ai_not_configured', note: 'decryptFailed' });
    return skipRest();
  }
  if (!client.completer) {
    steps.push({ key: 'key', status: 'fail', code: 'ai_not_configured', note: 'noKey' });
    return skipRest();
  }
  if (client.completer.key === 'mock') steps.push({ key: 'key', status: 'pass', note: 'keyMock' });
  else if (client.sources.anthropic) {
    // Service path: the masked hint only, for the report (ADR-085).
    const [cred] = await dbAdmin
      .select({ hint: aiCredentials.keyHint })
      .from(aiCredentials)
      .where(eq(aiCredentials.id, client.sources.anthropic.id));
    steps.push({ key: 'key', status: 'pass', note: 'keyOrg', values: { hint: cred?.hint ?? '' } });
  } else steps.push({ key: 'key', status: 'pass', note: 'keyEnv' });

  // 4. One call with the configured model
  const model = client.completer.model;
  try {
    const { value, ms } = await timed(() =>
      generate(ids, {
        purpose: 'assistant',
        locale,
        system: 'This is a connection test. Reply with the single word OK.',
        messages: [{ role: 'user', content: 'ping' }],
        grounding: { kind: 'insight', lines: [] },
      }),
    );
    steps.push({ key: 'model', status: 'pass', note: 'modelOk', values: { model: value.model || model }, ms });
  } catch (error) {
    steps.push({ key: 'model', status: 'fail', code: failureCode(error), values: { model }, detail: detailOf(error) });
    return skipRest();
  }

  // 5. Embedder, or the keyword fallback (Voyage is optional — ADR-090)
  const embedder = client.embedder;
  if (!embedder) steps.push({ key: 'embedder', status: 'warn', note: 'embedderNone' });
  else {
    try {
      const { ms } = await timed(() => embedTexts(embedder, ids, ['test'], 'query'));
      const [row] = await dbAdmin
        .select({ n: sql<number>`count(*)::int` })
        .from(aiChunks)
        .where(and(eq(aiChunks.organizationId, org), eq(aiChunks.embeddingModel, embedder.model)));
      const chunks = row?.n ?? 0;
      steps.push(
        chunks > 0
          ? { key: 'embedder', status: 'pass', note: 'embedderOk', values: { model: embedder.model, chunks }, ms }
          : { key: 'embedder', status: 'warn', note: 'indexBuilding', values: { model: embedder.model }, ms },
      );
    } catch (error) {
      steps.push({ key: 'embedder', status: 'warn', note: 'embedderFailed', code: failureCode(error), detail: detailOf(error) });
    }
  }

  // 6. Retrieval through the admin's own RLS
  const kit = textKit(locale, ctx.organization.defaultTimezone);
  const question = kit.t('admin.test.sampleQuestion');
  try {
    const { value: count, ms } = await timed(() =>
      withRls(async (tx) => {
        const sources = new SourceRegistry();
        const c = {
          tx,
          userId: ctx.session.userId,
          locale,
          kit,
          timeZone: ctx.organization.defaultTimezone,
          today: dayInZone(new Date(), ctx.organization.defaultTimezone),
          sources,
        };
        await runTool(c, { id: 'diag_1', name: 'list_requests', input: { status: 'open', limit: 5 } });
        await runTool(c, { id: 'diag_2', name: 'search_records', input: { query: question } });
        return sources.list().length;
      }, ctx.session),
    );
    steps.push(
      count > 0
        ? { key: 'retrieval', status: 'pass', note: 'sources', values: { count }, ms }
        : { key: 'retrieval', status: 'warn', note: 'noSources', ms },
    );
  } catch (error) {
    steps.push({ key: 'retrieval', status: 'fail', code: 'ai_unavailable', detail: detailOf(error) });
    return skipRest();
  }

  // 7. A full answer to the sample question
  try {
    const { value, ms } = await timed(() => runAssistant(ctx, locale, [], question));
    if (!value.ok) steps.push({ key: 'answer', status: 'fail', code: value.reason, values: { model } });
    else {
      steps.push({
        key: 'answer',
        status: value.citations.length ? 'pass' : 'warn',
        note: value.citations.length ? 'answerOk' : 'answerNoCitations',
        values: { citations: value.citations.length, tools: value.tools.join(', ') || '—', retrieval: value.retrieval },
        detail: value.text.slice(0, 400),
        ms,
      });
    }
  } catch (error) {
    steps.push({ key: 'answer', status: 'fail', code: failureCode(error), values: { model }, detail: detailOf(error) });
  }
  return steps;
}
