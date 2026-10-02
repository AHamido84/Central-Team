'use server';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { Tx } from '@/lib/db/client';
import {
  campaignChannels,
  campaignKpis,
  campaigns,
  deliverables,
  metricImports,
  metricsDaily,
  reportSchedules,
  reportSections,
  reports,
  requests,
} from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { dayInZone } from '@/modules/tasks/constants';
import { defaultReportSections, firstRunOn } from '@/modules/campaigns/periods';
import {
  campaignIdSchema,
  campaignInputSchema,
  campaignStatusSchema,
  createReportSchema,
  importMetricsSchema,
  linkDeliverableSchema,
  linkRequestSchema,
  reportIdSchema,
  saveMetricsSchema,
  saveReportSchema,
  saveScheduleSchema,
  scheduleIdSchema,
} from '@/modules/campaigns/schemas';
import { buildReportSnapshot, refreshCampaignHealth } from '@/modules/campaigns/server/analysis';

const campaignPaths = (id?: string) => [
  '/campaigns',
  '/portal/campaigns',
  '/portal',
  ...(id ? [`/campaigns/${id}`, `/portal/campaigns/${id}`] : []),
];
const reportPaths = (id?: string) => ['/reports', '/portal/reports', '/portal', ...(id ? [`/reports/${id}`, `/portal/reports/${id}`] : [])];

type BaseMetricValues = {
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  conversions: number;
  leads: number;
  video_views: number;
  engagements: number;
  revenue: number;
};

const toColumns = (r: BaseMetricValues) => ({
  impressions: r.impressions,
  reach: r.reach,
  clicks: r.clicks,
  spendMinor: r.spend,
  conversions: r.conversions,
  leads: r.leads,
  videoViews: r.video_views,
  engagements: r.engagements,
  revenueMinor: r.revenue,
});

const upsertSet = {
  impressions: sql`excluded.impressions`,
  reach: sql`excluded.reach`,
  clicks: sql`excluded.clicks`,
  spendMinor: sql`excluded.spend_minor`,
  conversions: sql`excluded.conversions`,
  leads: sql`excluded.leads`,
  videoViews: sql`excluded.video_views`,
  engagements: sql`excluded.engagements`,
  revenueMinor: sql`excluded.revenue_minor`,
  source: sql`excluded.source`,
  importId: sql`excluded.import_id`,
};

async function loadCampaign(tx: Tx, campaignId: string) {
  const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) throw new ActionFailure('not_found');
  return c;
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

