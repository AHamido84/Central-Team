'use server';

import { and, eq, ne, sql } from 'drizzle-orm';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { AgencyContext } from '@/lib/auth/context';
import { dbAdmin, type Tx } from '@/lib/db/client';
import { withRls } from '@/lib/db/rls';
import {
  aiConversations,
  aiCredentials,
  aiInsights,
  aiRecommendations,
  aiSettings,
  campaigns,
  taskMembers,
  taskStatuses,
  tasks,
} from '@/lib/db/schema';
import { env } from '@/lib/env';
import { emitEvent } from '@/lib/events/emit';
import type { Locale } from '@/lib/i18n/localized';
import { can } from '@/lib/permissions/can';
import { pickModel, type AiFailureCode } from '@/modules/ai/errors';
import { testAiKey } from '@/modules/ai/providers/test-key';
import { insightTitle, recommendationBody, recommendationTitle } from '@/modules/ai/insight-text';
import { textKit } from '@/modules/ai/kit';
import { insightFactLines, insightPrompt } from '@/modules/ai/prompts';
import {
  aiSettingsSchema,
  askSchema,
  conversationIdSchema,
  decideRecommendationSchema,
  draftReportSectionSchema,
  emptySchema,
  explainInsightSchema,
  insightStatusSchema,
  renameConversationSchema,
} from '@/modules/ai/schemas';
import { answerQuestion, recordQuestion } from '@/modules/ai/server/assistant';
import { catchUpIndex, scheduleReindex } from '@/modules/ai/server/indexer';
import { prepareReportDraft, writeReportDraft } from '@/modules/ai/server/reports';
import { decryptAiKey, invalidateAiClient } from '@/modules/ai/server/client';
import { runDiagnostics } from '@/modules/ai/server/diagnostics';
import { generate } from '@/modules/ai/server/runtime';
import { addDays, dayInZone } from '@/modules/tasks/constants';

const currentLocale = async (): Promise<Locale> => ((await getLocale()) === 'en' ? 'en' : 'ar');

const insightPaths = (id: string, campaignId?: string) => [
  '/insights',
  `/insights/${id}`,
  ...(campaignId ? [`/campaigns/${campaignId}`] : []),
];

// ---------------------------------------------------------------------------
// Insights & recommendations (ADR-074)
// ---------------------------------------------------------------------------

export const setInsightStatusAction = defineAction({
  input: insightStatusSchema,
  side: 'agency',
  permission: 'campaigns:manage',
  async handler({ input, tx, ctx }) {
    const [before] = await tx.select().from(aiInsights).where(eq(aiInsights.id, input.insightId));
    if (!before) throw new ActionFailure('not_found');
    if (before.status === 'resolved') throw new ActionFailure('invalid_status');
    const [row] = await tx
      .update(aiInsights)
      .set({ status: input.status, dismissReason: input.status === 'dismissed' ? (input.reason ?? null) : null })
      .where(eq(aiInsights.id, input.insightId))
      .returning({ id: aiInsights.id });
    if (!row) throw new ActionFailure('forbidden');
    if (before.status !== input.status) {
      await emitEvent(tx, {
        type: 'ai_insight.status_changed',
        organizationId: ctx.organization.id,
        actorId: ctx.session.userId,
        aggregate: { type: 'campaign', id: before.campaignId },
        clientId: before.clientId,
        payload: { insightId: before.id, campaignId: before.campaignId, clientId: before.clientId, from: before.status, to: input.status },
      });
    }
    return { id: row.id, campaignId: before.campaignId };
  },
  revalidate: (input, r) => insightPaths(input.insightId, r.campaignId),
});

