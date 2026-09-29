'use client';

import { useTranslations } from 'next-intl';

import { useFormat } from '@/components/providers';
import { metricCatalog, type MetricKey } from '@/modules/campaigns/constants';

/**
 * Node's and the browser's ICU disagree on invisible bidi marks in some Arabic outputs (e.g. compact currency adds
 * a leading RLM in Node only), which breaks hydration. The surrounding text already sets the direction.
 */
const stripMarks = (s: string) => s.replace(/[\u200e\u200f\u061c]/g, '');

/** Formats a metric value by its catalog format (money in halalas, rates as fractions). */
export function useMetricFormat(currency = 'SAR') {
  const f = useFormat();
  const t = useTranslations('campaigns.compact');
  // Compact notation is built here, not with Intl's `notation: 'compact'`: Node's and the browser's ICU spell it
  // differently ("25K" vs "25k", "55" vs "55.0 ألف"), which breaks hydration.
  const compact = (v: number): string => {
    const abs = Math.abs(v);
    const unit =
      abs >= 1e9
        ? (['billion', 1e9] as const)
        : abs >= 1e6
          ? (['million', 1e6] as const)
          : abs >= 1e4
            ? (['thousand', 1e3] as const)
            : null;
    if (!unit) return f.number(v, { maximumFractionDigits: 0 });
    return t(unit[0], { value: f.number(v / unit[1], { minimumFractionDigits: 0, maximumFractionDigits: 1 }) });
  };
  const value = (metric: MetricKey, v: number | null, opts: { compact?: boolean } = {}): string => stripMarks(raw(metric, v, opts));
  const raw = (metric: MetricKey, v: number | null, opts: { compact?: boolean }): string => {
    if (v === null || !Number.isFinite(v)) return '—';
    switch (metricCatalog[metric].format) {
      case 'money':
        return opts.compact && v >= 1_000_000 && currency === 'SAR'
          ? t('money', { value: compact(v / 100) })
          : f.number(v / 100, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: v >= 100_000 ? 0 : 2 });
      case 'percent':
        return f.number(v, { style: 'percent', maximumFractionDigits: 2 });
      case 'ratio':
        return `${f.number(v, { maximumFractionDigits: 2 })}×`;
      case 'decimal':
        return f.number(v, { maximumFractionDigits: 2 });
      default:
        return opts.compact ? compact(v) : f.number(v, { maximumFractionDigits: 0 });
    }
  };
  return { value, f };
}

/** KPI targets are stored in canonical units; the form shows SAR and percentages. */
export function targetToInput(metric: MetricKey, target: number): number {
  const format = metricCatalog[metric].format;
  if (format === 'money') return target / 100;
  if (format === 'percent') return Math.round(target * 100 * 10_000) / 10_000;
  return target;
}

export function inputToTarget(metric: MetricKey, input: number): number {
  const format = metricCatalog[metric].format;
  if (format === 'money') return Math.round(input * 100);
  if (format === 'percent') return input / 100;
  return input;
}

/** Unit shown next to the target input. */
export function inputUnit(metric: MetricKey, currency = 'SAR'): string {
  const format = metricCatalog[metric].format;
  if (format === 'money') return currency;
  if (format === 'percent') return '%';
  if (format === 'ratio') return '×';
  return '';
}