/** Create or update a campaign with its channels (budget split) and KPI targets in one transaction. */
export const saveCampaignAction = defineAction({
  input: campaignInputSchema,
  side: 'agency',
  permission: 'campaigns:manage',
  async handler({ input, tx, ctx }) {
    const fields = {
      name: input.name,
      objective: input.objective,
      status: input.status,
      startDate: input.startDate,
      endDate: input.endDate,
      budgetMinor: input.budget,
      ownerId: input.ownerId,
      description: input.description,
      visibility: input.visibility,
    };
    let campaignId = input.campaignId;
    let previous: typeof campaigns.$inferSelect | null = null;
    if (campaignId) {
      previous = await loadCampaign(tx, campaignId);
      await tx.update(campaigns).set(fields).where(eq(campaigns.id, campaignId));
    } else {
      const [row] = await tx
        .insert(campaigns)
        .values({ ...fields, organizationId: ctx.organization.id, clientId: input.clientId })
        .returning({ id: campaigns.id });
      campaignId = row!.id;
    }
    const clientId = previous?.clientId ?? input.clientId;

    // Channels: update the ones that stay, add new ones, remove the rest — never one that already has numbers.
    const existing = await tx.select({ id: campaignChannels.id }).from(campaignChannels).where(eq(campaignChannels.campaignId, campaignId));
    const keep = new Set(input.channels.map((c) => c.id));
    const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (removed.length) {
      const [withData] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(metricsDaily)
        .where(inArray(metricsDaily.channelId, removed));
      if ((withData?.n ?? 0) > 0) throw new ActionFailure('channel_has_metrics');
      await tx.delete(campaignChannels).where(and(eq(campaignChannels.campaignId, campaignId), inArray(campaignChannels.id, removed)));
    }
    const existingIds = new Set(existing.map((e) => e.id));
    for (const [i, ch] of input.channels.entries()) {
      const values = { platform: ch.platform, name: ch.name, budgetMinor: ch.budget, externalRef: ch.externalRef, sortOrder: i };
      if (existingIds.has(ch.id)) {
        await tx
          .update(campaignChannels)
          .set(values)
          .where(and(eq(campaignChannels.id, ch.id), eq(campaignChannels.campaignId, campaignId)));
      } else {
        await tx.insert(campaignChannels).values({ ...values, id: ch.id, campaignId, organizationId: ctx.organization.id, clientId });
      }
    }

    // KPI targets are a small set edited as a whole.
    await tx.delete(campaignKpis).where(eq(campaignKpis.campaignId, campaignId));
    if (input.kpis.length) {
      await tx.insert(campaignKpis).values(
        input.kpis.map((k, i) => ({
          campaignId: campaignId!,
          organizationId: ctx.organization.id,
          clientId,
          metric: k.metric,
          target: k.target,
          channelId: k.channelId,
          sortOrder: i,
        })),
      );
    }

    const base = {
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'campaign', id: campaignId },
      clientId,
    };
    if (!previous) {
      await emitEvent(tx, { ...base, type: 'campaign.created', payload: { campaignId, clientId } });
    } else {
      const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter((k) => {
        const before = k === 'budgetMinor' ? previous!.budgetMinor : previous![k];
        return before !== fields[k];
      });
      await emitEvent(tx, {
        ...base,
        type: 'campaign.updated',
        payload: { campaignId, clientId, fields: [...changed, 'channels', 'kpis'] },
      });
      if (previous.status !== input.status) {
        await emitEvent(tx, {
          ...base,
          type: 'campaign.status_changed',
          payload: { campaignId, clientId, from: previous.status, to: input.status },
        });
      }
    }
    await refreshCampaignHealth(tx, campaignId, ctx.session.userId);
    return { campaignId };
  },
  revalidate: (_input, result) => campaignPaths(result.campaignId),
});

export const setCampaignStatusAction = defineAction({
  input: campaignStatusSchema,
  side: 'agency',
  permission: 'campaigns:manage',
  async handler({ input, tx, ctx }) {
    const c = await loadCampaign(tx, input.campaignId);
    if (c.status === input.status) return { campaignId: c.id };
    await tx.update(campaigns).set({ status: input.status }).where(eq(campaigns.id, c.id));
    await emitEvent(tx, {
      type: 'campaign.status_changed',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'campaign', id: c.id },
      clientId: c.clientId,
      payload: { campaignId: c.id, clientId: c.clientId, from: c.status, to: input.status },
    });
    await refreshCampaignHealth(tx, c.id, ctx.session.userId);
    return { campaignId: c.id };
  },
  revalidate: (input) => campaignPaths(input.campaignId),
});

export const deleteCampaignAction = defineAction({
  input: campaignIdSchema,
  side: 'agency',
  permission: 'campaigns:manage',
  async handler({ input, tx, ctx }) {
    const c = await loadCampaign(tx, input.campaignId);
    if (c.status !== 'draft' && c.status !== 'archived') throw new ActionFailure('campaign_not_deletable');
    await tx.delete(campaigns).where(eq(campaigns.id, c.id));
    await emitEvent(tx, {
      type: 'campaign.deleted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'campaign', id: c.id },
      clientId: c.clientId,
      payload: { campaignId: c.id, clientId: c.clientId },
    });
    return { campaignId: c.id };
  },
  revalidate: () => campaignPaths(),
});

