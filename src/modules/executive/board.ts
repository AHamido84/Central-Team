/**
 * The board report (FR7): one model built from the Executive Center report, rendered as PDF (server HTML through
 * headless Chromium), PowerPoint and Excel. Every format shows the same values, formatted by the same kit. Pure.
 */
import { kpis as catalog, tabKpis, type KpiKey, type KpiUnit } from '@/modules/executive/catalog';
import type { ExecutiveReport } from '@/modules/executive/compute';
import { briefLines } from '@/modules/executive/brief';
import { formatDelta, formatKpi, formatValue, nameText, riskText, type ExecKit } from '@/modules/executive/text';
import { executiveTabs, type ExecutiveTab } from '@/modules/executive/types';

export type BoardKpi = {
  key: KpiKey;
  name: string;
  value: string;
  /** The raw value in KPI units (Excel keeps numbers as numbers). */
  raw: number | null;
  unit: KpiUnit;
  delta: string | null;
  tone: 'good' | 'bad' | 'flat';
  target: string | null;
  progress: string | null;
};

export type BoardTable = { title: string; head: string[]; numeric: boolean[]; rows: string[][]; raw?: (number | string | null)[][] };
export type BoardChart = { title: string; labels: string[]; series: { name: string; values: number[] }[]; unit: KpiUnit };

export type BoardSlide = { tab: ExecutiveTab; title: string; kpis: BoardKpi[]; charts: BoardChart[]; tables: BoardTable[] };

export type BoardModel = {
  title: string;
  organization: string;
  period: string;
  comparison: string | null;
  generatedAt: string;
  filters: string[];
  brief: string[];
  attention: string[];
  slides: BoardSlide[];
  dir: 'rtl' | 'ltr';
  locale: 'ar' | 'en';
};

const TABLE_ROWS = 10;

