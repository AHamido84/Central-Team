export const campaignObjectives = ['awareness', 'traffic', 'engagement', 'leads', 'sales', 'app_installs', 'video_views'] as const;
export type CampaignObjective = (typeof campaignObjectives)[number];

export const campaignStatuses = ['draft', 'planned', 'active', 'paused', 'completed', 'archived'] as const;
export type CampaignStatus = (typeof campaignStatuses)[number];

/** Statuses the portal shows (drafts and archived campaigns never reach clients). */
export const clientVisibleStatuses: readonly CampaignStatus[] = ['planned', 'active', 'paused', 'completed'];

export const campaignHealths = ['on_track', 'at_risk', 'off_track', 'no_data'] as const;
export type CampaignHealth = (typeof campaignHealths)[number];

export const platforms = ['meta', 'instagram', 'facebook', 'tiktok', 'snapchat', 'google', 'youtube', 'x', 'linkedin', 'other'] as const;
export type Platform = (typeof platforms)[number];

/** Base metrics stored per channel per day (`metrics_daily`). Money in minor units. */
export const baseMetrics = [
  'impressions',
  'reach',
  'clicks',
  'spend',
  'conversions',
  'leads',
  'video_views',
  'engagements',
  'revenue',
] as const;
export type BaseMetric = (typeof baseMetrics)[number];

/** Computed from base metrics, never stored. */
export const derivedMetrics = ['ctr', 'cpc', 'cpm', 'cpa', 'cpl', 'roas', 'frequency', 'engagement_rate'] as const;
export type DerivedMetric = (typeof derivedMetrics)[number];

export const metricKeys = [...baseMetrics, ...derivedMetrics] as const;
export type MetricKey = (typeof metricKeys)[number];

/**
 * How a KPI is judged:
 * - `volume`: accumulates over the flight (projected to the end before comparing);
 * - `cost`: lower is better (a price per result);
 * - `rate`: a ratio where higher is better, compared as is.
 */
export type MetricKind = 'volume' | 'cost' | 'rate';
export type MetricFormat = 'count' | 'money' | 'percent' | 'ratio' | 'decimal';

export const metricCatalog: Record<MetricKey, { kind: MetricKind; format: MetricFormat }> = {
  impressions: { kind: 'volume', format: 'count' },
  reach: { kind: 'volume', format: 'count' },
  clicks: { kind: 'volume', format: 'count' },
  spend: { kind: 'volume', format: 'money' },
  conversions: { kind: 'volume', format: 'count' },
  leads: { kind: 'volume', format: 'count' },
  video_views: { kind: 'volume', format: 'count' },
  engagements: { kind: 'volume', format: 'count' },
  revenue: { kind: 'volume', format: 'money' },
  ctr: { kind: 'rate', format: 'percent' },
  cpc: { kind: 'cost', format: 'money' },
  cpm: { kind: 'cost', format: 'money' },
  cpa: { kind: 'cost', format: 'money' },
  cpl: { kind: 'cost', format: 'money' },
  roas: { kind: 'rate', format: 'ratio' },
  frequency: { kind: 'rate', format: 'decimal' },
  engagement_rate: { kind: 'rate', format: 'percent' },
};

/** Sensible default KPIs per objective (the create form pre-fills them). */
export const objectiveDefaultKpis: Record<CampaignObjective, MetricKey[]> = {
  awareness: ['impressions', 'reach', 'cpm'],
  traffic: ['clicks', 'ctr', 'cpc'],
  engagement: ['engagements', 'engagement_rate'],
  leads: ['leads', 'cpl'],
  sales: ['conversions', 'cpa', 'roas'],
  app_installs: ['conversions', 'cpa'],
  video_views: ['video_views', 'impressions'],
};

export const reportSectionKinds = ['kpi_summary', 'trend', 'channel_breakdown', 'top_creatives', 'commentary', 'next_steps'] as const;
export type ReportSectionKind = (typeof reportSectionKinds)[number];

export const reportCadences = ['weekly', 'monthly'] as const;
export type ReportCadence = (typeof reportCadences)[number];

export const importPresets = ['meta', 'tiktok', 'snapchat', 'google', 'custom'] as const;
export type ImportPreset = (typeof importPresets)[number];

/** Upper bound for a single CSV import (rows), and the file size the browser will read. */
export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/** An active campaign with no metrics for this many days is "stale" (owner reminder). */
export const STALE_METRICS_DAYS = 3;

/** Pacing thresholds (DATA_MODEL §3e). */
export const PACING = { atRisk: 0.85, budgetHigh: 1.15, budgetLow: 0.85 } as const;
