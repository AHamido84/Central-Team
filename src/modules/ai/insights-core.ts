/**
 * Campaign insight detectors and recommendation rules (ADR-074). Pure functions over `metrics_daily` rows and the
 * Phase 4 campaign analysis: every number an insight or recommendation shows is computed here, never by a model.
 * Money is in minor units; dates are ISO `YYYY-MM-DD` strings in the organization's calendar.
 */
import { metricCatalog, type BaseMetric, type MetricKey, type MetricFormat } from '@/modules/campaigns/constants';
import {
  addDays,
  analyzeCampaign,
  daysBetween,
  emptyTotals,
  metricValue,
  sumTotals,
  type CampaignShape,
  type MetricRow,
  type MetricTotals,
} from '@/modules/campaigns/metrics';
import type { InsightFacts, RecommendationFacts } from '@/modules/ai/types';

export const insightKinds = [
  'spike',
  'drop',
  'kpi_off_track',
  'kpi_at_risk',
  'budget_overspent',
  'budget_overpace',
  'budget_underpace',
  'delivery_stopped',
] as const;
export type InsightKind = (typeof insightKinds)[number];

export const insightSeverities = ['info', 'warning', 'critical'] as const;
export type InsightSeverity = (typeof insightSeverities)[number];

export const insightStatuses = ['open', 'acknowledged', 'dismissed', 'resolved'] as const;
export type InsightStatus = (typeof insightStatuses)[number];

export const recommendationKinds = [
  'shift_budget',
  'reduce_budget',
  'increase_budget',
  'refresh_creative',
  'review_targeting',
  'check_tracking',
  'resume_delivery',
] as const;
export type RecommendationKind = (typeof recommendationKinds)[number];

export const sensitivities = ['low', 'normal', 'high'] as const;
export type Sensitivity = (typeof sensitivities)[number];

/** |z| needed to flag an anomaly; twice this is critical. */
export const Z_THRESHOLD: Record<Sensitivity, number> = { low: 4, normal: 3, high: 2.5 };

export const ANOMALY = {
  /** Trailing window the day is compared with, and the days of history it needs. */
  windowDays: 14,
  minHistory: 7,
  /** A flagged move is also at least this big relative to the baseline. */
  minChange: 0.3,
  /** Only the most recent days are analysed; older anomalies resolve after `historicDays`. */
  recentDays: 3,
  historicDays: 14,
} as const;

/** Metrics the anomaly detector watches, with the minimum baseline volume that makes a move meaningful. */
const anomalyMetrics: { metric: MetricKey; gate: (baseline: MetricTotals) => boolean }[] = [
  { metric: 'spend', gate: (b) => b.spend >= 1000 },
  { metric: 'clicks', gate: (b) => b.clicks >= 20 },
  { metric: 'conversions', gate: (b) => b.conversions >= 3 },
  { metric: 'leads', gate: (b) => b.leads >= 3 },
  { metric: 'ctr', gate: (b) => b.impressions >= 1000 },
  { metric: 'cpc', gate: (b) => b.clicks >= 20 },
  { metric: 'cpl', gate: (b) => b.leads >= 3 },
  { metric: 'cpa', gate: (b) => b.conversions >= 3 },
];

export type DetectionChannel = { id: string; platform: string; name: string };

export type DetectionInput = {
  campaign: CampaignShape & { id: string; status: string; currency: string };
  channels: readonly DetectionChannel[];
  rows: readonly MetricRow[];
  today: string;
  sensitivity: Sensitivity;
};

export type DetectedInsight = {
  kind: InsightKind;
  metric: string | null;
  channelId: string | null;
  severity: InsightSeverity;
  detectedOn: string;
  dedupeKey: string;
  facts: InsightFacts;
};

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Robust z-score of `x` against `history` (median / MAD). A flat history (MAD 0) uses 10 % of the median as its
 * spread, so a steady series still flags a real jump without dividing by zero.
 */
export function robustZ(x: number, history: readonly number[]): { z: number; baseline: number } {
  const m = median(history);
  const mad = median(history.map((v) => Math.abs(v - m)));
  const scale = mad > 0 ? 1.4826 * mad : Math.max(Math.abs(m) * 0.1, 1e-9);
  return { z: (x - m) / scale, baseline: m };
}

/** Whether a higher value is good (volumes, rates), bad (costs) or neither (spend). */
export function direction(metric: MetricKey): 'up_good' | 'up_bad' | 'neutral' {
  if (metric === 'spend') return 'neutral';
  return metricCatalog[metric].kind === 'cost' ? 'up_bad' : 'up_good';
}

