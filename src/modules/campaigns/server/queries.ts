import 'server-only';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { withRls } from '@/lib/db/rls';
import {
  campaignChannels,
  campaigns,
  clients,
  metricImports,
  metricsDaily,
  organizations,
  profiles,
  reportSchedules,
  reportSections,
  reports,
  requests,
} from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import { CLIENT_FILES_BUCKET } from '@/lib/storage';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type {
  CampaignHealth,
  CampaignObjective,
  CampaignStatus,
  ImportPreset,
  MetricKey,
  Platform,
  ReportCadence,
  ReportSectionKind,
} from '@/modules/campaigns/constants';
import {
  analyzeCampaign,
  analyzeTotals,
  emptyTotals,
  type CampaignAnalysis,
  type MetricRow,
  type MetricTotals,
} from '@/modules/campaigns/metrics';
import type { ReportSectionConfig, ReportSnapshot, ScheduleSection } from '@/modules/campaigns/report-types';
import { buildReportSnapshot, loadKpis, loadMetricRows, shapeOf } from '@/modules/campaigns/server/analysis';
import { listDeliverables, type DeliverableSummary } from '@/modules/deliverables/server/queries';

type Person = { id: string; name: string; avatarPath: string | null };

export type ChannelItem = {
  id: string;
  platform: Platform;
  name: string;
  budgetMinor: number;
  externalRef: string | null;
};

export type KpiItem = { id: string; metric: MetricKey; target: number; channelId: string | null };

export type CampaignSummary = {
  id: string;
  number: number;
  name: string;
  clientId: string;
  clientName: LocalizedText;
  clientLogo: string | null;
  objective: CampaignObjective;
  status: CampaignStatus;
  visibility: 'internal' | 'client';
  startDate: string;
  endDate: string;
  budgetMinor: number;
  currency: string;
  owner: Person | null;
  platforms: Platform[];
  health: CampaignHealth;
  analysis: CampaignAnalysis;
  /** First KPI (the headline shown on cards). */
  headline: CampaignAnalysis['kpis'][number] | null;
};

type ListFilter = { clientId?: string; status?: CampaignStatus[]; ownerId?: string; platform?: Platform; ids?: string[] };

const personCols = { id: profiles.id, name: profiles.fullName, avatarPath: profiles.avatarPath };

/** Campaigns the caller can see (RLS: clients only client-visible, non-draft ones), each with its analysis. */
export async function listCampaigns(filter: ListFilter = {}): Promise<CampaignSummary[]> {
  return withRls(async (tx) => {
    const list = await tx
      .select({ c: campaigns, clientName: clients.name, clientLogo: clients.logoPath, owner: personCols })
      .from(campaigns)
      .innerJoin(clients, eq(clients.id, campaigns.clientId))
      .leftJoin(profiles, eq(profiles.id, campaigns.ownerId))
      .where(
        and(
          filter.clientId ? eq(campaigns.clientId, filter.clientId) : undefined,
          filter.status?.length ? inArray(campaigns.status, filter.status) : undefined,
          filter.ownerId ? eq(campaigns.ownerId, filter.ownerId) : undefined,
          filter.ids ? inArray(campaigns.id, filter.ids.length ? filter.ids : ['00000000-0000-0000-0000-000000000000']) : undefined,
          filter.platform
            ? sql`exists (select 1 from ${campaignChannels} ch where ch.campaign_id = ${campaigns.id} and ch.platform = ${filter.platform})`
            : undefined,
        ),
      )
      .orderBy(
        sql`case ${campaigns.status} when 'active' then 0 when 'paused' then 1 when 'planned' then 2 when 'draft' then 3 when 'completed' then 4 else 5 end`,
        desc(campaigns.startDate),
      )
      .limit(500);
    const ids = list.map((l) => l.c.id);
    const [channels, kpis, sums] = await Promise.all([
      ids.length
        ? tx.select().from(campaignChannels).where(inArray(campaignChannels.campaignId, ids)).orderBy(asc(campaignChannels.sortOrder))
        : [],
      loadKpis(tx, ids),
      // One grouped query instead of every daily row: per-channel totals over each flight + the last day with data.
      ids.length
        ? tx
            .select({
              campaignId: metricsDaily.campaignId,
              channelId: metricsDaily.channelId,
              through: sql<string>`max(${metricsDaily.date})::text`,
              impressions: sql<number>`sum(${metricsDaily.impressions})::float8`,
              reach: sql<number>`sum(${metricsDaily.reach})::float8`,
              clicks: sql<number>`sum(${metricsDaily.clicks})::float8`,
              spend: sql<number>`sum(${metricsDaily.spendMinor})::float8`,
              conversions: sql<number>`sum(${metricsDaily.conversions})::float8`,
              leads: sql<number>`sum(${metricsDaily.leads})::float8`,
              video_views: sql<number>`sum(${metricsDaily.videoViews})::float8`,
              engagements: sql<number>`sum(${metricsDaily.engagements})::float8`,
              revenue: sql<number>`sum(${metricsDaily.revenueMinor})::float8`,
            })
            .from(metricsDaily)
            .innerJoin(campaigns, eq(campaigns.id, metricsDaily.campaignId))
            .where(
              and(inArray(metricsDaily.campaignId, ids), sql`${metricsDaily.date} between ${campaigns.startDate} and ${campaigns.endDate}`),
            )
            .groupBy(metricsDaily.campaignId, metricsDaily.channelId)
        : [],
    ]);
    return list.map(({ c, clientName, clientLogo, owner }) => {
      const byChannel = new Map<string, MetricTotals>();
      let through: string | null = null;
      for (const s of sums) {
        if (s.campaignId !== c.id) continue;
        const { campaignId: _c, channelId, through: t, ...totals } = s;
        byChannel.set(channelId, { ...emptyTotals(), ...totals });
        if (!through || t > through) through = t;
      }
      const analysis = analyzeTotals(
        shapeOf(
          c,
          kpis.filter((k) => k.campaignId === c.id),
        ),
        byChannel,
        through,
      );
      return {
        id: c.id,
        number: c.number,
        name: c.name,
        clientId: c.clientId,
        clientName,
        clientLogo,
        objective: c.objective as CampaignObjective,
        status: c.status as CampaignStatus,
        visibility: c.visibility as 'internal' | 'client',
        startDate: c.startDate,
        endDate: c.endDate,
        budgetMinor: c.budgetMinor,
        currency: c.currency,
        owner: owner?.id ? owner : null,
        platforms: [...new Set(channels.filter((ch) => ch.campaignId === c.id).map((ch) => ch.platform as Platform))],
        health: analysis.health,
        analysis,
        headline: analysis.kpis[0] ?? null,
      };
    });
  });
}