export const decideRecommendationAction = defineAction({
  input: decideRecommendationSchema,
  side: 'agency',
  permission: 'campaigns:manage',
  async handler({ input, tx, ctx }) {
    const [rec] = await tx
      .select({ r: aiRecommendations, i: aiInsights, campaign: campaigns.name })
      .from(aiRecommendations)
      .innerJoin(aiInsights, eq(aiInsights.id, aiRecommendations.insightId))
      .innerJoin(campaigns, eq(campaigns.id, aiRecommendations.campaignId))
      .where(eq(aiRecommendations.id, input.recommendationId));
    if (!rec) throw new ActionFailure('not_found');
    if (rec.r.status !== 'proposed') throw new ActionFailure('invalid_status');
    let taskId: string | null = null;
    if (input.decision === 'accepted') {
      if (!can(ctx.permissions, 'tasks:create')) throw new ActionFailure('forbidden');
      const [status] = await tx.select().from(taskStatuses).where(eq(taskStatuses.isDefault, true));
      if (!status) throw new ActionFailure('invalid_status');
      const kit = textKit(await currentLocale(), ctx.organization.defaultTimezone);
      const title = recommendationTitle(kit, rec.r).slice(0, 200);
      const insight = { kind: rec.i.kind, metric: rec.i.metric, facts: rec.i.facts };
      taskId = crypto.randomUUID();
      // App-generated id and no RETURNING: the task SELECT policy can't see the new row yet (gotcha 28).
      await tx.insert(tasks).values({
        id: taskId,
        organizationId: ctx.organization.id,
        clientId: rec.r.clientId,
        title,
        description: kit.t('task.description', {
          insight: insightTitle(kit, insight),
          campaign: rec.campaign,
          body: recommendationBody(kit, rec.r),
          link: `${env().NEXT_PUBLIC_APP_URL}/insights/${rec.i.id}`,
        }),
        statusId: status.id,
        priority: rec.i.severity === 'critical' ? 'high' : 'normal',
        dueDate: input.dueDate ?? addDays(dayInZone(new Date(), ctx.organization.defaultTimezone), 3),
      });
      await emitEvent(tx, {
        type: 'task.created',
        organizationId: ctx.organization.id,
        actorId: ctx.session.userId,
        aggregate: { type: 'task', id: taskId },
        clientId: rec.r.clientId,
        payload: { taskId, clientId: rec.r.clientId, parentId: null },
      });
      if (input.assigneeId) {
        await tx
          .insert(taskMembers)
          .values({ taskId, userId: input.assigneeId, role: 'assignee', organizationId: ctx.organization.id, clientId: rec.r.clientId })
          .onConflictDoNothing();
        await emitEvent(tx, {
          type: 'task.assigned',
          organizationId: ctx.organization.id,
          actorId: ctx.session.userId,
          aggregate: { type: 'task', id: taskId },
          clientId: rec.r.clientId,
          payload: { taskId, clientId: rec.r.clientId, userIds: [input.assigneeId] },
        });
      }
    }
    const [row] = await tx
      .update(aiRecommendations)
      .set({
        status: input.decision,
        taskId,
        dismissReason: input.decision === 'dismissed' ? (input.reason ?? null) : null,
      })
      .where(eq(aiRecommendations.id, rec.r.id))
      .returning({ id: aiRecommendations.id });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'ai_recommendation.decided',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'campaign', id: rec.r.campaignId },
      clientId: rec.r.clientId,
      payload: {
        recommendationId: rec.r.id,
        insightId: rec.i.id,
        campaignId: rec.r.campaignId,
        clientId: rec.r.clientId,
        decision: input.decision,
        taskId,
      },
    });
    // Acting on a suggestion acknowledges the insight.
    if (input.decision === 'accepted' && rec.i.status === 'open') {
      await tx.update(aiInsights).set({ status: 'acknowledged' }).where(eq(aiInsights.id, rec.i.id));
    }
    return { taskId, insightId: rec.i.id, campaignId: rec.r.campaignId };
  },
  revalidate: (_input, r) => [...insightPaths(r.insightId, r.campaignId), '/tasks', '/my-work'],
});

