'use client';

import { BarChart3 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/patterns';
import { Card, CardContent, NativeSelect } from '@/components/ui/primitives';
import { cn } from '@/lib/utils/cn';
import { HealthBadge, PlatformMark, seriesColor } from '@/modules/campaigns/components/badges';
import { BreakdownBars, PacingMeter, TrendChart } from '@/modules/campaigns/components/charts';
import { useMetricFormat } from '@/modules/campaigns/components/format';
import { metricCatalog, metricKeys, type MetricKey } from '@/modules/campaigns/constants';
import { buildSeries, daysBetween, flightDays, metricValue, sumTotals, totalsByChannel, type MetricRow } from '@/modules/campaigns/metrics';
import type { CampaignAnalysis } from '@/modules/campaigns/metrics';
import type { ChannelItem } from '@/modules/campaigns/server/queries';

const toneOf = { on_track: 'success', at_risk: 'warning', off_track: 'danger', no_data: 'neutral' } as const;

export function CampaignOverview({
  analysis,
  channels,
  rows,
  startDate,
  endDate,
  currency,
}: {
  analysis: CampaignAnalysis;
  channels: ChannelItem[];
  rows: MetricRow[];
  startDate: string;
  endDate: string;
  currency: string;
}) {
  const t = useTranslations('campaigns');
  const { value, f } = useMetricFormat(currency);
  const hasData = analysis.through !== null;
  const defaultMetric: MetricKey = analysis.kpis.find((k) => metricCatalog[k.metric].kind === 'volume')?.metric ?? 'impressions';
  const [metric, setMetric] = useState<MetricKey>(defaultMetric);
  const [grain, setGrain] = useState<'day' | 'week'>('day');
  const [breakdownMetric, setBreakdownMetric] = useState<MetricKey>('spend');

  const channelLabel = (ch: ChannelItem) => ch.name || t(`platform.${ch.platform}`);
  const days = flightDays(startDate, endDate);
  const dayNumber = analysis.through ? Math.min(days, daysBetween(startDate, analysis.through) + 1) : 0;

  const through = analysis.through ?? startDate;
  const perChannel = channels.map((ch, i) => {
    const points = buildSeries(
      rows.filter((r) => r.channelId === ch.id),
      startDate,
      through,
      grain,
    );
    return { ch, i, points };
  });
  const pointKeys = perChannel[0]?.points.map((p) => p.key) ?? [];
  const series = perChannel.map(({ ch, i, points }) => ({
    key: ch.id,
    label: channelLabel(ch),
    color: seriesColor(i),
    values: points.map((p) => metricValue(p, metric) ?? 0),
  }));
  const byChannel = totalsByChannel(rows);

  const kpiLabel = (k: CampaignAnalysis['kpis'][number]) => {
    const ch = k.channelId ? channels.find((c) => c.id === k.channelId) : null;
    return ch ? `${t(`metric.${k.metric}`)} · ${channelLabel(ch)}` : t(`metric.${k.metric}`);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="campaign-overview">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="flex flex-col gap-3 p-4" data-testid="budget-tile">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">{t('overview.spend')}</span>
            {analysis.budget ? <HealthBadge health={analysis.budget.status} /> : null}
          </div>
          <p className="text-h2 font-semibold tracking-tight">{value('spend', analysis.totals.spend)}</p>
          {analysis.budget ? (
            <>
              <PacingMeter
                value={analysis.budget.budget > 0 ? analysis.totals.spend / analysis.budget.budget : 0}
                expected={analysis.elapsed}
                tone={toneOf[analysis.budget.status]}
                label={t('overview.budgetUsed')}
              />
              <p className="text-xs text-subtle-foreground">
                {t('overview.ofBudget', {
                  budget: value('spend', analysis.budget.budget),
                  expected: value('spend', analysis.budget.expected),
                })}
              </p>
            </>
          ) : (
            <p className="text-xs text-subtle-foreground">{t('overview.noBudget')}</p>
          )}
        </Card>
        {analysis.kpis.map((k) => {
          const kind = metricCatalog[k.metric].kind;
          const share = k.actual === null ? 0 : kind === 'volume' ? k.actual / k.target : Math.min(1, k.ratio ?? 0);
          return (
            <Card
              key={`${k.metric}:${k.channelId ?? ''}`}
              className="flex flex-col gap-3 p-4"
              data-testid="kpi-tile"
              data-metric={k.metric}
              data-status={k.status}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm text-muted-foreground">{kpiLabel(k)}</span>
                <HealthBadge health={k.status} />
              </div>
              <p className="text-h2 font-semibold tracking-tight">{value(k.metric, k.actual)}</p>
              <PacingMeter
                value={share}
                expected={kind === 'volume' ? analysis.elapsed : null}
                tone={toneOf[k.status]}
                label={kpiLabel(k)}
              />
              <p className="text-xs text-subtle-foreground">
                {kind === 'volume'
                  ? t('overview.targetProjected', { target: value(k.metric, k.target), projected: value(k.metric, k.projected) })
                  : t(kind === 'cost' ? 'overview.targetMax' : 'overview.targetMin', { target: value(k.metric, k.target) })}
              </p>
            </Card>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground" data-testid="flight-progress">
        {hasData
          ? t('overview.flight', { day: dayNumber, days, through: f.date(`${analysis.through}T12:00:00Z`) })
          : t('overview.noDataYet')}
      </p>

      {!hasData ? (
        <Card>
          <EmptyState icon={BarChart3} title={t('overview.emptyTitle')} description={t('overview.emptyBody')} />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
          <Card className="min-w-0">
            <CardContent className="flex flex-col gap-3 pt-5">
              <div className="flex flex-wrap items-center gap-2">
                <NativeSelect
                  aria-label={t('chart.metric')}
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as MetricKey)}
                  className="w-auto"
                  data-testid="trend-metric"
                >
                  {metricKeys.map((m) => (
                    <option key={m} value={m}>
                      {t(`metric.${m}`)}
                    </option>
                  ))}
                </NativeSelect>
                <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label={t('chart.grain')}>
                  {(['day', 'week'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={grain === g}
                      onClick={() => setGrain(g)}
                      className={cn(
                        'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground',
                        grain === g && 'bg-surface-muted text-foreground',
                      )}
                    >
                      {t(`chart.${g}`)}
                    </button>
                  ))}
                </div>
              </div>
              <TrendChart
                title={t('chart.trendTitle', { metric: t(`metric.${metric}`) })}
                points={pointKeys}
                series={series}
                formatValue={(v) => value(metric, v, { compact: true })}
                formatPoint={(k) =>
                  grain === 'week' ? t('chart.weekOf', { date: f.date(`${k}T12:00:00Z`, 'short') }) : f.dayMonth(`${k}T12:00:00Z`)
                }
              />
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardContent className="flex flex-col gap-3 pt-5">
              <NativeSelect
                aria-label={t('chart.metric')}
                value={breakdownMetric}
                onChange={(e) => setBreakdownMetric(e.target.value as MetricKey)}
                className="w-auto self-start"
              >
                {metricKeys.map((m) => (
                  <option key={m} value={m}>
                    {t(`metric.${m}`)}
                  </option>
                ))}
              </NativeSelect>
              <BreakdownBars
                title={t('chart.byChannel', { metric: t(`metric.${breakdownMetric}`) })}
                formatValue={(v) => value(breakdownMetric, v, { compact: true })}
                rows={channels.map((ch, i) => ({
                  key: ch.id,
                  label: channelLabel(ch),
                  color: seriesColor(i),
                  value: metricValue(byChannel.get(ch.id) ?? analysis.totals, breakdownMetric) ?? 0,
                }))}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {hasData ? <ChannelTable channels={channels} rows={rows} currency={currency} /> : null}
    </div>
  );
}

const tableMetrics: MetricKey[] = ['spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm', 'conversions', 'cpa', 'leads', 'roas'];

export function ChannelTable({ channels, rows, currency }: { channels: ChannelItem[]; rows: MetricRow[]; currency: string }) {
  const t = useTranslations('campaigns');
  const { value } = useMetricFormat(currency);
  const byChannel = totalsByChannel(rows);
  const all = sumTotals([...byChannel.values()]);
  // Columns that are zero everywhere (e.g. revenue on an awareness campaign) are hidden.
  const cols = tableMetrics.filter((m) => (metricValue(all, m) ?? 0) > 0);
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="channel-table">
          <caption className="sr-only">{t('overview.channelTable')}</caption>
          <thead className="bg-surface-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-start font-medium">{t('fields.channel')}</th>
              {cols.map((m) => (
                <th key={m} className="px-4 py-2.5 text-end font-medium whitespace-nowrap">
                  {t(`metric.${m}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => {
              const totals = byChannel.get(ch.id);
              return (
                <tr key={ch.id} className="border-t border-border">
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-2">
                      <PlatformMark platform={ch.platform} />
                      <span className="truncate">{ch.name || t(`platform.${ch.platform}`)}</span>
                    </span>
                  </td>
                  {cols.map((m) => (
                    <td key={m} className="tabular px-4 py-2.5 text-end whitespace-nowrap">
                      {totals ? value(m, metricValue(totals, m)) : '—'}
                    </td>
                  ))}
                </tr>
              );
            })}
            <tr className="border-t border-border-strong bg-surface-muted/50 font-medium">
              <td className="px-4 py-2.5">{t('overview.total')}</td>
              {cols.map((m) => (
                <td key={m} className="tabular px-4 py-2.5 text-end whitespace-nowrap">
                  {value(m, metricValue(all, m))}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