export type ImportItem = {
  id: string;
  channelId: string;
  fileName: string;
  preset: ImportPreset;
  rowCount: number;
  dateFrom: string;
  dateTo: string;
  importedBy: Person | null;
  createdAt: string;
};

export type CampaignDetail = CampaignSummary & {
  description: string;
  ownerId: string | null;
  metricsThrough: string | null;
  createdAt: string;
  updatedAt: string;
  channels: ChannelItem[];
  kpis: KpiItem[];
  /** Every daily row in the flight (the overview charts and the entry grid slice it client-side). */
  rows: MetricRow[];
  deliverables: DeliverableSummary[];
  requests: { id: string; reference: string | null; title: string; status: string }[];
  reports: ReportSummary[];
  imports: ImportItem[];
};

/** Everything the campaign page needs. Clients get the same shape; RLS already removed what they may not see. */
export async function getCampaign(campaignId: string, side: 'agency' | 'client' = 'agency'): Promise<CampaignDetail | null> {
  const base = await withRls(async (tx) => {
    const [row] = await tx
      .select({ c: campaigns, clientName: clients.name, clientLogo: clients.logoPath, owner: personCols })
      .from(campaigns)
      .innerJoin(clients, eq(clients.id, campaigns.clientId))
      .leftJoin(profiles, eq(profiles.id, campaigns.ownerId))
      .where(eq(campaigns.id, campaignId));
    if (!row) return null;
    const { c } = row;
    const [channels, kpis, rows, linkedRequests, imports] = await Promise.all([
      tx.select().from(campaignChannels).where(eq(campaignChannels.campaignId, c.id)).orderBy(asc(campaignChannels.sortOrder)),
      loadKpis(tx, [c.id]),
      loadMetricRows(tx, [c.id], { from: c.startDate, to: c.endDate }),
      tx
        .select({ id: requests.id, reference: requests.reference, title: requests.title, status: requests.status })
        .from(requests)
        .where(eq(requests.campaignId, c.id))
        .orderBy(desc(requests.createdAt)),
      side === 'agency'
        ? tx
            .select({ i: metricImports, by: personCols })
            .from(metricImports)
            .leftJoin(profiles, eq(profiles.id, metricImports.importedBy))
            .where(eq(metricImports.campaignId, c.id))
            .orderBy(desc(metricImports.createdAt))
            .limit(20)
        : [],
    ]);
    return { ...row, channels, kpis, rows, linkedRequests, imports };
  });
  if (!base) return null;
  const { c } = base;
  const [deliverablesList, reportList] = await Promise.all([
    listDeliverables({ campaignId: c.id, approvedOnly: side === 'client' }),
    listReports({ campaignId: c.id, status: side === 'client' ? 'published' : undefined }),
  ]);
  const analysis = analyzeCampaign(
    shapeOf(
      c,
      base.kpis.map((k) => ({ metric: k.metric, target: k.target, channelId: k.channelId })),
    ),
    base.rows,
  );
  return {
    id: c.id,
    number: c.number,
    name: c.name,
    clientId: c.clientId,
    clientName: base.clientName,
    clientLogo: base.clientLogo,
    objective: c.objective as CampaignObjective,
    status: c.status as CampaignStatus,
    visibility: c.visibility as 'internal' | 'client',
    startDate: c.startDate,
    endDate: c.endDate,
    budgetMinor: c.budgetMinor,
    currency: c.currency,
    owner: base.owner?.id ? base.owner : null,
    ownerId: c.ownerId,
    platforms: [...new Set(base.channels.map((ch) => ch.platform as Platform))],
    health: analysis.health,
    analysis,
    headline: analysis.kpis[0] ?? null,
    description: c.description,
    metricsThrough: c.metricsThrough,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    channels: base.channels.map((ch) => ({
      id: ch.id,
      platform: ch.platform as Platform,
      name: ch.name,
      budgetMinor: ch.budgetMinor,
      externalRef: side === 'agency' ? ch.externalRef : null,
    })),
    kpis: base.kpis.map((k) => ({ id: k.id, metric: k.metric as MetricKey, target: k.target, channelId: k.channelId })),
    rows: base.rows,
    deliverables: deliverablesList,
    requests: base.linkedRequests.map((r) => ({ ...r, title: r.title })),
    reports: reportList,
    imports: base.imports.map(({ i, by }) => ({
      id: i.id,
      channelId: i.channelId,
      fileName: i.fileName,
      preset: i.preset as ImportPreset,
      rowCount: i.rowCount,
      dateFrom: i.dateFrom,
      dateTo: i.dateTo,
      importedBy: by?.id ? by : null,
      createdAt: i.createdAt.toISOString(),
    })),
  };
}

