/** Shared AI shapes (client-safe: no server imports). */
import type { MetricFormat } from '@/modules/campaigns/constants';

/**
 * Numbers behind an insight, computed by the detectors (ADR-074). Money is in minor units; `format` says how to show
 * `value` / `baseline` / `target` / `actual`. Every field a title or body placeholder needs lives here.
 */
export type InsightFacts = {
  currency: string;
  format: MetricFormat;
  /** Channel label when the insight is about one channel (platform key + custom name). */
  platform?: string | null;
  channelName?: string | null;
  /** Anomalies: the day's value vs the trailing-window median. */
  date?: string;
  value?: number | null;
  baseline?: number | null;
  /** Relative change vs baseline (0.42 = +42 %). */
  change?: number | null;
  z?: number | null;
  windowDays?: number;
  /** KPI pacing. */
  target?: number;
  actual?: number | null;
  projected?: number | null;
  ratio?: number | null;
  /** Budget pacing. */
  budgetMinor?: number;
  spentMinor?: number;
  expectedMinor?: number;
  remainingDays?: number;
  /** Delivery stopped: the last day with spend. */
  lastSpendDate?: string | null;
};

export type RecommendationFacts = {
  currency?: string;
  metric?: string;
  fromChannelId?: string;
  /** Channel custom name ('' when none) and platform key. */
  fromChannel?: string;
  fromPlatform?: string;
  toChannelId?: string;
  toChannel?: string;
  toPlatform?: string;
  /** Daily amount to move / the new daily budget (minor units). */
  amountMinor?: number;
  dailyBudgetMinor?: number;
  fromCost?: number;
  toCost?: number;
  /** Expected extra results per day from the change (can be fractional). */
  expectedDelta?: number;
};

export type Citation = {
  n: number;
  sourceType: SourceType;
  sourceId: string;
  title: string;
  url: string;
};

export const sourceTypes = ['client', 'campaign', 'request', 'task', 'report', 'lead', 'deal', 'insight'] as const;
export type SourceType = (typeof sourceTypes)[number];
