/**
 * The Executive Center's view in the URL (FR7): tab, period, comparison and filters. Shared by the page, saved views,
 * notes and schedules, so a link, a pinned view and a board report open exactly the same numbers.
 */
import { comparisons, executiveTabs, periodPresets, type ExecutiveViewConfig } from '@/modules/executive/types';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const platform = /^[a-z_]{1,32}$/;

export const defaultViewConfig: ExecutiveViewConfig = { tab: 'overview', preset: 'this_month', compare: 'previous', filters: {} };

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Anything unknown falls back to the default, so a hand-edited URL never breaks the page. */
export function parseViewConfig(params: Params): ExecutiveViewConfig {
  const pick = <T extends string>(list: readonly T[], v: string | undefined, fallback: T) => list.find((x) => x === v) ?? fallback;
  const preset = pick(periodPresets, read(params, 'period'), defaultViewConfig.preset);
  const from = read(params, 'from');
  const to = read(params, 'to');
  const id = (key: string) => {
    const v = read(params, key);
    return v && uuid.test(v) ? v : null;
  };
  const plat = read(params, 'platform');
  return {
    tab: pick(executiveTabs, read(params, 'tab'), defaultViewConfig.tab),
    preset,
    from: preset === 'custom' && from && isoDay.test(from) ? from : null,
    to: preset === 'custom' && to && isoDay.test(to) ? to : null,
    compare: pick(comparisons, read(params, 'compare'), defaultViewConfig.compare),
    filters: {
      clientId: id('client'),
      departmentId: id('department'),
      accountManagerId: id('manager'),
      platform: plat && platform.test(plat) ? plat : null,
    },
  };
}

/** The query string for a view (defaults left out, so links stay short). */
export function viewSearch(config: ExecutiveViewConfig, overrides: Partial<ExecutiveViewConfig> = {}): string {
  const c = { ...config, ...overrides, filters: { ...config.filters, ...overrides.filters } };
  const q = new URLSearchParams();
  if (c.tab !== defaultViewConfig.tab) q.set('tab', c.tab);
  if (c.preset !== defaultViewConfig.preset) q.set('period', c.preset);
  if (c.preset === 'custom') {
    if (c.from) q.set('from', c.from);
    if (c.to) q.set('to', c.to);
  }
  if (c.compare !== defaultViewConfig.compare) q.set('compare', c.compare);
  if (c.filters.clientId) q.set('client', c.filters.clientId);
  if (c.filters.departmentId) q.set('department', c.filters.departmentId);
  if (c.filters.accountManagerId) q.set('manager', c.filters.accountManagerId);
  if (c.filters.platform) q.set('platform', c.filters.platform);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const activeFilterCount = (config: ExecutiveViewConfig) => Object.values(config.filters).filter(Boolean).length;
