/**
 * Campaign math: totals, derived metrics, pacing and health. Pure functions shared by the server (health cache,
 * report snapshots), the agency UI and the portal — the single place these rules live (DATA_MODEL §3e).
 * Money is in minor units (halalas); dates are ISO `YYYY-MM-DD` strings in the campaign's calendar.
 */
import { baseMetrics, metricCatalog, PACING, type BaseMetric, type CampaignHealth, type MetricKey } from '@/modules/campaigns/constants';

export type MetricTotals = Record<BaseMetric, number>;

/** A `metrics_daily` row as the app reads it. */
export type MetricRow = { date: string; channelId: string } & MetricTotals;

export function emptyTotals(): MetricTotals {
  return Object.fromEntries(baseMetrics.map((k) => [k, 0])) as MetricTotals;
}

export function sumTotals(rows: readonly Partial<MetricTotals>[]): MetricTotals {
  const out = emptyTotals();
  for (const row of rows) for (const k of baseMetrics) out[k] += row[k] ?? 0;
  return out;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** Base metrics as stored; derived ones computed (null when the denominator is zero). */
export function metricValue(t: MetricTotals, key: MetricKey): number | null {
  switch (key) {
    case 'ctr':
      return ratio(t.clicks, t.impressions);
    case 'cpc':
      return ratio(t.spend, t.clicks);
    case 'cpm':
      return t.impressions > 0 ? (t.spend / t.impressions) * 1000 : null;
    case 'cpa':
      return ratio(t.spend, t.conversions);
    case 'cpl':
      return ratio(t.spend, t.leads);
    case 'roas':
      return ratio(t.revenue, t.spend);
    case 'frequency':
      return ratio(t.impressions, t.reach);
    case 'engagement_rate':
      return ratio(t.engagements, t.impressions);
    default:
      return t[key];
  }
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const toUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

export function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY);
}

export function addDays(iso: string, days: number): string {
  return toIsoDate(toUtc(iso) + days * DAY);
}

