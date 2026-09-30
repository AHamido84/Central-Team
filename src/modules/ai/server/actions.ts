'use server';

import { and, eq, ne } from 'drizzle-orm';
import { getLocale } from 'next-intl/server';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import { dbAdmin } from '@/lib/db/client';
import { aiConversations, aiInsights, aiRecommendations, aiSettings, campaigns, taskMembers, taskStatuses, tasks } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { emitEvent } from '@/lib/events/emit';
import type { Locale } from '@/lib/i18n/localized';
import { can } from '@/lib/permissions/can';
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
import { catchUpIndex } from '@/modules/ai/server/indexer';
import { prepareReportDraft, writeReportDraft } from '@/modules/ai/server/reports';
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