export const explainInsightAction = defineAction({
  input: explainInsightSchema,
  side: 'agency',
  permission: 'ai:use',
  rateLimit: { key: 'ai_explain', max: 30, windowSeconds: 300 },
  async handler({ input, tx, ctx }) {
    // RLS-checked lookup: the reader must see the insight (campaign access) before anything is sent to a model.
    const [row] = await tx
      .select({ i: aiInsights, campaign: campaigns.name })
      .from(aiInsights)
      .innerJoin(campaigns, eq(campaigns.id, aiInsights.campaignId))
      .where(eq(aiInsights.id, input.insightId));
    if (!row) throw new ActionFailure('not_found');
    const recs = await tx
      .select()
      .from(aiRecommendations)
      .where(and(eq(aiRecommendations.insightId, row.i.id), ne(aiRecommendations.status, 'dismissed')));
    const locale = await currentLocale();
    const kit = textKit(locale, ctx.organization.defaultTimezone);
    return {
      id: row.i.id,
      campaignId: row.i.campaignId,
      locale,
      lines: insightFactLines(kit, { kind: row.i.kind, metric: row.i.metric, facts: row.i.facts }, recs, row.campaign),
    };
  },
  async complete({ prepared, ctx }) {
    const result = await generate(
      { organizationId: ctx.organization.id, userId: ctx.session.userId },
      insightPrompt(prepared.locale, prepared.lines),
    );
    if (result.stop === 'refusal' || !result.text) throw new ActionFailure('ai_refused');
    // Service path after the RLS-checked lookup above: the cached narrative is a derived, server-owned column.
    await dbAdmin
      .update(aiInsights)
      .set({ explanation: result.text.slice(0, 4000), explanationLocale: prepared.locale, explainedAt: new Date() })
      .where(eq(aiInsights.id, prepared.id));
    return { explanation: result.text };
  },
  revalidate: (input, r) => insightPaths(input.insightId, r.campaignId),
});

// ---------------------------------------------------------------------------
// Report drafts (ADR-077)
// ---------------------------------------------------------------------------

export const draftReportSectionAction = defineAction({
  input: draftReportSectionSchema,
  side: 'agency',
  permission: 'reports:manage',
  rateLimit: { key: 'ai_draft', max: 30, windowSeconds: 300 },
  async handler({ input, tx, ctx }) {
    if (!can(ctx.permissions, 'ai:use')) throw new ActionFailure('forbidden');
    return prepareReportDraft(tx, input.reportId, ctx.organization.defaultTimezone);
  },
  async complete({ input, prepared, ctx }) {
    return { text: await writeReportDraft(prepared, input.section, { organizationId: ctx.organization.id, userId: ctx.session.userId }) };
  },
});

// ---------------------------------------------------------------------------
// Settings & index (ai:manage)
// ---------------------------------------------------------------------------

export const saveAiSettingsAction = defineAction({
  input: aiSettingsSchema,
  side: 'agency',
  permission: 'ai:manage',
  async handler({ input, tx, ctx }) {
    const [before] = await tx.select().from(aiSettings).where(eq(aiSettings.organizationId, ctx.organization.id));
    if (!before) throw new ActionFailure('not_found');
    const [row] = await tx
      .update(aiSettings)
      .set(input)
      .where(eq(aiSettings.organizationId, ctx.organization.id))
      .returning({ id: aiSettings.organizationId });
    if (!row) throw new ActionFailure('forbidden');
    const fields = (Object.keys(input) as (keyof typeof input)[]).filter((k) => before[k] !== input[k]);
    if (fields.length) {
      await emitEvent(tx, {
        type: 'ai_settings.updated',
        organizationId: ctx.organization.id,
        actorId: ctx.session.userId,
        aggregate: { type: 'organization', id: ctx.organization.id },
        payload: { fields },
      });
    }
    return { fields };
  },
  revalidate: ['/admin/ai', '/assistant', '/insights'],
});

// ---------------------------------------------------------------------------
// Provider credentials (FR1.5 / ADR-085). Keys go straight to Vault; nothing returns them to the browser.
// ---------------------------------------------------------------------------