export const linkDeliverableAction = defineAction({
  input: linkDeliverableSchema,
  side: 'agency',
  permission: 'campaigns:manage',
  async handler({ input, tx }) {
    const [row] = await tx
      .update(deliverables)
      .set({ campaignId: input.campaignId })
      .where(eq(deliverables.id, input.deliverableId))
      .returning({ id: deliverables.id, campaignId: deliverables.campaignId });
    if (!row) throw new ActionFailure('not_found');
    return row;
  },
  revalidate: (input) => [...campaignPaths(input.campaignId ?? undefined), `/deliverables/${input.deliverableId}`],
});

export const linkRequestAction = defineAction({
  input: linkRequestSchema,
  side: 'agency',
  permission: 'campaigns:manage',
  async handler({ input, tx }) {
    const [row] = await tx
      .update(requests)
      .set({ campaignId: input.campaignId })
      .where(eq(requests.id, input.requestId))
      .returning({ id: requests.id });
    if (!row) throw new ActionFailure('not_found');
    return row;
  },
  revalidate: (input) => [...campaignPaths(input.campaignId ?? undefined), `/requests/${input.requestId}`],
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Manual entry from the grid: whole days per channel, upserted. */
export const saveMetricsAction = defineAction({
  input: saveMetricsSchema,
  side: 'agency',
  permission: 'metrics:manage',
  async handler({ input, tx, ctx }) {
    const c = await loadCampaign(tx, input.campaignId);
    const channels = await tx.select({ id: campaignChannels.id }).from(campaignChannels).where(eq(campaignChannels.campaignId, c.id));
    const valid = new Set(channels.map((ch) => ch.id));
    if (input.rows.some((r) => !valid.has(r.channelId))) throw new ActionFailure('validation');
    await tx
      .insert(metricsDaily)
      .values(
        input.rows.map((r) => ({
          ...toColumns(r),
          channelId: r.channelId,
          date: r.date,
          campaignId: c.id,
          organizationId: c.organizationId,
          clientId: c.clientId,
          source: 'manual',
          importId: null,
        })),
      )
      .onConflictDoUpdate({ target: [metricsDaily.channelId, metricsDaily.date], set: upsertSet });
    await emitEvent(tx, {
      type: 'metrics.recorded',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'campaign', id: c.id },
      clientId: c.clientId,
      payload: { campaignId: c.id, clientId: c.clientId, days: new Set(input.rows.map((r) => r.date)).size },
    });
    const analysis = await refreshCampaignHealth(tx, c.id, ctx.session.userId);
    return { campaignId: c.id, health: analysis?.health ?? c.health };
  },
  revalidate: (input) => campaignPaths(input.campaignId),
});

/** CSV import (parsed and previewed in the browser, re-validated here): one channel, one row per day, upserted. */
export const importMetricsAction = defineAction({
  input: importMetricsSchema,
  side: 'agency',
  permission: 'metrics:manage',
  rateLimit: { key: 'metrics_import', max: 30, windowSeconds: 3600 },
  async handler({ input, tx, ctx }) {
    const c = await loadCampaign(tx, input.campaignId);
    const [channel] = await tx
      .select({ id: campaignChannels.id })
      .from(campaignChannels)
      .where(and(eq(campaignChannels.id, input.channelId), eq(campaignChannels.campaignId, c.id)));
    if (!channel) throw new ActionFailure('not_found');
    const dates = input.rows.map((r) => r.date).sort();
    const [log] = await tx
      .insert(metricImports)
      .values({
        organizationId: c.organizationId,
        clientId: c.clientId,
        campaignId: c.id,
        channelId: channel.id,
        fileName: input.fileName,
        preset: input.preset,
        rowCount: input.rows.length,
        dateFrom: dates[0]!,
        dateTo: dates[dates.length - 1]!,
      })
      .returning({ id: metricImports.id });
    // Batches keep each statement well under Postgres' parameter limit.
    for (let i = 0; i < input.rows.length; i += 500) {
      await tx
        .insert(metricsDaily)
        .values(
          input.rows.slice(i, i + 500).map((r) => ({
            ...toColumns(r),
            channelId: channel.id,
            date: r.date,
            campaignId: c.id,
            organizationId: c.organizationId,
            clientId: c.clientId,
            source: 'import',
            importId: log!.id,
          })),
        )
        .onConflictDoUpdate({ target: [metricsDaily.channelId, metricsDaily.date], set: upsertSet });
    }
    await emitEvent(tx, {
      type: 'metrics.imported',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'campaign', id: c.id },
      clientId: c.clientId,
      payload: { campaignId: c.id, clientId: c.clientId, importId: log!.id, rows: input.rows.length, preset: input.preset },
    });
    const analysis = await refreshCampaignHealth(tx, c.id, ctx.session.userId);
    return { campaignId: c.id, importId: log!.id, rows: input.rows.length, health: analysis?.health ?? c.health };
  },
  revalidate: (input) => campaignPaths(input.campaignId),
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const createReportAction = defineAction({
  input: createReportSchema,
  side: 'agency',
  permission: 'reports:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .insert(reports)
      .values({
        organizationId: ctx.organization.id,
        clientId: input.clientId,
        campaignId: input.campaignId,
        title: input.title,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        locale: input.locale,
      })
      .returning({ id: reports.id });
    await tx.insert(reportSections).values(
      defaultReportSections.map((s, i) => ({
        reportId: row!.id,
        organizationId: ctx.organization.id,
        clientId: input.clientId,
        kind: s.kind,
        config: s.config ?? {},
        sortOrder: i,
      })),
    );
    await emitEvent(tx, {
      type: 'report.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'report', id: row!.id },
      clientId: input.clientId,
      payload: { reportId: row!.id, clientId: input.clientId, scheduleId: null },
    });
    return { reportId: row!.id };
  },
  revalidate: (_input, result) => reportPaths(result.reportId),
});

export const saveReportAction = defineAction({
  input: saveReportSchema,
  side: 'agency',
  permission: 'reports:manage',
  async handler({ input, tx, ctx }) {
    const [r] = await tx.select().from(reports).where(eq(reports.id, input.reportId));
    if (!r) throw new ActionFailure('not_found');
    if (r.status === 'published') throw new ActionFailure('report_published');
    await tx
      .update(reports)
      .set({ title: input.title, periodStart: input.periodStart, periodEnd: input.periodEnd, locale: input.locale })
      .where(eq(reports.id, r.id));
    await tx.delete(reportSections).where(eq(reportSections.reportId, r.id));
    await tx.insert(reportSections).values(
      input.sections.map((s, i) => ({
        reportId: r.id,
        organizationId: r.organizationId,
        clientId: r.clientId,
        kind: s.kind,
        config: s.config,
        body: s.body,
        sortOrder: i,
      })),
    );
    await emitEvent(tx, {
      type: 'report.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'report', id: r.id },
      clientId: r.clientId,
      payload: { reportId: r.id, clientId: r.clientId },
    });
    return { reportId: r.id };
  },
  revalidate: (input) => reportPaths(input.reportId),
});

/** Freezes the numbers into the snapshot (ADR-049) and makes the report visible in the portal. */
export const publishReportAction = defineAction({
  input: reportIdSchema,
  side: 'agency',
  permission: 'reports:manage',
  async handler({ input, tx, ctx }) {
    const [r] = await tx.select().from(reports).where(eq(reports.id, input.reportId));
    if (!r) throw new ActionFailure('not_found');
    if (r.status === 'published') return { reportId: r.id };
    const snapshot = await buildReportSnapshot(tx, {
      clientId: r.clientId,
      campaignId: r.campaignId,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
    });
    await tx.update(reports).set({ status: 'published', snapshot, publishedAt: new Date() }).where(eq(reports.id, r.id));
    await emitEvent(tx, {
      type: 'report.published',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'report', id: r.id },
      clientId: r.clientId,
      payload: { reportId: r.id, clientId: r.clientId },
    });
    return { reportId: r.id };
  },
  revalidate: (input) => reportPaths(input.reportId),
});