const formatOf = (metric: MetricKey): MetricFormat => metricCatalog[metric].format;

function dailyTotals(rows: readonly MetricRow[], channelId: string | null): Map<string, MetricTotals> {
  const out = new Map<string, MetricTotals>();
  for (const r of rows) {
    if (channelId && r.channelId !== channelId) continue;
    const t = out.get(r.date) ?? emptyTotals();
    for (const k of Object.keys(t) as BaseMetric[]) t[k] += r[k];
    out.set(r.date, t);
  }
  return out;
}

function channelFacts(channel: DetectionChannel | null): Pick<InsightFacts, 'platform' | 'channelName'> {
  return channel ? { platform: channel.platform, channelName: channel.name || null } : { platform: null, channelName: null };
}

function detectAnomalies(input: DetectionInput, channel: DetectionChannel | null): DetectedInsight[] {
  const { campaign, today, sensitivity } = input;
  const byDay = dailyTotals(input.rows, channel?.id ?? null);
  // Complete days only: today's numbers are partial until the day ends (and platforms report late).
  const days = [...byDay.keys()].filter((d) => d < today && d >= campaign.startDate && d <= campaign.endDate).sort();
  const last = days.at(-1);
  if (!last || daysBetween(last, today) > ANOMALY.recentDays) return [];
  const history = days.filter((d) => d < last && d >= addDays(last, -ANOMALY.windowDays));
  if (history.length < ANOMALY.minHistory) return [];
  const baselineTotals = sumTotals(history.map((d) => byDay.get(d)!));
  const perDay = (t: MetricTotals) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v / history.length])) as MetricTotals;
  const avg = perDay(baselineTotals);
  const threshold = Z_THRESHOLD[sensitivity];
  const out: DetectedInsight[] = [];
  for (const { metric, gate } of anomalyMetrics) {
    if (!gate(avg)) continue;
    const x = metricValue(byDay.get(last)!, metric);
    const series = history.map((d) => metricValue(byDay.get(d)!, metric)).filter((v): v is number => v !== null);
    if (x === null || series.length < ANOMALY.minHistory) continue;
    const { z, baseline } = robustZ(x, series);
    const change = baseline !== 0 ? (x - baseline) / Math.abs(baseline) : null;
    if (Math.abs(z) < threshold || change === null || Math.abs(change) < ANOMALY.minChange) continue;
    const up = z > 0;
    const dir = direction(metric);
    const good = dir === 'neutral' ? false : (dir === 'up_good') === up;
    const severity: InsightSeverity = good ? 'info' : Math.abs(z) >= threshold * 2 ? 'critical' : 'warning';
    const kind: InsightKind = up ? 'spike' : 'drop';
    out.push({
      kind,
      metric,
      channelId: channel?.id ?? null,
      severity,
      detectedOn: last,
      dedupeKey: `${campaign.id}:${channel?.id ?? 'all'}:${kind}:${metric}:${last}`,
      facts: {
        currency: campaign.currency,
        format: formatOf(metric),
        ...channelFacts(channel),
        date: last,
        value: x,
        baseline,
        change,
        z: Math.round(z * 100) / 100,
        windowDays: history.length,
      },
    });
  }
  return out;
}

/** A channel that was spending and stopped on the campaign's two most recent days with data. */
function detectDeliveryStopped(input: DetectionInput): DetectedInsight[] {
  const { campaign, today } = input;
  if (campaign.status !== 'active') return [];
  const latest = input.rows.reduce<string | null>((m, r) => (r.date < today && (m === null || r.date > m) ? r.date : m), null);
  if (!latest || daysBetween(latest, today) > ANOMALY.recentDays || latest > campaign.endDate) return [];
  const recent = [latest, addDays(latest, -1)];
  const before = Array.from({ length: 7 }, (_, i) => addDays(latest, -2 - i));
  const out: DetectedInsight[] = [];
  for (const channel of input.channels) {
    const spendOn = new Map<string, number>();
    for (const r of input.rows) if (r.channelId === channel.id) spendOn.set(r.date, (spendOn.get(r.date) ?? 0) + r.spend);
    const activeDays = before.filter((d) => (spendOn.get(d) ?? 0) > 0).length;
    if (activeDays < 3 || recent.some((d) => (spendOn.get(d) ?? 0) > 0)) continue;
    const lastSpendDate = [...spendOn.entries()]
      .filter(([, s]) => s > 0)
      .map(([d]) => d)
      .sort()
      .at(-1);
    out.push({
      kind: 'delivery_stopped',
      metric: 'spend',
      channelId: channel.id,
      severity: 'warning',
      detectedOn: latest,
      dedupeKey: `${campaign.id}:${channel.id}:delivery_stopped`,
      facts: { currency: campaign.currency, format: 'money', ...channelFacts(channel), lastSpendDate: lastSpendDate ?? null },
    });
  }
  return out;
}