/** Sunday that starts the week containing `iso` (the Saudi work week starts on Sunday). */
export function weekStart(iso: string): string {
  return addDays(iso, -new Date(toUtc(iso)).getUTCDay());
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function flightDays(start: string, end: string): number {
  return daysBetween(start, end) + 1;
}

/**
 * Share of the flight covered by data: from the start to the last day with metrics (inclusive), clamped to 0–1.
 * No metrics yet (or data only before the start) → 0.
 */
export function elapsedShare(start: string, end: string, through: string | null): number {
  if (!through || through < start) return 0;
  const last = through > end ? end : through;
  return Math.min(1, (daysBetween(start, last) + 1) / flightDays(start, end));
}

// ---------------------------------------------------------------------------
// Pacing & health
// ---------------------------------------------------------------------------

export type PacingStatus = Exclude<CampaignHealth, 'no_data'> | 'no_data';

export function statusFromRatio(r: number | null): PacingStatus {
  if (r === null || !Number.isFinite(r)) return 'no_data';
  if (r >= 1) return 'on_track';
  if (r >= PACING.atRisk) return 'at_risk';
  return 'off_track';
}

export type KpiProgress = {
  metric: MetricKey;
  target: number;
  /** Value so far (derived metrics: over the whole period). */
  actual: number | null;
  /** Volume metrics: projected to the end of the flight at the current pace. */
  projected: number | null;
  /** ≥ 1 means on track, whatever the metric's direction. */
  ratio: number | null;
  status: PacingStatus;
};

export function kpiProgress(metric: MetricKey, target: number, totals: MetricTotals, elapsed: number): KpiProgress {
  const actual = metricValue(totals, metric);
  const { kind } = metricCatalog[metric];
  let projected: number | null = null;
  let r: number | null = null;
  if (elapsed > 0 && actual !== null && target > 0) {
    if (kind === 'volume') {
      projected = actual / elapsed;
      r = projected / target;
    } else if (kind === 'cost') {
      r = actual > 0 ? target / actual : null;
    } else {
      r = actual / target;
    }
  }
  return { metric, target, actual, projected, ratio: r, status: statusFromRatio(r) };
}

export type BudgetPacing = {
  budget: number;
  spent: number;
  /** What should have been spent by now at an even pace. */
  expected: number;
  ratio: number | null;
  status: PacingStatus;
};

/** Spend vs an even pace: within ±15 % is on track, anything else at risk (over- and under-delivery both matter). */
export function budgetPacing(budget: number, spent: number, elapsed: number): BudgetPacing | null {
  if (budget <= 0) return null;
  const expected = budget * elapsed;
  const r = expected > 0 ? spent / expected : null;
  let status: PacingStatus = 'no_data';
  if (r !== null) status = r > PACING.budgetHigh || r < PACING.budgetLow ? 'at_risk' : 'on_track';
  if (spent > budget) status = 'off_track';
  return { budget, spent, expected, ratio: r, status };
}

const severity: Record<PacingStatus, number> = { no_data: 0, on_track: 1, at_risk: 2, off_track: 3 };

/** The worst of the KPI and budget statuses; `no_data` only when nothing can be judged. */
export function campaignHealth(statuses: readonly PacingStatus[]): CampaignHealth {
  let worst: PacingStatus = 'no_data';
  for (const s of statuses) if (severity[s] > severity[worst]) worst = s;
  return worst;
}

export type HealthInput = {
  startDate: string;
  endDate: string;
  budgetMinor: number;
  kpis: readonly { metric: MetricKey; target: number; channelId: string | null }[];
  rows: readonly MetricRow[];
};

export type CampaignAnalysis = {
  elapsed: number;
  through: string | null;
  totals: MetricTotals;
  kpis: (KpiProgress & { channelId: string | null })[];
  budget: BudgetPacing | null;
  health: CampaignHealth;
};

/** Everything the overview, the list health badge and report snapshots need, from raw rows. */
export function analyzeCampaign(input: HealthInput): CampaignAnalysis {
  const inFlight = input.rows.filter((r) => r.date >= input.startDate && r.date <= input.endDate);
  const through = inFlight.reduce<string | null>((max, r) => (max === null || r.date > max ? r.date : max), null);
  const elapsed = elapsedShare(input.startDate, input.endDate, through);
  const totals = sumTotals(inFlight);
  const kpis = input.kpis.map((k) => {
    const scoped = k.channelId ? sumTotals(inFlight.filter((r) => r.channelId === k.channelId)) : totals;
    return { ...kpiProgress(k.metric, k.target, scoped, elapsed), channelId: k.channelId };
  });
  const budget = budgetPacing(input.budgetMinor, totals.spend, elapsed);
  const health = campaignHealth([...kpis.map((k) => k.status), ...(budget ? [budget.status] : [])]);
  return { elapsed, through, totals, kpis, budget, health };
}

export type SeriesPoint = { key: string } & MetricTotals;

/** Daily or weekly buckets over [from, to], zero-filled so charts have no gaps. */
export function buildSeries(rows: readonly MetricRow[], from: string, to: string, grain: 'day' | 'week'): SeriesPoint[] {
  const buckets = new Map<string, MetricTotals>();
  const keyOf = (d: string) => (grain === 'week' ? weekStart(d) : d);
  for (const d of eachDay(from, to)) if (!buckets.has(keyOf(d))) buckets.set(keyOf(d), emptyTotals());
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    const b = buckets.get(keyOf(r.date));
    if (!b) continue;
    for (const k of baseMetrics) b[k] += r[k];
  }
  return [...buckets.entries()].map(([key, t]) => ({ key, ...t }));
}

/** Per-channel totals (for the breakdown table and report snapshots). */
export function totalsByChannel(rows: readonly MetricRow[]): Map<string, MetricTotals> {
  const out = new Map<string, MetricTotals>();
  for (const r of rows) {
    const t = out.get(r.channelId) ?? emptyTotals();
    for (const k of baseMetrics) t[k] += r[k];
    out.set(r.channelId, t);
  }
  return out;
}