export type CampaignOption = {
  id: string;
  number: number;
  name: string;
  clientId: string;
  status: CampaignStatus;
  startDate: string;
  endDate: string;
};

/** Light list for pickers (link a request or deliverable, report scope). */
export async function listCampaignOptions(clientId?: string): Promise<CampaignOption[]> {
  return withRls(async (tx) =>
    (
      await tx
        .select({
          id: campaigns.id,
          number: campaigns.number,
          name: campaigns.name,
          clientId: campaigns.clientId,
          status: campaigns.status,
          startDate: campaigns.startDate,
          endDate: campaigns.endDate,
        })
        .from(campaigns)
        .where(and(clientId ? eq(campaigns.clientId, clientId) : undefined, sql`${campaigns.status} <> 'archived'`))
        .orderBy(desc(campaigns.startDate))
        .limit(300)
    ).map((c) => ({ ...c, status: c.status as CampaignStatus })),
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export type ReportSummary = {
  id: string;
  title: string;
  clientId: string;
  clientName: LocalizedText;
  campaign: { id: string; number: number; name: string } | null;
  periodStart: string;
  periodEnd: string;
  locale: 'ar' | 'en';
  status: 'draft' | 'published';
  scheduled: boolean;
  publishedAt: string | null;
  updatedAt: string;
};

type ReportFilter = { clientId?: string; campaignId?: string; status?: 'draft' | 'published' };

export async function listReports(filter: ReportFilter = {}): Promise<ReportSummary[]> {
  return withRls(async (tx) => {
    const list = await tx
      .select({
        r: reports,
        clientName: clients.name,
        campaign: { id: campaigns.id, number: campaigns.number, name: campaigns.name },
      })
      .from(reports)
      .innerJoin(clients, eq(clients.id, reports.clientId))
      .leftJoin(campaigns, eq(campaigns.id, reports.campaignId))
      .where(
        and(
          filter.clientId ? eq(reports.clientId, filter.clientId) : undefined,
          filter.campaignId ? eq(reports.campaignId, filter.campaignId) : undefined,
          filter.status ? eq(reports.status, filter.status) : undefined,
        ),
      )
      .orderBy(desc(reports.periodEnd), desc(reports.updatedAt))
      .limit(300);
    return list.map(({ r, clientName, campaign }) => ({
      id: r.id,
      title: r.title,
      clientId: r.clientId,
      clientName,
      campaign: campaign?.id ? campaign : null,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      locale: r.locale as 'ar' | 'en',
      status: r.status as 'draft' | 'published',
      scheduled: r.scheduleId !== null,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
    }));
  });
}

export type ReportSectionItem = { id: string; kind: ReportSectionKind; config: ReportSectionConfig; body: string };

export type ReportDetail = ReportSummary & {
  sections: ReportSectionItem[];
  /** Frozen for published reports, computed live for drafts. */
  snapshot: ReportSnapshot;
  live: boolean;
  clientLogo: string | null;
  brand: { name: LocalizedText; logoPath: string | null; primaryColor: string };
  publishedBy: string | null;
  /** Signed thumbnails for the creatives section (issued only after the RLS-checked read). */
  creativeThumbs: Record<string, string>;
};

export async function getReport(reportId: string): Promise<ReportDetail | null> {
  const found = await withRls(async (tx) => {
    const [row] = await tx
      .select({
        r: reports,
        clientName: clients.name,
        clientLogo: clients.logoPath,
        campaign: { id: campaigns.id, number: campaigns.number, name: campaigns.name },
        org: { name: organizations.name, logoPath: organizations.logoPath, brand: organizations.brand },
        publishedBy: profiles.fullName,
      })
      .from(reports)
      .innerJoin(clients, eq(clients.id, reports.clientId))
      .innerJoin(organizations, eq(organizations.id, reports.organizationId))
      .leftJoin(campaigns, eq(campaigns.id, reports.campaignId))
      .leftJoin(profiles, eq(profiles.id, reports.publishedBy))
      .where(eq(reports.id, reportId));
    if (!row) return null;
    const sections = await tx
      .select()
      .from(reportSections)
      .where(eq(reportSections.reportId, row.r.id))
      .orderBy(asc(reportSections.sortOrder));
    const snapshot =
      row.r.status === 'published' && row.r.snapshot
        ? row.r.snapshot
        : await buildReportSnapshot(tx, {
            clientId: row.r.clientId,
            campaignId: row.r.campaignId,
            periodStart: row.r.periodStart,
            periodEnd: row.r.periodEnd,
          });
    return { ...row, sections, snapshot };
  });
  if (!found) return null;
  const { r } = found;
  const paths = found.snapshot.creatives.map((c) => c.thumbnailPath).filter((p): p is string => Boolean(p));
  const creativeThumbs: Record<string, string> = {};
  if (paths.length) {
    // Service role only to sign paths of creatives this caller just read through RLS (CLAUDE.md §6).
    const { data } = await supabaseAdmin()
      .storage.from(CLIENT_FILES_BUCKET)
      .createSignedUrls([...new Set(paths)], 60 * 60);
    const byPath = new Map((data ?? []).flatMap((d) => (d.signedUrl && d.path ? [[d.path, d.signedUrl] as [string, string]] : [])));
    for (const c of found.snapshot.creatives)
      if (c.thumbnailPath && byPath.has(c.thumbnailPath)) creativeThumbs[c.id] = byPath.get(c.thumbnailPath)!;
  }
  return {
    id: r.id,
    title: r.title,
    clientId: r.clientId,
    clientName: found.clientName,
    clientLogo: found.clientLogo,
    campaign: found.campaign?.id ? found.campaign : null,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    locale: r.locale as 'ar' | 'en',
    status: r.status as 'draft' | 'published',
    scheduled: r.scheduleId !== null,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
    sections: found.sections.map((s) => ({ id: s.id, kind: s.kind as ReportSectionKind, config: s.config, body: s.body })),
    snapshot: found.snapshot,
    live: !(r.status === 'published' && r.snapshot),
    brand: { name: found.org.name, logoPath: found.org.logoPath, primaryColor: found.org.brand.primaryColor ?? '#5140E0' },
    publishedBy: found.publishedBy,
    creativeThumbs,
  };
}

export type ScheduleItem = {
  id: string;
  clientId: string;
  clientName: LocalizedText;
  campaign: { id: string; number: number; name: string } | null;
  cadence: ReportCadence;
  locale: 'ar' | 'en';
  sections: ScheduleSection[];
  autoPublish: boolean;
  isActive: boolean;
  nextRunOn: string;
  lastRunAt: string | null;
};

export async function listSchedules(filter: { clientId?: string } = {}): Promise<ScheduleItem[]> {
  return withRls(async (tx) => {
    const list = await tx
      .select({
        s: reportSchedules,
        clientName: clients.name,
        campaign: { id: campaigns.id, number: campaigns.number, name: campaigns.name },
      })
      .from(reportSchedules)
      .innerJoin(clients, eq(clients.id, reportSchedules.clientId))
      .leftJoin(campaigns, eq(campaigns.id, reportSchedules.campaignId))
      .where(filter.clientId ? eq(reportSchedules.clientId, filter.clientId) : undefined)
      .orderBy(asc(reportSchedules.nextRunOn));
    return list.map(({ s, clientName, campaign }) => ({
      id: s.id,
      clientId: s.clientId,
      clientName,
      campaign: campaign?.id ? campaign : null,
      cadence: s.cadence as ReportCadence,
      locale: s.locale as 'ar' | 'en',
      sections: s.sections,
      autoPublish: s.autoPublish,
      isActive: s.isActive,
      nextRunOn: s.nextRunOn,
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
    }));
  });
}
