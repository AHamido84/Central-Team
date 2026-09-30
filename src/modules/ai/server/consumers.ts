import 'server-only';

import { eq } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { aiInsights, campaigns, clients } from '@/lib/db/schema';
import { defineConsumer } from '@/lib/events/dispatcher';
import { localized } from '@/lib/i18n/localized';
import { reindexForEvent } from '@/modules/ai/server/indexer';
import { runCampaignAnalysis } from '@/modules/ai/server/insights';
import { autoDraftScheduledReport } from '@/modules/ai/server/reports';
import { notify } from '@/modules/notifications/server/notify';

/** Fresh numbers or a changed plan → run the detectors for that campaign (ADR-074). */
export const aiAnalysis = defineConsumer({
  name: 'ai.analysis',
  types: ['metrics.synced', 'metrics.recorded', 'metrics.imported', 'campaign.updated', 'campaign.status_changed'],
  async handle(event) {
    await runCampaignAnalysis(event.payload.campaignId);
  },
});

/**
 * Warning and critical insights → the campaign owner and the client's account manager (category `ai`, agency only).
 * Info-level findings (good news) stay on the insights page.
 */
export const aiNotifications = defineConsumer({
  name: 'notifications.ai',
  types: ['ai_insight.detected'],
  async handle(event) {
    if (event.payload.severity === 'info') return;
    const [row] = await dbAdmin
      .select({ i: aiInsights, campaign: campaigns.name, owner: campaigns.ownerId, client: clients.name, am: clients.accountManagerId })
      .from(aiInsights)
      .innerJoin(campaigns, eq(campaigns.id, aiInsights.campaignId))
      .innerJoin(clients, eq(clients.id, aiInsights.clientId))
      .where(eq(aiInsights.id, event.payload.insightId));
    if (!row || row.i.status !== 'open') return;
    const userIds = [...new Set([row.owner, row.am].filter((u): u is string => Boolean(u)))];
    if (!userIds.length) return;
    await notify({
      organizationId: event.organizationId,
      actorId: null,
      eventId: event.id,
      userIds,
      type: 'ai_insight',
      params: {
        campaign: row.campaign,
        client: localized(row.client, 'ar') || localized(row.client, 'en'),
        kind: row.i.kind,
        severity: row.i.severity,
      },
      link: `/insights/${row.i.id}`,
    });
  },
});

/** Keeps the assistant's index in step with the records it covers (ADR-075). */
export const aiIndexer = defineConsumer({
  name: 'ai.indexer',
  types: [
    'client.created',
    'client.updated',
    'campaign.created',
    'campaign.updated',
    'campaign.status_changed',
    'campaign.health_changed',
    'campaign.deleted',
    'metrics.synced',
    'metrics.recorded',
    'metrics.imported',
    'request.submitted',
    'request.status_changed',
    'request.brief_updated',
    'request.triaged',
    'task.created',
    'task.updated',
    'task.status_changed',
    'task.deleted',
    'report.created',
    'report.updated',
    'report.published',
    'report.deleted',
    'lead.created',
    'lead.updated',
    'lead.merged',
    'deal.created',
    'deal.updated',
    'deal.stage_changed',
    'ai_insight.detected',
    'ai_insight.status_changed',
  ],
  async handle(event) {
    await reindexForEvent(event);
  },
});

/** Scheduled report drafts get AI commentary when the organization asked for it (ADR-077). */
export const aiReportDrafts = defineConsumer({
  name: 'ai.report_drafts',
  types: ['report.draft_ready'],
  async handle(event) {
    await autoDraftScheduledReport(event.organizationId, event.payload.reportId);
  },
});