/** KPI and budget pacing from the Phase 4 analysis (only for live campaigns with data). */
function detectPacing(input: DetectionInput): DetectedInsight[] {
  const { campaign, today } = input;
  if (campaign.status !== 'active' && campaign.status !== 'paused') return [];
  const analysis = analyzeCampaign(campaign, input.rows);
  if (!analysis.through || analysis.elapsed <= 0) return [];
  const channelById = new Map(input.channels.map((c) => [c.id, c]));
  const out: DetectedInsight[] = [];
  for (const k of analysis.kpis) {
    if (k.status !== 'off_track' && k.status !== 'at_risk') continue;
    const channel = k.channelId ? (channelById.get(k.channelId) ?? null) : null;
    out.push({
      kind: k.status === 'off_track' ? 'kpi_off_track' : 'kpi_at_risk',
      metric: k.metric,
      channelId: k.channelId,
      severity: k.status === 'at_risk' ? 'info' : (k.ratio ?? 0) < 0.5 ? 'critical' : 'warning',
      detectedOn: analysis.through,
      dedupeKey: `${campaign.id}:${k.channelId ?? 'all'}:kpi:${k.metric}`,
      facts: {
        currency: campaign.currency,
        format: formatOf(k.metric),
        ...channelFacts(channel),
        target: k.target,
        actual: k.actual,
        projected: k.projected,
        ratio: k.ratio,
      },
    });
  }
  const b = analysis.budget;
  if (b && b.ratio !== null) {
    const remainingDays = Math.max(daysBetween(analysis.through, campaign.endDate), 0);
    const facts: InsightFacts = {
      currency: campaign.currency,
      format: 'money',
      budgetMinor: b.budget,
      spentMinor: b.spent,
      expectedMinor: Math.round(b.expected),
      ratio: b.ratio,
      remainingDays,
    };
    const push = (kind: InsightKind, severity: InsightSeverity) =>
      out.push({
        kind,
        metric: 'spend',
        channelId: null,
        severity,
        detectedOn: analysis.through!,
        dedupeKey: `${campaign.id}:all:budget`,
        facts,
      });
    if (b.spent > b.budget) push('budget_overspent', 'critical');
    else if (b.ratio > 1.15) push('budget_overpace', 'warning');
    else if (b.ratio < 0.85 && analysis.elapsed >= 0.2 && today <= campaign.endDate) push('budget_underpace', 'warning');
  }
  return out;
}

/**
 * Everything the detectors find for one campaign right now. Campaign-level anomalies are added only when there is more
 * than one channel (otherwise they repeat the channel's).
 */
export function detectInsights(input: DetectionInput): DetectedInsight[] {
  const anomalies = input.channels.flatMap((c) => detectAnomalies(input, c));
  if (input.channels.length > 1) anomalies.push(...detectAnomalies(input, null));
  return [...anomalies, ...detectDeliveryStopped(input), ...detectPacing(input)];
}

