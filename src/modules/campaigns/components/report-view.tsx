'use client';

import { ArrowDownRight, ArrowUpRight, ImageIcon, Minus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { useFormat } from '@/components/providers';
import { DirIcon } from '@/components/patterns';
import { Avatar } from '@/components/ui/primitives';
import { localized } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { HealthBadge, PlatformMark, seriesColor } from '@/modules/campaigns/components/badges';
import { BreakdownBars, TrendChart } from '@/modules/campaigns/components/charts';
import { useMetricFormat } from '@/modules/campaigns/components/format';
import { SimpleMarkdown } from '@/modules/campaigns/components/simple-markdown';
import { metricCatalog, type MetricKey } from '@/modules/campaigns/constants';
import { emptyTotals, metricValue, weekStart, type MetricTotals, type SeriesPoint } from '@/modules/campaigns/metrics';
import type { ReportDetail, ReportSectionItem } from '@/modules/campaigns/server/queries';

const summaryDefault: MetricKey[] = ['spend', 'impressions', 'reach', 'clicks', 'ctr', 'conversions'];

function byWeek(daily: SeriesPoint[]): SeriesPoint[] {
  const out = new Map<string, SeriesPoint>();
  for (const p of daily) {
    const k = weekStart(p.key);
    const cur = out.get(k) ?? { key: k, ...emptyTotals() };
    for (const m of Object.keys(emptyTotals()) as (keyof MetricTotals)[]) cur[m] += p[m];
    out.set(k, cur);
  }
  return [...out.values()];
}

function Delta({ metric, now, before }: { metric: MetricKey; now: number | null; before: number | null }) {
  const t = useTranslations('reports.view');
  const f = useFormat();
  if (now === null || before === null || before === 0) return null;
  const change = (now - before) / before;
  const flat = Math.abs(change) < 0.005;
  // Up is good for volumes and rates, bad for costs.
  const good = flat ? null : metricCatalog[metric].kind === 'cost' ? change < 0 : change > 0;
  const Icon = flat ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium',
        good === true && 'bg-success-soft text-success',
        good === false && 'bg-danger-soft text-danger',
        good === null && 'bg-surface-muted text-muted-foreground',
      )}
      title={t('vsPrevious')}
    >
      <DirIcon icon={Icon} className="size-3.5" />
      {flat ? t('noChange') : f.number(Math.abs(change), { style: 'percent', maximumFractionDigits: 0 })}
    </span>
  );
}

