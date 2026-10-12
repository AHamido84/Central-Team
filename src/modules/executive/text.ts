/**
 * Labels and number formatting for the Executive Center (FR7), shared by the screens, the brief, the board report
 * exports and the scheduled email so a value reads the same everywhere. Pure: the caller passes a translator for
 * the `executive` namespace and the app formatters.
 */
import type { Formatters } from '@/lib/i18n/format';
import { localized, type Locale } from '@/lib/i18n/localized';
import type { LocalizedText } from '@/lib/i18n/localized';
import { kpis, type KpiKey, type KpiUnit } from '@/modules/executive/catalog';
import type { RiskItem } from '@/modules/executive/compute';
import type { Delta } from '@/modules/executive/kpi';

export type ExecT = (key: string, values?: Record<string, string | number | Date>) => string;
export type ExecKit = {
  t: ExecT;
  f: Formatters;
  locale: Locale;
  /** Lookups into other modules' labels (platforms, campaign health), passed in so this stays pure. */
  label: (group: 'platform' | 'campaignHealth' | 'leadSource' | 'lostReason' | 'clientHealth', key: string) => string;
};

export const nameText = (kit: Pick<ExecKit, 'locale'>, name: unknown) => localized((name ?? {}) as LocalizedText, kit.locale);

export function formatValue(kit: Pick<ExecKit, 't' | 'f'>, unit: KpiUnit, value: number | null, opts: { compact?: boolean } = {}): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const { f, t } = kit;
  switch (unit) {
    case 'count':
      return f.number(Math.round(value));
    case 'decimal':
      return f.number(value, { maximumFractionDigits: 1 });
    case 'currency':
      return opts.compact && Math.abs(value) >= 1_000_000
        ? f.number(value / 100, {
            style: 'currency',
            currency: 'SAR',
            notation: 'compact',
            minimumFractionDigits: 0,
            maximumFractionDigits: 1,
          })
        : f.number(value / 100, { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 });
    case 'percent':
      return f.number(value, { style: 'percent', maximumFractionDigits: 1 });
    case 'days':
      return t('units.days', { value: f.number(value, { maximumFractionDigits: 1 }) });
    case 'hours':
      return t('units.hours', { value: f.number(value, { maximumFractionDigits: 1 }) });
    case 'ratio':
      return t('units.ratio', { value: f.number(value, { maximumFractionDigits: 2 }) });
  }
}

export const formatKpi = (kit: Pick<ExecKit, 't' | 'f'>, key: KpiKey, value: number | null, opts?: { compact?: boolean }) =>
  formatValue(kit, kpis[key].unit, value, opts);

/** "Up 12%" / "Down 3 points" style change text; percentages compare in points, counts with no base by amount. */
export function formatDelta(kit: Pick<ExecKit, 't' | 'f'>, key: KpiKey, d: Delta | null): string | null {
  if (!d) return null;
  if (d.abs === 0) return kit.t('tile.deltaFlat');
  const unit = kpis[key].unit;
  const pct =
    unit === 'percent'
      ? kit.t('units.points', { value: kit.f.number(Math.abs(d.abs) * 100, { maximumFractionDigits: 1 }) })
      : d.pct === null
        ? formatValue(kit, unit, Math.abs(d.abs))
        : kit.f.number(Math.abs(d.pct), { style: 'percent', maximumFractionDigits: 1 });
  return kit.t(d.abs > 0 ? 'tile.deltaUp' : 'tile.deltaDown', { pct });
}

const jsonName = (kit: Pick<ExecKit, 'locale'>, v: string | number | undefined) => {
  if (typeof v !== 'string') return String(v ?? '');
  try {
    return nameText(kit, JSON.parse(v));
  } catch {
    return v;
  }
};

/** One risk register / attention line in the reader's language. */
export function riskText(kit: ExecKit, item: Pick<RiskItem, 'reason' | 'params'>): string {
  const p = { ...item.params };
  for (const key of ['client', 'department'] as const) if (key in p) p[key] = jsonName(kit, p[key]);
  if (item.reason === 'campaignOffPace' && typeof p.health === 'string') p.health = kit.label('campaignHealth', p.health);
  if (item.reason === 'dealStuck' && typeof p.value === 'number') p.value = kit.f.currency(p.value);
  return kit.t(`risk.${item.reason}`, p);
}
