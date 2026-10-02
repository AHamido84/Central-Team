import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { campaigns, clientUsers, clients, reports } from '@/lib/db/schema';
import { defineConsumer } from '@/lib/events/dispatcher';
import { localized } from '@/lib/i18n/localized';
import { notify } from '@/modules/notifications/server/notify';

const clientName = (name: Parameters<typeof localized>[0]) => localized(name, 'ar') || localized(name, 'en');

async function clientRecipients(clientId: string): Promise<string[]> {
  return (
    await dbAdmin
      .select({ userId: clientUsers.userId })
      .from(clientUsers)
      .where(and(eq(clientUsers.clientId, clientId), eq(clientUsers.status, 'active')))
  ).map((u) => u.userId);
}

async function portalEnabled(organizationId: string): Promise<boolean> {
  const [row] = await dbAdmin.execute<{ on: boolean }>(sql`select app.feature_enabled(${organizationId}::uuid, 'module.campaigns') as on`);
  return Boolean(row?.on);
}

async function loadCampaign(campaignId: string) {
  const [row] = await dbAdmin
    .select({ c: campaigns, clientName: clients.name, am: clients.accountManagerId })
    .from(campaigns)
    .innerJoin(clients, eq(clients.id, campaigns.clientId))
    .where(eq(campaigns.id, campaignId));
  return row ?? null;
}

/**
 * Campaigns & reports → notifications (ADR-028). Client side: a campaign went live, a report was published.
 * Agency side (the campaign owner, else the client's account manager): at risk / off track, no new numbers,
 * a scheduled report waiting for review.
 */
export const campaignNotifications = defineConsumer({
  name: 'notifications.campaigns',
  types: ['campaign.status_changed', 'campaign.health_changed', 'campaign.metrics_stale', 'report.published', 'report.draft_ready'],
  async handle(event) {
    const base = { organizationId: event.organizationId, actorId: event.actorId, eventId: event.id };
    switch (event.type) {
      case 'campaign.status_changed': {
        if (event.payload.to !== 'active' || event.payload.from !== 'planned') return;
        const row = await loadCampaign(event.payload.campaignId);
        if (!row || row.c.visibility !== 'client' || !(await portalEnabled(event.organizationId))) return;
        await notify({
          ...base,
          userIds: await clientRecipients(row.c.clientId),
          type: 'campaign_started',
          params: { campaign: row.c.name },
          link: `/portal/campaigns/${row.c.id}`,
        });
        return;
      }
      case 'campaign.health_changed':
      case 'campaign.metrics_stale': {
        const row = await loadCampaign(event.payload.campaignId);
        const owner = row?.c.ownerId ?? row?.am;
        if (!row || !owner) return;
        const params = { campaign: row.c.name, client: clientName(row.clientName) };
        await notify(
          event.type === 'campaign.health_changed'
            ? {
                ...base,
                userIds: [owner],
                type: 'campaign_at_risk',
                params: { ...params, health: event.payload.to },
                link: `/campaigns/${row.c.id}`,
              }
            : {
                ...base,
                userIds: [owner],
                type: 'campaign_metrics_stale',
                params: { ...params, days: event.payload.days },
                link: `/campaigns/${row.c.id}?tab=metrics`,
              },
        );
        return;
      }
      case 'report.published':
      case 'report.draft_ready': {
        const [row] = await dbAdmin
          .select({ r: reports, clientName: clients.name, am: clients.accountManagerId, owner: campaigns.ownerId })
          .from(reports)
          .innerJoin(clients, eq(clients.id, reports.clientId))
          .leftJoin(campaigns, eq(campaigns.id, reports.campaignId))
          .where(eq(reports.id, event.payload.reportId));
        if (!row) return;
        if (event.type === 'report.published') {
          if (row.r.status !== 'published' || !(await portalEnabled(event.organizationId))) return;
          await notify({
            ...base,
            userIds: await clientRecipients(row.r.clientId),
            type: 'report_published',
            params: { report: row.r.title },
            link: `/portal/reports/${row.r.id}`,
          });
          return;
        }
        const reviewer = row.owner ?? row.am;
        if (!reviewer) return;
        await notify({
          ...base,
          userIds: [reviewer],
          type: 'report_ready',
          params: { report: row.r.title, client: clientName(row.clientName) },
          link: `/reports/${row.r.id}`,
        });
        return;
      }
    }
  },
});