const credentialFields = z.object({
  displayName: z.string().trim().min(1, { message: 'required' }).max(80, { message: 'too_long' }),
  defaultModel: z.string().trim().max(100).nullable(),
  monthlyTokenLimit: z.number().int().min(0).max(1_000_000_000).nullable(),
  isActive: z.boolean(),
});
const apiKey = z.string().trim().min(8, { message: 'invalid_key' }).max(500, { message: 'too_long' });

async function credentialEvent(
  tx: Tx,
  ctx: AgencyContext,
  credentialId: string,
  provider: string,
  change: 'created' | 'updated' | 'rotated' | 'deleted' | 'tested',
) {
  await emitEvent(tx, {
    type: 'ai_credential.changed',
    organizationId: ctx.organization.id,
    actorId: ctx.session.userId,
    aggregate: { type: 'organization', id: ctx.organization.id },
    payload: { credentialId, provider, change },
  });
}

/** One active key per provider: switching one on switches the others off. */
async function deactivateOthers(tx: Tx, organizationId: string, provider: string, keep: string) {
  await tx
    .update(aiCredentials)
    .set({ isActive: false })
    .where(and(eq(aiCredentials.organizationId, organizationId), eq(aiCredentials.provider, provider), ne(aiCredentials.id, keep)));
}

export type ModelCheck =
  | { status: 'ok'; model: string | null }
  | { status: 'replaced'; from: string; model: string }
  | { status: 'key_failed'; code: AiFailureCode };

/**
 * After a credential is saved (FR3.6): an Anthropic key lists its models and a default model it no longer offers is
 * switched to a current one (the admin sees a warning); a Voyage change re-indexes in the background (FR3.4).
 */
async function afterCredentialSaved(ctx: AgencyContext, id: string): Promise<ModelCheck> {
  invalidateAiClient(ctx.organization.id);
  // Service path (ADR-085): provider and model are read with the owner connection right after the RLS-checked save.
  const [row] = await dbAdmin
    .select({ provider: aiCredentials.provider, defaultModel: aiCredentials.defaultModel, isActive: aiCredentials.isActive })
    .from(aiCredentials)
    .where(eq(aiCredentials.id, id));
  if (!row) return { status: 'ok', model: null };
  if (row.provider === 'voyage') {
    scheduleReindex(ctx.organization.id);
    return { status: 'ok', model: row.defaultModel };
  }
  const key = await decryptAiKey(id).catch(() => null);
  if (!key) return { status: 'key_failed', code: 'ai_not_configured' };
  const test = await testAiKey('anthropic', key);
  await recordKeyTest(ctx, id, test.ok, test.ok ? null : test.code);
  if (!test.ok) {
    console.error('[ai] key check after save failed', test.detail);
    return { status: 'key_failed', code: test.code };
  }
  const wanted = row.defaultModel || env().AI_MODEL;
  const pick = pickModel(test.models, wanted);
  if (!pick.replaced || !pick.model) return { status: 'ok', model: wanted };
  await withRls(async (tx) => {
    await tx.update(aiCredentials).set({ defaultModel: pick.model, updatedBy: ctx.session.userId }).where(eq(aiCredentials.id, id));
  }, ctx.session);
  invalidateAiClient(ctx.organization.id);
  return { status: 'replaced', from: wanted, model: pick.model };
}

