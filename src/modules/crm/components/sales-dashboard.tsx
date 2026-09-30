import { CircleDollarSign, Percent, Timer, UserPlus } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { EmptyState, SectionTitle, StatCard } from '@/components/patterns';
import { Card } from '@/components/ui/primitives';
import { localized } from '@/lib/i18n/localized';
import { getFormatters } from '@/lib/i18n/server-format';
import { cn } from '@/lib/utils/cn';
import { lostReasons, type LeadSource } from '@/modules/crm/constants';
import {
  averageCycleDays,
  forecastByMonth,
  leadsBySource,
  monthKeys,
  performanceByOwner,
  pipelineByStage,
  stageConversion,
  winRate,
} from '@/modules/crm/metrics';
import type { SalesData } from '@/modules/crm/server/dashboard';

function Bar({ value, max, tone = 'primary' }: { value: number; max: number; tone?: 'primary' | 'success' | 'muted' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden>
      <div
        className={cn(
          'h-full rounded-full',
          tone === 'primary' && 'bg-primary',
          tone === 'success' && 'bg-success',
          tone === 'muted' && 'bg-subtle-foreground/50',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export async function SalesDashboard({ data, showPeople }: { data: SalesData; showPeople: boolean }) {
  const t = await getTranslations('crm');
  const f = await getFormatters();
  const { deals, pipeline, from, today } = data;
  if (!deals.length && !data.leads.length)
    return <EmptyState icon={CircleDollarSign} title={t('dashboard.empty')} description={t('dashboard.emptyBody')} />;

  const stageName = (id: string) => localized(pipeline.stages.find((s) => s.id === id)?.name ?? {}, f.locale);
  const open = deals.filter((d) => d.status === 'open');
  const openValue = open.reduce((n, d) => n + d.valueMinor, 0);
  const byStage = pipelineByStage(
    deals.filter((d) => d.status === 'open' || (d.wonAt ?? d.lostAt ?? '').slice(0, 10) >= from),
    pipeline.stages,
  );
  const maxStage = Math.max(...byStage.map((s) => s.value), 1);
  const rate = winRate(deals, from, today);
  const wonCount = deals.filter((d) => d.status === 'won' && (d.wonAt ?? '').slice(0, 10) >= from).length;
  const lostInPeriod = deals.filter((d) => d.status === 'lost' && (d.lostAt ?? '').slice(0, 10) >= from);
  const cycle = averageCycleDays(deals, from, today);
  const sources = leadsBySource(data.leads, from, today);
  const newLeads = sources.reduce((n, s) => n + s.leads, 0);
  const converted = sources.reduce((n, s) => n + s.converted, 0);
  const conversion = stageConversion(deals, pipeline.stages, data.moves);
  const openStages = pipeline.stages.filter((s) => s.kind === 'open').sort((a, b) => a.sortOrder - b.sortOrder);
  const forecast = forecastByMonth(deals, monthKeys(today, 6), data.targets);
  const maxForecast = Math.max(...forecast.map((m) => Math.max(m.forecast, m.target ?? 0)), 1);
  const people = performanceByOwner(deals, from, today);
  const reasons = lostReasons
    .map((r) => ({ reason: r, count: lostInPeriod.filter((d) => d.lostReason === r).length }))
    .filter((r) => r.count);
  const monthLabel = (m: string) => f.monthYear(`${m}-15T12:00:00Z`);

  return (
    <div className="space-y-8" data-testid="sales-dashboard">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('dashboard.pipelineValue')}
          value={<span data-testid="kpi-pipeline">{f.currency(openValue)}</span>}
          icon={CircleDollarSign}
          footer={t('dashboard.pipelineValueFooter', {
            weighted: f.currency(open.reduce((n, d) => n + Math.round((d.valueMinor * d.probability) / 100), 0)),
          })}
        />
        <StatCard
          label={t('dashboard.winRate')}
          value={<span data-testid="kpi-winrate">{rate === null ? t('dashboard.noData') : f.percent(rate)}</span>}
          icon={Percent}
          footer={t('dashboard.winRateFooter', { won: wonCount, lost: lostInPeriod.length })}
        />
        <StatCard
          label={t('dashboard.cycle')}
          value={cycle === null ? t('dashboard.noData') : t('dashboard.cycleValue', { days: Math.round(cycle) })}
          icon={Timer}
          footer={t('dashboard.cycleFooter')}
        />
        <StatCard
          label={t('dashboard.newLeads')}
          value={f.number(newLeads)}
          icon={UserPlus}
          footer={t('dashboard.newLeadsFooter', { converted })}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="min-w-0">
          <SectionTitle title={t('dashboard.byStage')} />
          <Card className="grid gap-3 p-4" data-testid="sales-by-stage">
            {byStage.map((s) => (
              <div key={s.stageId} className="grid gap-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate font-medium">
                    {stageName(s.stageId)} <span className="text-xs text-subtle-foreground">· {f.number(s.count)}</span>
                  </span>
                  <span className="tabular shrink-0 text-muted-foreground">
                    {f.currency(s.value)}
                    {s.kind === 'open' ? <span className="text-xs text-subtle-foreground"> · {f.currency(s.weighted)}</span> : null}
                  </span>
                </div>
                <Bar value={s.value} max={maxStage} tone={s.kind === 'won' ? 'success' : s.kind === 'lost' ? 'muted' : 'primary'} />
              </div>
            ))}
          </Card>
        </section>

        <section className="min-w-0">
          <SectionTitle title={t('dashboard.conversion')} />
          <Card className="grid gap-3 p-4" data-testid="sales-conversion">
            <p className="text-xs text-subtle-foreground">{t('dashboard.conversionHint')}</p>
            {conversion.map((c, i) => {
              const next = c.toWon ? pipeline.stages.find((s) => s.kind === 'won')?.id : openStages[i + 1]?.id;
              return (
                <div key={c.stageId} className="grid gap-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{stageName(c.stageId)}</span>{' '}
                      <span className="text-muted-foreground">{t('dashboard.toNext', { stage: next ? stageName(next) : '' })}</span>
                    </span>
                    <span className="tabular shrink-0">
                      {c.rate === null ? t('dashboard.noData') : f.percent(c.rate)}{' '}
                      <span className="text-xs text-subtle-foreground">· {t('dashboard.reached', { count: c.reached })}</span>
                    </span>
                  </div>
                  <Bar value={c.rate ?? 0} max={1} />
                </div>
              );
            })}
          </Card>
        </section>
      </div>

      <section>
        <SectionTitle title={t('dashboard.forecast')} />
        <Card className="overflow-x-auto p-4" data-testid="sales-forecast">
          <p className="mb-3 text-xs text-subtle-foreground">{t('dashboard.forecastHint')}</p>
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pb-2 text-start font-medium">{t('dashboard.month')}</th>
                <th className="pb-2 text-end font-medium">{t('dashboard.wonCol')}</th>
                <th className="pb-2 text-end font-medium">{t('dashboard.weightedCol')}</th>
                <th className="pb-2 text-end font-medium">{t('dashboard.forecastCol')}</th>
                <th className="pb-2 text-end font-medium">{t('dashboard.targetCol')}</th>
                <th className="w-40 pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {forecast.map((m) => (
                <tr key={m.month}>
                  <td className="py-2 font-medium">{monthLabel(m.month)}</td>
                  <td className="tabular py-2 text-end">{f.currency(m.won)}</td>
                  <td className="tabular py-2 text-end text-muted-foreground">{f.currency(m.weighted)}</td>
                  <td className="tabular py-2 text-end font-semibold">{f.currency(m.forecast)}</td>
                  <td className="tabular py-2 text-end">
                    {m.target === null ? (
                      <span className="text-subtle-foreground">{t('dashboard.noTarget')}</span>
                    ) : (
                      <>
                        {f.currency(m.target)}
                        <span className="block text-xs text-subtle-foreground">
                          {t('dashboard.ofTarget', { percent: f.percent(m.target ? m.forecast / m.target : 0) })}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="py-2 ps-4">
                    <Bar
                      value={m.forecast}
                      max={m.target ?? maxForecast}
                      tone={m.target !== null && m.forecast >= m.target ? 'success' : 'primary'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="min-w-0">
          <SectionTitle title={t('dashboard.sources')} />
          <Card className="p-4" data-testid="sales-sources">
            {sources.length === 0 ? (
              <p className="text-sm text-subtle-foreground">{t('dashboard.noData')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="pb-2 text-start font-medium">{t('leads.source')}</th>
                    <th className="pb-2 text-end font-medium">{t('dashboard.leads')}</th>
                    <th className="pb-2 text-end font-medium">{t('dashboard.converted')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sources.map((s) => (
                    <tr key={s.source}>
                      <td className="py-2">{t(`sources.${s.source as LeadSource}`)}</td>
                      <td className="tabular py-2 text-end">{f.number(s.leads)}</td>
                      <td className="tabular py-2 text-end">
                        {f.number(s.converted)} <span className="text-xs text-subtle-foreground">({f.percent(s.converted / s.leads)})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </section>

        <section className="min-w-0">
          <SectionTitle title={t('dashboard.lostReasons')} />
          <Card className="grid gap-3 p-4" data-testid="sales-lost">
            {reasons.length === 0 ? (
              <p className="text-sm text-subtle-foreground">{t('dashboard.noData')}</p>
            ) : (
              reasons.map((r) => (
                <div key={r.reason} className="grid gap-1">
                  <div className="flex justify-between gap-2 text-sm">
                    <span>{t(`lostReasons.${r.reason}`)}</span>
                    <span className="tabular">{f.number(r.count)}</span>
                  </div>
                  <Bar value={r.count} max={lostInPeriod.length} tone="muted" />
                </div>
              ))
            )}
          </Card>
        </section>
      </div>

      {showPeople ? (
        <section>
          <SectionTitle title={t('dashboard.people')} />
          <Card className="overflow-x-auto p-4" data-testid="sales-people">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pb-2 text-start font-medium">{t('dashboard.owner')}</th>
                  <th className="pb-2 text-end font-medium">{t('dashboard.openDeals')}</th>
                  <th className="pb-2 text-end font-medium">{t('dashboard.weightedValue')}</th>
                  <th className="pb-2 text-end font-medium">{t('dashboard.wonValue')}</th>
                  <th className="pb-2 text-end font-medium">{t('dashboard.winRate')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {people.map((p) => (
                  <tr key={p.ownerId ?? 'none'}>
                    <td className="py-2 font-medium">{p.ownerId ? (data.people.get(p.ownerId) ?? '') : t('leads.unassigned')}</td>
                    <td className="tabular py-2 text-end">
                      {f.number(p.openCount)} <span className="text-xs text-subtle-foreground">· {f.currency(p.openValue)}</span>
                    </td>
                    <td className="tabular py-2 text-end">{f.currency(p.weighted)}</td>
                    <td className="tabular py-2 text-end">
                      {f.currency(p.wonValue)} <span className="text-xs text-subtle-foreground">· {f.number(p.wonCount)}</span>
                    </td>
                    <td className="tabular py-2 text-end">{p.winRate === null ? t('dashboard.noData') : f.percent(p.winRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
