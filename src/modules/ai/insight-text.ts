/**
 * Renders insights and recommendations as text from their stored facts (ADR-074): the UI, the assistant's index,
 * prompts and tasks all read the same sentences, in Arabic or English. Pure: pass a translator for the `ai`
 * namespace, the formatters for the locale, and labels for metrics / platforms (from `campaigns`).
 */
import type { Formatters } from '@/lib/i18n/format';
import type { InsightKind, RecommendationKind } from '@/modules/ai/insights-core';
import type { InsightFacts, RecommendationFacts } from '@/modules/ai/types';
import type { MetricFormat } from '@/modules/campaigns/constants';

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export type TextKit = {
  t: Translate;
  f: Formatters;
  metric: (key: string) => string;
  platform: (key: string) => string;
};

/** Node and browsers disagree on invisible bidi marks in some Arabic outputs; the surrounding text sets direction. */
const clean = (s: string) => s.replace(/[‎‏؜]/g, '');

export function formatValue(f: Formatters, format: MetricFormat, value: number | null | undefined, currency = 'SAR'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  switch (format) {
    case 'money':
      return clean(f.number(value / 100, { style: 'currency', currency, maximumFractionDigits: value >= 100_000 ? 0 : 2 }));
    case 'percent':
      return clean(f.number(value, { style: 'percent', maximumFractionDigits: 2 }));
    case 'ratio':
      return `${clean(f.number(value, { maximumFractionDigits: 2 }))}×`;
    case 'decimal':
      return clean(f.number(value, { maximumFractionDigits: 2 }));
    default:
      return clean(f.number(value, { maximumFractionDigits: 0 }));
  }
}

const money = (f: Formatters, minor: number | undefined, currency: string) => formatValue(f, 'money', minor ?? 0, currency);

function channelLabel(kit: TextKit, facts: InsightFacts): string | null {
  if (facts.channelName) return facts.channelName;
  return facts.platform ? kit.platform(facts.platform) : null;
}

export type InsightLike = { kind: InsightKind | string; metric: string | null; facts: InsightFacts };

export function insightTitle(kit: TextKit, i: InsightLike): string {
  const channel = channelLabel(kit, i.facts);
  const change =
    i.facts.change !== null && i.facts.change !== undefined
      ? clean(kit.f.number(Math.abs(i.facts.change), { style: 'percent', maximumFractionDigits: 0 }))
      : '';
  return kit.t(`insight.title.${i.kind}`, {
    metric: i.metric ? kit.metric(i.metric) : '',
    change,
    channel: channel ?? '',
    hasChannel: channel ? 'yes' : 'no',
  });
}

export function insightBody(kit: TextKit, i: InsightLike): string {
  const { f, t } = kit;
  const x = i.facts;
  const v = (n: number | null | undefined) => formatValue(f, x.format, n, x.currency);
  switch (i.kind) {
    case 'spike':
    case 'drop':
      return t('insight.body.anomaly', {
        date: x.date ? f.date(`${x.date}T12:00:00Z`) : '',
        metric: i.metric ? kit.metric(i.metric) : '',
        value: v(x.value),
        baseline: v(x.baseline),
        days: x.windowDays ?? 0,
      });
    case 'kpi_off_track':
    case 'kpi_at_risk':
      return t('insight.body.kpi', {
        target: v(x.target),
        actual: v(x.actual),
        projected: v(x.projected),
        hasProjected: x.projected !== null && x.projected !== undefined ? 'yes' : 'no',
      });
    case 'budget_overspent':
    case 'budget_overpace':
    case 'budget_underpace':
      return t('insight.body.budget', {
        spent: money(f, x.spentMinor, x.currency),
        budget: money(f, x.budgetMinor, x.currency),
        expected: money(f, x.expectedMinor, x.currency),
        remaining: x.remainingDays ?? 0,
      });
    case 'delivery_stopped':
      return t('insight.body.delivery', {
        last: x.lastSpendDate ? f.date(`${x.lastSpendDate}T12:00:00Z`) : '',
        hasLast: x.lastSpendDate ? 'yes' : 'no',
      });
    default:
      return '';
  }
}

export type RecommendationLike = { kind: RecommendationKind | string; facts: RecommendationFacts };

const named = (kit: TextKit, name?: string, platform?: string) => name || (platform ? kit.platform(platform) : '');

export function recommendationTitle(kit: TextKit, r: RecommendationLike): string {
  return kit.t(`rec.title.${r.kind}`, { to: named(kit, r.facts.toChannel, r.facts.toPlatform) });
}

export function recommendationBody(kit: TextKit, r: RecommendationLike): string {
  const { f } = kit;
  const x = r.facts;
  const currency = x.currency ?? 'SAR';
  return kit.t(`rec.body.${r.kind}`, {
    amount: money(f, x.amountMinor, currency),
    daily: money(f, x.dailyBudgetMinor, currency),
    from: named(kit, x.fromChannel, x.fromPlatform),
    to: named(kit, x.toChannel, x.toPlatform),
    fromCost: money(f, x.fromCost, currency),
    toCost: money(f, x.toCost, currency),
    delta: clean(f.number(x.expectedDelta ?? 0, { maximumFractionDigits: 1 })),
  });
}