/** Service path: the test outcome is bookkeeping on the credential (users can't write these columns). */
async function recordKeyTest(ctx: AgencyContext, id: string, ok: boolean, code: string | null) {
  await dbAdmin.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ctx.session.userId })}, true)`);
    await tx.execute(sql`select app.ai_credential_record_test(${id}::uuid, ${ok}, ${code})`);
  });
}

export const createAiCredentialAction = defineAction({
  input: credentialFields.extend({ provider: z.enum(['anthropic', 'voyage']), apiKey }),
  side: 'agency',
  permission: 'ai:manage',
  async handler({ input, tx, ctx }) {
    const id = crypto.randomUUID();
    if (input.isActive) await deactivateOthers(tx, ctx.organization.id, input.provider, id);
    // Explicit columns: users hold INSERT on these only (never on `secret_id`, which only the Vault function sets).
    await tx.execute(sql`
      insert into public.ai_credentials (id, organization_id, provider, display_name, key_hint, default_model,
        monthly_token_limit, is_active, created_by, updated_by)
      values (${id}::uuid, ${ctx.organization.id}::uuid, ${input.provider}, ${input.displayName}, '••••', ${input.defaultModel},
        ${input.monthlyTokenLimit}, ${input.isActive}, ${ctx.session.userId}::uuid, ${ctx.session.userId}::uuid)`);
    await tx.execute(sql`select app.ai_credential_put_key(${id}::uuid, ${input.apiKey})`);
    await credentialEvent(tx, ctx, id, input.provider, 'created');
    return { id };
  },
  async complete({ prepared, ctx }) {
    return { id: prepared.id, modelCheck: await afterCredentialSaved(ctx, prepared.id) };
  },
  revalidate: ['/admin/ai'],
});

export const updateAiCredentialAction = defineAction({
  input: credentialFields.extend({ id: z.uuid(), apiKey: apiKey.optional() }),
  side: 'agency',
  permission: 'ai:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx.select({ provider: aiCredentials.provider }).from(aiCredentials).where(eq(aiCredentials.id, input.id));
    if (!row) throw new ActionFailure('not_found');
    if (input.isActive) await deactivateOthers(tx, ctx.organization.id, row.provider, input.id);
    await tx
      .update(aiCredentials)
      .set({
        displayName: input.displayName,
        defaultModel: input.defaultModel,
        monthlyTokenLimit: input.monthlyTokenLimit,
        isActive: input.isActive,
        updatedBy: ctx.session.userId,
      })
      .where(eq(aiCredentials.id, input.id));
    if (input.apiKey) await tx.execute(sql`select app.ai_credential_put_key(${input.id}::uuid, ${input.apiKey})`);
    await credentialEvent(tx, ctx, input.id, row.provider, input.apiKey ? 'rotated' : 'updated');
    return { id: input.id };
  },
  async complete({ prepared, ctx }) {
    return { id: prepared.id, modelCheck: await afterCredentialSaved(ctx, prepared.id) };
  },
  revalidate: ['/admin/ai'],
});

export const deleteAiCredentialAction = defineAction({
  input: z.object({ id: z.uuid() }),
  side: 'agency',
  permission: 'ai:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx.delete(aiCredentials).where(eq(aiCredentials.id, input.id)).returning({ provider: aiCredentials.provider });
    if (!row) throw new ActionFailure('not_found');
    await credentialEvent(tx, ctx, input.id, row.provider, 'deleted');
    return { id: input.id, provider: row.provider };
  },
  async complete({ prepared, ctx }) {
    invalidateAiClient(ctx.organization.id);
    if (prepared.provider === 'voyage') scheduleReindex(ctx.organization.id);
    return { id: prepared.id };
  },
  revalidate: ['/admin/ai'],
});

/**
 * "Test connection": with a saved credential (`id`, decrypted on the server) or a key typed in the form and not saved
 * yet (`provider` + `apiKey`). Returns whether it works and the models the key can use — never the key.
 */
export const testAiCredentialAction = defineAction({
  input: z.union([
    z.object({ id: z.uuid() }),
    z.object({ provider: z.enum(['anthropic', 'voyage']), apiKey, model: z.string().trim().max(100).nullable().optional() }),
  ]),
  side: 'agency',
  permission: 'ai:manage',
  rateLimit: { key: 'ai_key_test', max: 20, windowSeconds: 600 },
  async handler({ input, tx }) {
    if (!('id' in input)) return { id: null, provider: input.provider, model: input.model ?? null };
    const [row] = await tx
      .select({ provider: aiCredentials.provider, model: aiCredentials.defaultModel })
      .from(aiCredentials)
      .where(eq(aiCredentials.id, input.id));
    if (!row) throw new ActionFailure('not_found');
    return { id: input.id, provider: row.provider as 'anthropic' | 'voyage', model: row.model };
  },
  async complete({ prepared, input, ctx }) {
    const key = prepared.id ? await decryptAiKey(prepared.id) : 'apiKey' in input ? input.apiKey : null;
    if (!key) throw new ActionFailure('not_found');
    const result = await testAiKey(prepared.provider, key, prepared.model);
    if (prepared.id) await recordKeyTest(ctx, prepared.id, result.ok, result.ok ? null : result.code);
    if (!result.ok) console.error('[ai] key test failed', prepared.provider, result.detail);
    return result.ok ? { ok: true as const, models: result.models } : { ok: false as const, code: result.code };
  },
  revalidate: ['/admin/ai'],
});

export const rebuildIndexAction = defineAction({
  input: emptySchema,
  side: 'agency',
  permission: 'ai:manage',
  rateLimit: { key: 'ai_rebuild', max: 5, windowSeconds: 600 },
  async handler({ ctx }) {
    const [s] = await dbAdmin
      .select({ enabled: aiSettings.enabled })
      .from(aiSettings)
      .where(eq(aiSettings.organizationId, ctx.organization.id));
    if (!s?.enabled) throw new ActionFailure('ai_disabled');
    return { organizationId: ctx.organization.id };
  },
  async complete({ prepared }) {
    // Service path: the index covers the whole organization (visibility is decided when it is read — ADR-075).
    return { indexed: await catchUpIndex(prepared.organizationId, 2000) };
  },
  revalidate: ['/admin/ai'],
});

/** "Test assistant" (FR3.5): the whole chain once, step by step, as the admin who runs it. */
export const testAssistantAction = defineAction({
  input: emptySchema,
  side: 'agency',
  permission: 'ai:manage',
  rateLimit: { key: 'ai_test_assistant', max: 6, windowSeconds: 600 },
  async handler() {
    return { locale: await currentLocale() };
  },
  async complete({ prepared, ctx }) {
    return { steps: await runDiagnostics(ctx, prepared.locale), at: new Date().toISOString() };
  },
});

// ---------------------------------------------------------------------------
// Assistant (ADR-075)
// ---------------------------------------------------------------------------

export const askAssistantAction = defineAction({
  input: askSchema,
  side: 'agency',
  permission: 'ai:use',
  rateLimit: { key: 'ai_assistant', max: 20, windowSeconds: 300 },
  async handler({ input, tx, ctx }) {
    return recordQuestion(tx, ctx, input);
  },
  async complete({ input, prepared, ctx }) {
    const message = await answerQuestion(ctx, await currentLocale(), prepared, input.question);
    return { conversationId: prepared.conversationId, message };
  },
  revalidate: (_input, r) => ['/assistant', `/assistant/${r.conversationId}`],
});

export const renameConversationAction = defineAction({
  input: renameConversationSchema,
  side: 'agency',
  permission: 'ai:use',
  async handler({ input, tx }) {
    const [row] = await tx
      .update(aiConversations)
      .set({ title: input.title })
      .where(eq(aiConversations.id, input.conversationId))
      .returning({ id: aiConversations.id });
    if (!row) throw new ActionFailure('not_found');
    return { id: row.id };
  },
  revalidate: (input) => ['/assistant', `/assistant/${input.conversationId}`],
});

export const deleteConversationAction = defineAction({
  input: conversationIdSchema,
  side: 'agency',
  permission: 'ai:use',
  async handler({ input, tx }) {
    const [row] = await tx
      .delete(aiConversations)
      .where(eq(aiConversations.id, input.conversationId))
      .returning({ id: aiConversations.id });
    if (!row) throw new ActionFailure('not_found');
    return { id: row.id };
  },
  revalidate: ['/assistant'],
});
