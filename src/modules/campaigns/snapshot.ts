/**
 * Campaign reads shared by the server and the seed: daily rows, KPIs and report snapshots. Deliberately not
 * `server-only` (like `workflows/generate.ts`) so `scripts/seed-campaigns.ts` builds published snapshots the same way
 * the app does. Every function runs in the caller's transaction, so RLS applies to app callers.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, notInArray, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db/client';
import { campaignChannels, campaignKpis, campaigns, deliverableVersionFiles, deliverables, files, metricsDaily } from '@/lib/db/schema';
import type { MetricKey, Platform } from '@/modules/campaigns/constants';
import {
  addDays,
  analyzeCampaign,
  buildSeries,
  daysBetween,
  sumTotals,
  totalsByChannel,
  type MetricRow,
} from '@/modules/campaigns/metrics';
import type { ReportSnapshot, SnapshotCampaign } from '@/modules/campaigns/report-types';

export const metricRowColumns = {
  campaignId: metricsDaily.campaignId,
  channelId: metricsDaily.channelId,
  date: metricsDaily.date,
  impressions: metricsDaily.impressions,
  reach: metricsDaily.reach,
  clicks: metricsDaily.clicks,
  spend: metricsDaily.spendMinor,
  conversions: metricsDaily.conversions,
  leads: metricsDaily.leads,
  video_views: metricsDaily.videoViews,
  engagements: metricsDaily.engagements,
  revenue: metricsDaily.revenueMinor,
};

export type CampaignMetricRow = MetricRow & { campaignId: string };

/** Daily rows for some campaigns (optionally a date window), in the caller's transaction (RLS applies). */
export async function loadMetricRows(
  tx: Tx,
  campaignIds: readonly string[],
  window?: { from?: string; to?: string },
): Promise<CampaignMetricRow[]> {
  if (campaignIds.length === 0) return [];
  return tx
    .select(metricRowColumns)
    .from(metricsDaily)
    .where(
      and(
        inArray(metricsDaily.campaignId, [...campaignIds]),
        window?.from ? gte(metricsDaily.date, window.from) : undefined,
        window?.to ? lte(metricsDaily.date, window.to) : undefined,
      ),
    )
    .orderBy(asc(metricsDaily.date));
}

type CampaignRow = typeof campaigns.$inferSelect;

export async function loadKpis(tx: Tx, campaignIds: readonly string[]) {
  if (campaignIds.length === 0) return [];
  return tx
    .select()
    .from(campaignKpis)
    .where(inArray(campaignKpis.campaignId, [...campaignIds]))
    .orderBy(asc(campaignKpis.sortOrder));
}

export function shapeOf(c: CampaignRow, kpis: { metric: string; target: number; channelId: string | null }[]) {
  return {
    startDate: c.startDate,
    endDate: c.endDate,
    budgetMinor: c.budgetMinor,
    kpis: kpis.map((k) => ({ metric: k.metric as MetricKey, target: k.target, channelId: k.channelId })),
  };
}

// ---------------------------------------------------------------------------
// Report snapshots
// ---------------------------------------------------------------------------

type SnapshotScope = {
  clientId: string;
  campaignId: string | null;
  periodStart: string;
  periodEnd: string;
  currency?: string;
};

/**
 * The numbers a report shows for its period (ADR-049). Scope: one campaign, or every client-visible campaign of the
 * client that overlaps the period (drafts, archived and internal campaigns never appear in a client report).
 * Campaign KPIs and pacing are as of the end of the period.
 */
export async function buildReportSnapshot(tx: Tx, scope: SnapshotScope): Promise<ReportSnapshot> {
  const list = await tx
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.clientId, scope.clientId),
        scope.campaignId
          ? eq(campaigns.id, scope.campaignId)
          : and(
              eq(campaigns.visibility, 'client'),
              notInArray(campaigns.status, ['draft', 'archived']),
              lte(campaigns.startDate, scope.periodEnd),
              gte(campaigns.endDate, scope.periodStart),
            ),
      ),
    )
    .orderBy(asc(campaigns.startDate));
  const ids = list.map((c) => c.id);
  const length = daysBetween(scope.periodStart, scope.periodEnd) + 1;
  const previousStart = addDays(scope.periodStart, -length);
  const [kpis, channels, rows] = await Promise.all([
    loadKpis(tx, ids),
    ids.length
      ? tx.select().from(campaignChannels).where(inArray(campaignChannels.campaignId, ids)).orderBy(asc(campaignChannels.sortOrder))
      : [],
    // Everything up to the period end: the campaign analysis needs the flight so far, the report the period itself.
    loadMetricRows(tx, ids, { to: scope.periodEnd }),
  ]);
  const inPeriod = rows.filter((r) => r.date >= scope.periodStart);
  const previous = rows.filter((r) => r.date >= previousStart && r.date < scope.periodStart);
  const byChannel = totalsByChannel(inPeriod);

  const snapshotCampaigns: SnapshotCampaign[] = list.map((c) => {
    const a = analyzeCampaign(
      shapeOf(
        c,
        kpis.filter((k) => k.campaignId === c.id),
      ),
      rows.filter((r) => r.campaignId === c.id),
    );
    return {
      id: c.id,
      number: c.number,
      name: c.name,
      startDate: c.startDate,
      endDate: c.endDate,
      budgetMinor: c.budgetMinor,
      currency: c.currency,
      health: a.health,
      elapsed: a.elapsed,
      totals: a.totals,
      kpis: a.kpis,
      budget: a.budget ? { expected: a.budget.expected, ratio: a.budget.ratio, status: a.budget.status } : null,
    };
  });

  // Creatives: approved deliverables of these campaigns, most recent first (thumbnail of the approved version).
  const creatives = ids.length
    ? await tx
        .select({
          id: deliverables.id,
          title: deliverables.title,
          type: deliverables.type,
          approvedAt: deliverables.approvedAt,
          thumbnailPath: sql<string | null>`(
            select coalesce(f.thumbnail_path, case when f.kind = 'image' then f.storage_path end)
            from ${deliverableVersionFiles} vf join ${files} f on f.id = vf.file_id
            where vf.version_id = ${deliverables.currentVersionId}
            order by vf.sort_order limit 1)`,
        })
        .from(deliverables)
        .where(
          and(
            inArray(deliverables.campaignId, ids),
            eq(deliverables.status, 'approved'),
            isNotNull(deliverables.approvedAt),
            lte(sql`${deliverables.approvedAt}::date`, scope.periodEnd),
          ),
        )
        .orderBy(desc(deliverables.approvedAt))
        .limit(12)
    : [];

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    periodStart: scope.periodStart,
    periodEnd: scope.periodEnd,
    currency: scope.currency ?? list[0]?.currency ?? 'SAR',
    totals: sumTotals(inPeriod),
    previousTotals: sumTotals(previous),
    campaigns: snapshotCampaigns,
    channels: channels.map((ch) => ({
      id: ch.id,
      campaignId: ch.campaignId,
      platform: ch.platform as Platform,
      name: ch.name,
      totals: byChannel.get(ch.id) ?? sumTotals([]),
    })),
    daily: buildSeries(inPeriod, scope.periodStart, scope.periodEnd, 'day'),
    creatives: creatives.map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type,
      approvedAt: c.approvedAt ? c.approvedAt.toISOString() : null,
      thumbnailPath: c.thumbnailPath,
    })),
  };
}