function Section({ section, report }: { section: ReportSectionItem; report: ReportDetail }) {
  const t = useTranslations('reports');
  const tc = useTranslations('campaigns');
  const f = useFormat();
  const { value } = useMetricFormat(report.snapshot.currency);
  const s = report.snapshot;
  const hasData = s.daily.some((d) => d.impressions || d.spend || d.clicks);
  const channelLabel = (ch: (typeof s.channels)[number]) => ch.name || tc(`platform.${ch.platform}`);
  const noon = (d: string) => `${d}T12:00:00Z`;

  switch (section.kind) {
    case 'kpi_summary': {
      const metrics = section.config.metrics?.length ? section.config.metrics : summaryDefault;
      return (
        <div className="flex flex-col gap-5">
          {hasData ? (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {metrics.map((m) => (
                <div key={m} className="break-inside-avoid rounded-lg border border-border p-4" data-testid="report-kpi" data-metric={m}>
                  <dt className="text-xs text-muted-foreground">{tc(`metric.${m}`)}</dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-h3 font-semibold">{value(m, metricValue(s.totals, m))}</span>
                    <Delta metric={m} now={metricValue(s.totals, m)} before={metricValue(s.previousTotals, m)} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">{t('view.noData')}</p>
          )}
          {s.campaigns.length ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t('view.campaigns')}</h3>
              <ul className="flex flex-col gap-2">
                {s.campaigns.map((c) => (
                  <li key={c.id} className="break-inside-avoid rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {t('view.campaignLine', { name: c.name, start: f.dayMonth(noon(c.startDate)), end: f.date(noon(c.endDate)) })}
                      </span>
                      <HealthBadge health={c.health} />
                    </div>
                    {c.budgetMinor > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('view.budget', { spent: value('spend', c.totals.spend), budget: value('spend', c.budgetMinor) })}
                      </p>
                    ) : null}
                    {c.kpis.length ? (
                      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                        {c.kpis.map((k) => (
                          <li key={`${k.metric}:${k.channelId ?? ''}`} className="flex items-center justify-between gap-2 text-sm">
                            <span className="text-muted-foreground">{tc(`metric.${k.metric}`)}</span>
                            <span className="inline-flex items-center gap-2">
                              <span className="tabular">{value(k.metric, k.actual)}</span>
                              <span className="text-xs text-subtle-foreground">
                                {t('view.kpiTarget', { target: value(k.metric, k.target) })}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      );
    }
    case 'trend': {
      if (!hasData) return <p className="text-sm text-muted-foreground">{t('view.noData')}</p>;
      const metrics = section.config.metrics?.length ? section.config.metrics : (['impressions'] as MetricKey[]);
      const grain = section.config.grain ?? 'day';
      const points = grain === 'week' ? byWeek(s.daily) : s.daily;
      // One metric per chart (never two y-scales).
      return (
        <div className="grid gap-6 md:grid-cols-2">
          {metrics.slice(0, 4).map((m) => (
            <TrendChart
              key={m}
              title={tc('chart.trendTitle', { metric: tc(`metric.${m}`) })}
              points={points.map((p) => p.key)}
              series={[{ key: m, label: tc(`metric.${m}`), color: seriesColor(0), values: points.map((p) => metricValue(p, m) ?? 0) }]}
              formatValue={(v) => value(m, v, { compact: true })}
              formatPoint={(k) => (grain === 'week' ? tc('chart.weekOf', { date: f.dayMonth(noon(k)) }) : f.dayMonth(noon(k)))}
              height={200}
              className="break-inside-avoid"
            />
          ))}
        </div>
      );
    }
    case 'channel_breakdown': {
      if (!hasData || !s.channels.length) return <p className="text-sm text-muted-foreground">{t('view.noData')}</p>;
      const metrics = section.config.metrics?.length
        ? section.config.metrics
        : (['spend', 'impressions', 'clicks', 'ctr', 'conversions'] as MetricKey[]);
      return (
        <div className="flex flex-col gap-5">
          <BreakdownBars
            title={tc('chart.byChannel', { metric: tc(`metric.${metrics[0]!}`) })}
            formatValue={(v) => value(metrics[0]!, v, { compact: true })}
            rows={s.channels.map((ch, i) => ({
              key: ch.id,
              label: channelLabel(ch),
              color: seriesColor(i),
              value: metricValue(ch.totals, metrics[0]!) ?? 0,
            }))}
            className="break-inside-avoid"
          />
          <div className="break-inside-avoid overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{tc('fields.channel')}</th>
                  {metrics.map((m) => (
                    <th key={m} className="px-3 py-2 text-end font-medium whitespace-nowrap">
                      {tc(`metric.${m}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.channels.map((ch) => (
                  <tr key={ch.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-2">
                        <PlatformMark platform={ch.platform} />
                        {channelLabel(ch)}
                      </span>
                    </td>
                    {metrics.map((m) => (
                      <td key={m} className="tabular px-3 py-2 text-end whitespace-nowrap">
                        {value(m, metricValue(ch.totals, m))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    case 'top_creatives':
      return s.creatives.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {s.creatives.map((c) => (
            <li key={c.id} className="break-inside-avoid overflow-hidden rounded-lg border border-border">
              <div className="flex aspect-[4/3] items-center justify-center bg-surface-muted">
                {report.creativeThumbs[c.id] ? (
                  // Signed, short-lived URL; next/image can't optimize it.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={report.creativeThumbs[c.id]} alt={c.title} className="size-full object-cover" />
                ) : (
                  <ImageIcon className="size-8 text-subtle-foreground" aria-hidden />
                )}
              </div>
              <div className="p-2">
                <p className="truncate text-sm font-medium">{c.title}</p>
                {c.approvedAt ? (
                  <p className="text-xs text-subtle-foreground">{t('view.approvedOn', { date: f.date(c.approvedAt) })}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t('view.noCreatives')}</p>
      );
    case 'commentary':
    case 'next_steps':
      return section.body.trim() ? (
        <div lang={report.locale} dir={report.locale === 'ar' ? 'rtl' : 'ltr'}>
          <SimpleMarkdown text={section.body} />
        </div>
      ) : (
        <p className="text-sm text-subtle-foreground italic">{t('view.empty')}</p>
      );
  }
}

/** The report as the client sees it (and prints it). Numbers come from the snapshot only. */
export function ReportView({ report }: { report: ReportDetail }) {
  const t = useTranslations('reports');
  const locale = useLocale() as 'ar' | 'en';
  const f = useFormat();
  const noon = (d: string) => `${d}T12:00:00Z`;
  return (
    <article
      className="report-print mx-auto flex w-full max-w-4xl flex-col gap-8 rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-8 print:max-w-none print:border-0 print:p-0 print:shadow-none"
      style={{ ['--report-brand' as string]: report.brand.primaryColor }}
      data-testid="report-view"
      data-status={report.status}
    >
      <header className="flex flex-col gap-4 border-b-4 pb-6" style={{ borderColor: 'var(--report-brand)' }}>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2 text-sm font-semibold">
            <Avatar
              square
              size="sm"
              name={localized(report.brand.name, locale)}
              src={report.brand.logoPath ? publicAssetUrl(report.brand.logoPath) : undefined}
            />
            {localized(report.brand.name, locale)}
          </span>
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Avatar
              square
              size="sm"
              name={localized(report.clientName, locale)}
              src={report.clientLogo ? publicAssetUrl(report.clientLogo) : undefined}
            />
            {localized(report.clientName, locale)}
          </span>
        </div>
        {report.status === 'draft' ? (
          <p className="rounded-md bg-warning-soft px-3 py-1.5 text-sm font-medium text-warning print:hidden" data-testid="draft-banner">
            {t('view.draftBanner')}
          </p>
        ) : null}
        <div>
          <h1 className="text-h1 font-semibold tracking-tight text-balance" dir="auto">
            {report.title}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {t('view.period', { start: f.date(noon(report.periodStart)), end: f.date(noon(report.periodEnd)) })}
            {report.publishedAt ? ` · ${t('view.publishedOn', { date: f.date(report.publishedAt) })}` : null}
          </p>
        </div>
      </header>

      {report.sections.map((section) => (
        <section
          key={section.id}
          className="flex break-inside-avoid-page flex-col gap-4"
          data-testid="report-section"
          data-kind={section.kind}
        >
          <h2 className="flex items-center gap-2 text-h3 font-semibold">
            <span className="h-5 w-1 rounded-full" style={{ background: 'var(--report-brand)' }} aria-hidden />
            {t(`kind.${section.kind}`)}
          </h2>
          <Section section={section} report={report} />
        </section>
      ))}

      <footer className="border-t border-border pt-4 text-xs text-subtle-foreground">
        {t('view.footer', { date: f.date(report.snapshot.generatedAt) })} ·{' '}
        {t('view.preparedBy', { agency: localized(report.brand.name, locale) })}
      </footer>
    </article>
  );
}
