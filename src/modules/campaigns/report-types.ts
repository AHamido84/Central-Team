import type { CampaignHealth, MetricKey, Platform, ReportSectionKind } from '@/modules/campaigns/constants';
import type { KpiProgress, MetricTotals, PacingStatus, SeriesPoint } from '@/modules/campaigns/metrics';

/** Per-section options. `metrics` picks what the section shows; `grain` applies to the trend chart. */
export type ReportSectionConfig = {
  metrics?: MetricKey[];
  grain?: 'day' | 'week';
};

/** A section template on a schedule (the body is written per report). */
export type ScheduleSection = { kind: ReportSectionKind; config?: ReportSectionConfig };

export type SnapshotCampaign = {
  id: string;
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  budgetMinor: number;
  currency: string;
  health: CampaignHealth;
  elapsed: number;
  totals: MetricTotals;
  kpis: (KpiProgress & { channelId: string | null })[];
  budget: { expected: number; ratio: number | null; status: PacingStatus } | null;
};

export type SnapshotChannel = {
  id: string;
  campaignId: string;
  platform: Platform;
  name: string;
  totals: MetricTotals;
};

export type SnapshotCreative = {
  id: string;
  title: string;
  type: string;
  approvedAt: string | null;
  /** Storage path of the thumbnail (images/video posters); signed at render time. */
  thumbnailPath: string | null;
};

/**
 * The numbers of a report for its period, computed live for drafts and frozen at publish (ADR-049), so a client
 * always sees what was published even if metrics are corrected later.
 */
export type ReportSnapshot = {
  version: 1;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  totals: MetricTotals;
  /** Same-length period right before, for "vs previous period". */
  previousTotals: MetricTotals;
  campaigns: SnapshotCampaign[];
  channels: SnapshotChannel[];
  daily: SeriesPoint[];
  creatives: SnapshotCreative[];
};