export const unpublishReportAction = defineAction({
  input: reportIdSchema,
  side: 'agency',
  permission: 'reports:manage',
  async handler({ input, tx, ctx }) {
    const [r] = await tx.select().from(reports).where(eq(reports.id, input.reportId));
    if (!r) throw new ActionFailure('not_found');
    if (r.status === 'draft') return { reportId: r.id };
    await tx.update(reports).set({ status: 'draft' }).where(eq(reports.id, r.id));
    await emitEvent(tx, {
      type: 'report.unpublished',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'report', id: r.id },
      clientId: r.clientId,
      payload: { reportId: r.id, clientId: r.clientId },
    });
    return { reportId: r.id };
  },
  revalidate: (input) => reportPaths(input.reportId),
});

export const deleteReportAction = defineAction({
  input: reportIdSchema,
  side: 'agency',
  permission: 'reports:manage',
  async handler({ input, tx, ctx }) {
    const [r] = await tx.select().from(reports).where(eq(reports.id, input.reportId));
    if (!r) throw new ActionFailure('not_found');
    if (r.status === 'published') throw new ActionFailure('report_published');
    await tx.delete(reports).where(eq(reports.id, r.id));
    await emitEvent(tx, {
      type: 'report.deleted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'report', id: r.id },
      clientId: r.clientId,
      payload: { reportId: r.id, clientId: r.clientId },
    });
    return { reportId: r.id };
  },
  revalidate: () => reportPaths(),
});