/** Anomalies are about one day: they resolve once they are older than the historic window. */
export function isHistoric(kind: InsightKind, detectedOn: string, today: string): boolean {
  return (kind === 'spike' || kind === 'drop') && daysBetween(detectedOn, today) > ANOMALY.historicDays;
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export type ChannelStats = DetectionChannel & {
  /** Totals over the last 14 days with data. */
  totals: MetricTotals;
  /** Average daily spend over the last 7 days (minor units). */
  dailySpend: number;
};

export type RecommendationContext = {
  currency: string;
  channels: readonly ChannelStats[];
};

export type ProposedRecommendation = { kind: RecommendationKind; facts: RecommendationFacts };

const resultOf: Partial<Record<MetricKey, BaseMetric>> = { cpl: 'leads', cpa: 'conversions', cpc: 'clicks' };

/** Channel stats over the last 14 days with data and the last 7 days' average spend. */
export function channelStats(channels: readonly DetectionChannel[], rows: readonly MetricRow[], today: string): ChannelStats[] {
  return channels.map((c) => {
    const own = rows.filter((r) => r.channelId === c.id && r.date <= today);
    const last = own.reduce<string | null>((m, r) => (m === null || r.date > m ? r.date : m), null);
    if (!last) return { ...c, totals: emptyTotals(), dailySpend: 0 };
    const window14 = own.filter((r) => r.date > addDays(last, -14));
    const window7 = own.filter((r) => r.date > addDays(last, -7));
    return { ...c, totals: sumTotals(window14), dailySpend: Math.round(sumTotals(window7).spend / 7) };
  });
}

/**
 * Move 20 % of a channel's daily spend to the channel whose cost per result is at least 25 % lower (with ≥ 3 results
 * in the window). Returns null when no channel is clearly better.
 */
export function shiftBudget(metric: MetricKey, fromId: string | null, ctx: RecommendationContext): ProposedRecommendation | null {
  const result = resultOf[metric];
  if (!result) return null;
  const costs = ctx.channels
    .filter((c) => c.totals[result] >= 3 && c.totals.spend > 0)
    .map((c) => ({ c, cost: c.totals.spend / c.totals[result] }));
  if (costs.length < 2) return null;
  const from = fromId ? costs.find((x) => x.c.id === fromId) : [...costs].sort((a, b) => b.cost - a.cost)[0];
  if (!from || from.c.dailySpend <= 0) return null;
  const to = costs.filter((x) => x.c.id !== from.c.id).sort((a, b) => a.cost - b.cost)[0];
  if (!to || to.cost > from.cost * 0.75) return null;
  const amount = Math.round(from.c.dailySpend * 0.2);
  if (amount <= 0) return null;
  return {
    kind: 'shift_budget',
    facts: {
      currency: ctx.currency,
      metric,
      fromChannelId: from.c.id,
      fromChannel: from.c.name,
      fromPlatform: from.c.platform,
      toChannelId: to.c.id,
      toChannel: to.c.name,
      toPlatform: to.c.platform,
      amountMinor: amount,
      fromCost: Math.round(from.cost),
      toCost: Math.round(to.cost),
      expectedDelta: Math.round((amount / to.cost - amount / from.cost) * 100) / 100,
    },
  };
}

/** The daily budget that lands the campaign on its total from here. */
function landOnBudget(facts: InsightFacts): number | null {
  if (facts.budgetMinor === undefined || facts.spentMinor === undefined || !facts.remainingDays) return null;
  return Math.max(Math.round((facts.budgetMinor - facts.spentMinor) / facts.remainingDays), 0);
}

export function recommend(
  insight: Pick<DetectedInsight, 'kind' | 'metric' | 'channelId' | 'severity' | 'facts'>,
  ctx: RecommendationContext,
): ProposedRecommendation[] {
  const metric = insight.metric as MetricKey | null;
  const out: ProposedRecommendation[] = [];
  const add = (r: ProposedRecommendation | null) => {
    if (r && !out.some((x) => x.kind === r.kind)) out.push(r);
  };
  const plain = (kind: RecommendationKind): ProposedRecommendation => ({
    kind,
    facts: { currency: ctx.currency, metric: metric ?? undefined },
  });
  switch (insight.kind) {
    case 'spike':
    case 'drop': {
      if (!metric || insight.severity === 'info' || metric === 'spend') break;
      if (metric === 'ctr' || metric === 'cpc') add(plain('refresh_creative'));
      if (metric === 'leads' || metric === 'conversions') add(plain('check_tracking'));
      if (metric === 'cpl' || metric === 'cpa') {
        add(shiftBudget(metric, insight.channelId, ctx));
        add(plain('review_targeting'));
      }
      if (metric === 'clicks') add(plain('refresh_creative'));
      break;
    }
    case 'delivery_stopped':
      add(plain('resume_delivery'));
      break;
    case 'kpi_off_track':
    case 'kpi_at_risk': {
      if (!metric) break;
      const kind = metricCatalog[metric].kind;
      if (kind === 'cost') {
        add(shiftBudget(metric, insight.channelId, ctx));
        add(plain('review_targeting'));
      } else if (kind === 'rate') add(plain('refresh_creative'));
      else add(plain('review_targeting'));
      break;
    }
    case 'budget_overspent':
    case 'budget_overpace':
    case 'budget_underpace': {
      const daily = landOnBudget(insight.facts);
      if (daily === null) break;
      add({
        kind: insight.kind === 'budget_underpace' ? 'increase_budget' : 'reduce_budget',
        facts: { currency: ctx.currency, dailyBudgetMinor: daily },
      });
      break;
    }
  }
  return out;
}
