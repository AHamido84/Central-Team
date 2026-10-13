/**
 * Statistics for the Executive Center (FR7, ADR-096). Pure and dependency-free (shared by server, UI, exports and
 * tests). Domain metrics come from the modules that own them; this file adds only the period / comparison / summary
 * statistics they don't have. Dates are ISO `YYYY-MM-DD` days in the organization's time zone.
 */
import type { Comparison, PeriodPreset } from '@/modules/executive/types';

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (iso: string, n: number) => toIso(toMs(iso) + n * DAY);
/** Inclusive day count. */
export const dayCount = (from: string, to: string) => Math.max(0, Math.round((toMs(to) - toMs(from)) / DAY) + 1);
export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;

export function addMonths(iso: string, n: number): string {
  const d = new Date(toMs(iso));
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), last));
  return toIso(target.getTime());
}

export const monthEnd = (iso: string) => addDays(addMonths(monthStart(iso), 1), -1);
export const quarterStart = (iso: string) => {
  const m = Number(iso.slice(5, 7));
  return `${iso.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
};
export const quarterOf = (iso: string) => Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;

/** Overlap of two inclusive day ranges, in days (0 when they don't meet). */
export function overlapDays(aFrom: string, aTo: string, bFrom: string, bTo: string): number {
  const from = aFrom > bFrom ? aFrom : bFrom;
  const to = aTo < bTo ? aTo : bTo;
  return from > to ? 0 : dayCount(from, to);
}

/** `YYYY-MM` keys of every month the range touches, oldest first. */
export function monthsIn(from: string, to: string): string[] {
  const keys: string[] = [];
  for (let m = monthStart(from); m <= to; m = addMonths(m, 1)) keys.push(m.slice(0, 7));
  return keys;
}

// ---------------------------------------------------------------------------
// Periods and comparisons
// ---------------------------------------------------------------------------

export type Period = {
  from: string;
  to: string;
  /** The period runs past today: values so far, and a pro-rated projection where it makes sense. */
  incomplete: boolean;
  /** Days of the period already elapsed (= all of them for a complete period). */
  elapsedDays: number;
  totalDays: number;
};

function period(from: string, to: string, today: string): Period {
  const totalDays = dayCount(from, to);
  const incomplete = to > today;
  return { from, to, incomplete, totalDays, elapsedDays: incomplete ? Math.min(totalDays, dayCount(from, today)) : totalDays };
}

/**
 * The period a preset means on `today`. "This month", QTD and YTD run to the end of the month / quarter / year, so
 * they are marked incomplete; "last 12 months" ends today (12 full months back from tomorrow).
 */
export function resolvePeriod(preset: PeriodPreset, today: string, custom?: { from?: string | null; to?: string | null }): Period {
  switch (preset) {
    case 'this_month':
      return period(monthStart(today), monthEnd(today), today);
    case 'last_month': {
      const start = addMonths(monthStart(today), -1);
      return period(start, monthEnd(start), today);
    }
    case 'qtd': {
      const start = quarterStart(today);
      return period(start, addDays(addMonths(start, 3), -1), today);
    }
    case 'ytd':
      return period(`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`, today);
    case 'last_12m':
      return period(addDays(addMonths(today, -12), 1), today, today);
    case 'custom': {
      // A reversed or half-empty range falls back to the last 30 days as a whole, never to a mix of the two.
      const from = custom?.from ?? null;
      const to = custom?.to ?? today;
      return from && from <= to ? period(from, to, today) : period(addDays(today, -29), today, today);
    }
  }
}

/**
 * The comparison period. "previous" is the same number of days right before; "last_year" the same dates a year
 * earlier. Both cover only the elapsed part of an incomplete period, so like is compared with like.
 */
export function comparisonPeriod(p: Period, compare: Comparison, today: string): Period | null {
  if (compare === 'none') return null;
  const length = p.elapsedDays;
  if (compare === 'previous') {
    const to = addDays(p.from, -1);
    return period(addDays(to, -(length - 1)), to, today);
  }
  const from = addMonths(p.from, -12);
  return period(from, addDays(from, length - 1), today);
}

/** The part of a period already elapsed (what "so far" numbers cover). */
export const elapsedRange = (p: Period) => ({ from: p.from, to: addDays(p.from, p.elapsedDays - 1) });

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** A rate keeps its parts, so the UI can show "12 of 15" and flag a small sample. */
export type Rate = { value: number | null; num: number; den: number };
export const rate = (num: number, den: number): Rate => ({ value: den > 0 ? num / den : null, num, den });

/** Fewer observations than this and the tile says "based on N". */
export const SMALL_SAMPLE = 5;
export const isSmallSample = (n: number) => n > 0 && n < SMALL_SAMPLE;

export type Delta = { abs: number; pct: number | null };

/** Change vs the comparison; `pct` is null when the base is zero (a change from nothing isn't a percentage). */
export function delta(current: number | null, previous: number | null): Delta | null {
  if (current === null || previous === null) return null;
  return { abs: current - previous, pct: previous === 0 ? null : (current - previous) / Math.abs(previous) };
}

/** Whether a change is good news for a KPI (up is good unless the KPI is lower-is-better). */
export function deltaTone(d: Delta | null, direction: 'up' | 'down' | 'neutral'): 'good' | 'bad' | 'flat' {
  if (!d || d.abs === 0 || direction === 'neutral') return 'flat';
  return d.abs > 0 === (direction === 'up') ? 'good' : 'bad';
}

/** Linear projection of a flow metric to the end of an incomplete period. */
export function projectToEnd(value: number, p: Period): number | null {
  if (!p.incomplete || p.elapsedDays === 0) return null;
  return (value / p.elapsedDays) * p.totalDays;
}

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

/** Linear-interpolated percentile (p in 0–1) — the method spreadsheets use (PERCENTILE.INC). Null for no data. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}
export const median = (values: readonly number[]) => percentile(values, 0.5);
export const p90 = (values: readonly number[]) => percentile(values, 0.9);

export function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Trailing moving average; the first points average what is available (no leading gap). */
export function movingAverage(values: readonly number[], window: number): number[] {
  const w = Math.max(1, Math.floor(window));
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - w + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** Share of the total held by the `n` largest values (client concentration). */
export function topShare(values: readonly number[], n: number): number | null {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const top = [...values].sort((a, b) => b - a).slice(0, n);
  return top.reduce((a, b) => a + b, 0) / total;
}

/** Days between two instants (fractional). */
export const daysBetween = (fromIso: string, toIso: string) => (Date.parse(toIso) - Date.parse(fromIso)) / DAY;

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

export type TargetRow = { metric: string; year: number; quarter: number | null; value: number };

/**
 * The target for a period. Rates (on-time, SLA, utilization, win rate, ROAS) take the quarterly target of the
 * period's end quarter, else the yearly one. Amounts (revenue, new clients) add up the quarters (or the year's share
 * of days) the period covers.
 */
export function targetFor(
  metric: string,
  kind: 'rate' | 'amount',
  p: Pick<Period, 'from' | 'to'>,
  rows: readonly TargetRow[],
): number | null {
  const own = rows.filter((r) => r.metric === metric);
  if (own.length === 0) return null;
  if (kind === 'rate') {
    const year = Number(p.to.slice(0, 4));
    const q = own.find((r) => r.year === year && r.quarter === quarterOf(p.to));
    return q?.value ?? own.find((r) => r.year === year && r.quarter === null)?.value ?? null;
  }
  let total = 0;
  let found = false;
  for (let y = Number(p.from.slice(0, 4)); y <= Number(p.to.slice(0, 4)); y++) {
    for (let q = 1; q <= 4; q++) {
      const qFrom = `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
      const qTo = addDays(addMonths(qFrom, 3), -1);
      const days = overlapDays(p.from, p.to, qFrom, qTo);
      if (days === 0) continue;
      const quarterly = own.find((r) => r.year === y && r.quarter === q);
      const yearly = own.find((r) => r.year === y && r.quarter === null);
      if (quarterly) total += (quarterly.value * days) / dayCount(qFrom, qTo);
      else if (yearly) total += (yearly.value * days) / dayCount(`${y}-01-01`, `${y}-12-31`);
      else continue;
      found = true;
    }
  }
  return found ? total : null;
}

/** Progress toward a target (1 = met). Lower-is-better KPIs invert it. */
export function targetProgress(value: number | null, target: number | null, direction: 'up' | 'down' | 'neutral' = 'up'): number | null {
  if (value === null || target === null || target === 0) return null;
  return direction === 'down' ? target / Math.max(value, Number.EPSILON) : value / target;
}