export const saveScheduleAction = defineAction({
  input: saveScheduleSchema,
  side: 'agency',
  permission: 'reports:manage',
  async handler({ input, tx, ctx }) {
    const today = dayInZone(new Date(), ctx.organization.defaultTimezone);
    const values = {
      campaignId: input.campaignId,
      cadence: input.cadence,
      locale: input.locale,
      autoPublish: input.autoPublish,
      isActive: input.isActive,
      sections: input.sections.map((s) => ({ kind: s.kind, config: s.config })),
    };
    let scheduleId = input.scheduleId;
    let clientId = input.clientId;
    if (scheduleId) {
      const [s] = await tx.select().from(reportSchedules).where(eq(reportSchedules.id, scheduleId));
      if (!s) throw new ActionFailure('not_found');
      clientId = s.clientId;
      await tx
        .update(reportSchedules)
        .set({ ...values, ...(s.cadence !== input.cadence ? { nextRunOn: firstRunOn(input.cadence, today) } : {}) })
        .where(eq(reportSchedules.id, s.id));
    } else {
      const [row] = await tx
        .insert(reportSchedules)
        .values({ ...values, organizationId: ctx.organization.id, clientId, nextRunOn: firstRunOn(input.cadence, today) })
        .returning({ id: reportSchedules.id });
      scheduleId = row!.id;
    }
    await emitEvent(tx, {
      type: 'report_schedule.saved',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'report_schedule', id: scheduleId },
      clientId,
      payload: { scheduleId, clientId },
    });
    return { scheduleId };
  },
  revalidate: () => ['/reports'],
});

export const deleteScheduleAction = defineAction({
  input: scheduleIdSchema,
  side: 'agency',
  permission: 'reports:manage',
  async handler({ input, tx, ctx }) {
    const [s] = await tx.delete(reportSchedules).where(eq(reportSchedules.id, input.scheduleId)).returning();
    if (!s) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'report_schedule.deleted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'report_schedule', id: s.id },
      clientId: s.clientId,
      payload: { scheduleId: s.id, clientId: s.clientId },
    });
    return { scheduleId: s.id };
  },
  revalidate: () => ['/reports'],
});