export function boardModel(
  kit: ExecKit,
  report: ExecutiveReport,
  meta: { organization: string; generatedAt: Date; tabs?: readonly ExecutiveTab[] },
): BoardModel {
  const { t, f } = kit;
  const day = (iso: string) => f.date(`${iso}T12:00:00Z`);
  const month = (key: string) => f.monthYear(`${key}-15T12:00:00Z`);
  const money = (v: number | null) => formatValue(kit, 'currency', v);
  const pct = (v: number | null) => formatValue(kit, 'percent', v);
  const num = (v: number | null) => formatValue(kit, 'count', v);
  const daysF = (v: number | null) => formatValue(kit, 'days', v);
  const ratio = (v: number | null) => formatValue(kit, 'ratio', v);

  const kpi = (key: KpiKey): BoardKpi => {
    const v = report.kpis[key];
    return {
      key,
      name: t(`kpi.${key}.name`),
      value: formatKpi(kit, key, v.value, { compact: true }),
      raw: v.value,
      unit: catalog[key].unit,
      delta: formatDelta(kit, key, v.delta),
      tone: v.tone,
      target: v.target !== null ? formatKpi(kit, key, v.target, { compact: true }) : null,
      progress: v.progress !== null ? f.percent(v.progress) : null,
    };
  };

  const r = report;
  const slides: Record<ExecutiveTab, () => BoardSlide> = {
    overview: () => ({ tab: 'overview', title: t('tabs.overview'), kpis: tabKpis.overview.map(kpi), charts: [], tables: [] }),
    clients: () => ({
      tab: 'clients',
      title: t('tabs.clients'),
      kpis: tabKpis.clients.map(kpi),
      charts: [
        {
          title: t('charts.revenueByMonth'),
          labels: r.clients.revenueByMonth.map((m) => month(m.key)),
          series: [{ name: t('charts.revenue'), values: r.clients.revenueByMonth.map((m) => m.value) }],
          unit: 'currency',
        },
      ],
      tables: [
        {
          title: t('charts.revenueByClient'),
          head: [t('col.client'), t('col.revenue'), t('col.share'), t('col.hours'), t('col.perHour'), t('col.health')],
          numeric: [false, true, true, true, true, false],
          rows: r.clients.revenueByClient
            .slice(0, TABLE_ROWS)
            .map((c) => [
              nameText(kit, c.name),
              money(c.value),
              pct(c.share),
              num(c.hours),
              money(c.perHour),
              c.health ? `${kit.label('clientHealth', c.health)} · ${c.score}` : '—',
            ]),
          raw: r.clients.revenueByClient.map((c) => [
            nameText(kit, c.name),
            c.value / 100,
            c.share,
            Math.round(c.hours * 10) / 10,
            c.perHour === null ? null : c.perHour / 100,
            c.score,
          ]),
        },
      ],
    }),
    operations: () => ({
      tab: 'operations',
      title: t('tabs.operations'),
      kpis: tabKpis.operations.map(kpi),
      charts: [
        {
          title: t('charts.intakeVsDone'),
          labels: r.operations.intakeVsDone.map((m) => month(m.key)),
          series: [
            { name: t('charts.submitted'), values: r.operations.intakeVsDone.map((m) => m.submitted) },
            { name: t('charts.delivered'), values: r.operations.intakeVsDone.map((m) => m.delivered) },
          ],
          unit: 'count',
        },
      ],
      tables: [
        {
          title: t('charts.turnaroundByType'),
          head: [t('col.type'), t('col.median'), t('col.p90'), t('col.count')],
          numeric: [false, true, true, true],
          rows: r.operations.turnaroundByType
            .slice(0, TABLE_ROWS)
            .map((x) => [x.name ? nameText(kit, x.name) : '—', daysF(x.median), daysF(x.p90), num(x.n)]),
          raw: r.operations.turnaroundByType.map((x) => [x.name ? nameText(kit, x.name) : '—', x.median, x.p90, x.n]),
        },
      ],
    }),
    team: () => ({
      tab: 'team',
      title: t('tabs.team'),
      kpis: tabKpis.team.map(kpi),
      charts: [
        {
          title: t('charts.capacityForecast'),
          labels: r.team.forecast.map((w) => f.dayMonth(`${w.week}T12:00:00Z`)),
          series: [
            { name: t('charts.capacity'), values: r.team.forecast.map((w) => Math.round(w.capacity)) },
            { name: t('charts.demand'), values: r.team.forecast.map((w) => Math.round(w.demand)) },
          ],
          unit: 'hours',
        },
      ],
      tables: [
        {
          title: t('charts.byDepartment'),
          head: [t('col.department'), t('col.utilization'), t('col.logged'), t('col.available')],
          numeric: [false, true, true, true],
          rows: r.team.byDepartment.map((d) => [
            nameText(kit, d.name),
            pct(d.utilization.value),
            formatValue(kit, 'hours', d.logged),
            formatValue(kit, 'hours', d.available),
          ]),
          raw: r.team.byDepartment.map((d) => [
            nameText(kit, d.name),
            d.utilization.value,
            Math.round(d.logged * 10) / 10,
            Math.round(d.available * 10) / 10,
          ]),
        },
      ],
    }),
    marketing: () => ({
      tab: 'marketing',
      title: t('tabs.marketing'),
      kpis: tabKpis.marketing.map(kpi),
      charts: [
        {
          title: t('charts.spendTrend'),
          labels: r.marketing.trend.map((m) => month(m.key)),
          series: [{ name: t('charts.spend'), values: r.marketing.trend.map((m) => m.spend) }],
          unit: 'currency',
        },
      ],
      tables: [
        {
          title: t('charts.byPlatform'),
          head: [t('col.platform'), t('col.spend'), t('col.conversions'), t('col.cpa'), t('col.roas'), t('col.ctr')],
          numeric: [false, true, true, true, true, true],
          rows: r.marketing.byPlatform.map((p) => [
            kit.label('platform', p.platform),
            money(p.spend),
            num(p.conversions),
            money(p.cpa),
            ratio(p.roas),
            pct(p.ctr),
          ]),
          raw: r.marketing.byPlatform.map((p) => [
            kit.label('platform', p.platform),
            p.spend / 100,
            p.conversions,
            p.cpa === null ? null : p.cpa / 100,
            p.roas,
            p.ctr,
          ]),
        },
      ],
    }),
    sales: () => ({
      tab: 'sales',
      title: t('tabs.sales'),
      kpis: tabKpis.sales.map(kpi),
      charts: [
        {
          title: t('charts.forecast'),
          labels: r.sales.forecast.map((m) => month(m.month)),
          series: [
            { name: t('charts.forecastValue'), values: r.sales.forecast.map((m) => m.forecast) },
            ...(r.sales.forecast.some((m) => m.target !== null)
              ? [{ name: t('charts.targetValue'), values: r.sales.forecast.map((m) => m.target ?? 0) }]
              : []),
          ],
          unit: 'currency',
        },
      ],
      tables: [
        {
          title: t('charts.pipelineByStage'),
          head: [t('col.stage'), t('col.deals'), t('col.value')],
          numeric: [false, true, true],
          rows: r.sales.pipelineByStage.map((s) => [nameText(kit, s.name), num(s.count), money(s.value)]),
          raw: r.sales.pipelineByStage.map((s) => [nameText(kit, s.name), s.count, s.value / 100]),
        },
      ],
    }),
    risks: () => ({
      tab: 'risks',
      title: t('tabs.risks'),
      kpis: tabKpis.risks.map(kpi),
      charts: [],
      tables: [
        {
          title: t('charts.riskRegister'),
          head: [t('col.severity'), t('col.category'), t('col.item'), t('col.owner')],
          numeric: [false, false, false, false],
          rows: r.risks.items.map((x) => [
            t(`severity.${x.severity}`),
            t(`category.${x.category}`),
            riskText(kit, x),
            x.ownerId ? (r.names[x.ownerId] ?? '—') : '—',
          ]),
        },
      ],
    }),
  };

  const filters = [
    r.config.filters.clientId
      ? `${t('controls.client')}: ${nameText(kit, r.options.clients.find((c) => c.id === r.config.filters.clientId)?.name)}`
      : null,
    r.config.filters.departmentId
      ? `${t('controls.department')}: ${nameText(kit, r.options.departments.find((d) => d.id === r.config.filters.departmentId)?.name)}`
      : null,
    r.config.filters.accountManagerId ? `${t('controls.accountManager')}: ${r.names[r.config.filters.accountManagerId] ?? ''}` : null,
    r.config.filters.platform ? `${t('controls.platform')}: ${kit.label('platform', r.config.filters.platform)}` : null,
  ].filter((x): x is string => Boolean(x));

  return {
    title: t('board.title'),
    organization: meta.organization,
    period: `${t(`controls.presets.${r.config.preset}`)} · ${t('periodRange', { from: day(r.period.from), to: day(r.period.to) })}`,
    comparison: r.comparison ? t('versus', { from: day(r.comparison.from), to: day(r.comparison.to) }) : null,
    generatedAt: t('board.generated', { time: f.dateTime(meta.generatedAt) }),
    filters,
    brief: briefLines(kit, r).map((l) => l.text),
    attention: r.attention.slice(0, 10).map((a) => `${t(`severity.${a.severity}`)} · ${riskText(kit, a)}`),
    slides: (meta.tabs ?? executiveTabs).map((tab) => slides[tab]()),
    dir: kit.locale === 'ar' ? 'rtl' : 'ltr',
    locale: kit.locale,
  };
}
