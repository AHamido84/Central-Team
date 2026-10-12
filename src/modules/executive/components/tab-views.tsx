'use client';

import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { DirIcon, EmptyState } from '@/components/patterns';
import { Badge, Card, Progress } from '@/components/ui/primitives';
import { cn } from '@/lib/utils/cn';
import { BreakdownBars, TrendChart } from '@/modules/campaigns/components/charts';
import type { ExecutiveReport, RiskItem } from '@/modules/executive/compute';
import { movingAverage } from '@/modules/executive/kpi';
import { formatValue, nameText, riskText, type ExecKit } from '@/modules/executive/text';

const chart = (i: number) => `var(--chart-${(i % 8) + 1})`;
const severityTone = { high: 'danger', medium: 'warning', low: 'neutral' } as const;
const healthTone = { healthy: 'success', watch: 'warning', at_risk: 'danger' } as const;

export function Section({
  title,
  children,
  className,
  testId,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <Card className={cn('min-w-0 space-y-3 p-5', className)} data-testid={testId}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </Card>
  );
}

/** A compact, horizontally scrollable table; numbers align to the end. */
export function DataTable({
  head,
  rows,
  empty,
  testId,
}: {
  head: { label: string; numeric?: boolean }[];
  rows: { key: string; cells: ReactNode[] }[];
  empty: string;
  testId?: string;
}) {
  if (!rows.length) return <p className="text-sm text-subtle-foreground">{empty}</p>;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-max text-sm" data-testid={testId}>
        <thead>
          <tr className="border-b border-border text-xs text-subtle-foreground">
            {head.map((h) => (
              <th key={h.label} scope="col" className={cn('px-2 py-2 font-medium', h.numeric ? 'text-end' : 'text-start')}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border/60 last:border-0">
              {r.cells.map((c, i) => (
                <td key={i} className={cn('px-2 py-2', head[i]?.numeric ? 'tabular text-end' : 'text-start')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useFmt(kit: ExecKit) {
  const { f } = kit;
  return {
    money: (v: number | null) => formatValue(kit, 'currency', v),
    compact: (v: number | null) => formatValue(kit, 'currency', v, { compact: true }),
    pct: (v: number | null) => formatValue(kit, 'percent', v),
    num: (v: number | null) => formatValue(kit, 'count', v),
    days: (v: number | null) => formatValue(kit, 'days', v),
    hours: (v: number | null) => formatValue(kit, 'hours', v),
    ratio: (v: number | null) => formatValue(kit, 'ratio', v),
    month: (key: string) => f.monthYear(`${key}-15T12:00:00Z`),
    day: (iso: string) => f.dayMonth(`${iso}T12:00:00Z`),
  };
}

const rateCell = (fmt: ReturnType<typeof useFmt>, r: { value: number | null; num: number; den: number }, kit: ExecKit) => (
  <span title={kit.t('tile.parts', { num: kit.f.number(Math.round(r.num)), den: kit.f.number(Math.round(r.den)) })}>
    {fmt.pct(r.value)}
  </span>
);

// ---------------------------------------------------------------------------------------------------------------------

export function ClientsTab({ kit, report }: { kit: ExecKit; report: ExecutiveReport }) {
  const { t } = kit;
  const fmt = useFmt(kit);
  const c = report.clients;
  const revenue = c.revenueByMonth.map((r) => r.value);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {c.concentrationRisk ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning lg:col-span-2"
          role="status"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('charts.concentration')}
        </div>
      ) : null}
      <Section title={t('charts.revenueByMonth')} className="lg:col-span-2">
        <TrendChart
          title={t('charts.revenueByMonth')}
          points={c.revenueByMonth.map((r) => r.key)}
          series={[
            { key: 'revenue', label: t('charts.revenue'), color: chart(0), values: revenue },
            { key: 'ma', label: t('charts.movingAverage'), color: chart(3), values: movingAverage(revenue, 3) },
          ]}
          formatValue={fmt.compact}
          formatPoint={fmt.month}
        />
      </Section>
      <Section title={t('charts.revenueByClient')} testId="revenue-by-client">
        <DataTable
          empty={t('charts.empty')}
          head={[
            { label: t('col.client') },
            { label: t('col.revenue'), numeric: true },
            { label: t('col.share'), numeric: true },
            { label: t('col.hours'), numeric: true },
            { label: t('col.perHour'), numeric: true },
            { label: t('col.health') },
          ]}
          rows={c.revenueByClient.map((r) => ({
            key: r.id,
            cells: [
              <Link key="n" href={`/clients/${r.id}`} className="font-medium hover:underline">
                {nameText(kit, r.name)}
              </Link>,
              fmt.money(r.value),
              fmt.pct(r.share),
              kit.f.number(Math.round(r.hours)),
              fmt.money(r.perHour),
              r.health ? (
                <Badge key="h" tone={healthTone[r.health]}>
                  {kit.label('clientHealth', r.health)} · {kit.f.number(r.score ?? 0)}
                </Badge>
              ) : (
                '—'
              ),
            ],
          }))}
        />
      </Section>
      <div className="grid gap-4">
        <Section title={t('charts.revenueByPackage')}>
          {c.revenueByPackage.length ? (
            <BreakdownBars
              title={t('charts.revenueByPackage')}
              rows={c.revenueByPackage.map((p, i) => ({ key: p.id, label: nameText(kit, p.name), color: chart(i), value: p.value }))}
              formatValue={fmt.compact}
            />
          ) : (
            <p className="text-sm text-subtle-foreground">{t('charts.empty')}</p>
          )}
        </Section>
        <Section title={t('charts.healthDistribution')}>
          <BreakdownBars
            title={t('charts.healthDistribution')}
            rows={(['healthy', 'watch', 'at_risk'] as const).map((h) => ({
              key: h,
              label: kit.label('clientHealth', h),
              color: h === 'healthy' ? 'var(--color-success)' : h === 'watch' ? 'var(--color-warning)' : 'var(--color-danger)',
              value: c.healthDistribution[h],
            }))}
            formatValue={fmt.num}
          />
        </Section>
      </div>
      <Section title={t('charts.healthTrend')}>
        {c.healthTrend.some((p) => p.value !== null) ? (
          <TrendChart
            title={t('charts.healthTrend')}
            points={c.healthTrend.map((p) => p.key)}
            series={[{ key: 'h', label: t('kpi.avg_health.name'), color: chart(1), values: c.healthTrend.map((p) => p.value ?? 0) }]}
            formatValue={fmt.num}
            formatPoint={fmt.month}
            height={200}
          />
        ) : (
          <p className="text-sm text-subtle-foreground">{t('charts.noTrend')}</p>
        )}
      </Section>
      <Section title={t('charts.newVsLost')}>
        <TrendChart
          title={t('charts.newVsLost')}
          points={c.newVsLost.map((p) => p.key)}
          series={[
            { key: 'added', label: t('charts.added'), color: 'var(--color-success)', values: c.newVsLost.map((p) => p.added) },
            { key: 'lost', label: t('charts.lost'), color: 'var(--color-danger)', values: c.newVsLost.map((p) => p.lost) },
          ]}
          formatValue={fmt.num}
          formatPoint={fmt.month}
          height={200}
        />
      </Section>
      <Section title={t('charts.packageUsage')} className="lg:col-span-2">
        {c.packageUsage.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {c.packageUsage.map((u) => (
              <li key={u.clientId} className="space-y-1 text-sm">
                <span className="flex justify-between gap-2">
                  <Link href={`/clients/${u.clientId}?tab=package`} className="truncate hover:underline">
                    {nameText(kit, u.name)}
                  </Link>
                  <span className="tabular font-medium">{fmt.pct(u.ratio)}</span>
                </span>
                <Progress
                  value={Math.round(u.ratio * 100)}
                  tone={u.ratio > 1 ? 'danger' : u.ratio > 0.85 ? 'warning' : 'brand'}
                  aria-label={nameText(kit, u.name)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-subtle-foreground">{t('charts.empty')}</p>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

export function OperationsTab({ kit, report }: { kit: ExecKit; report: ExecutiveReport }) {
  const { t } = kit;
  const fmt = useFmt(kit);
  const o = report.operations;
  const complianceRows = (
    rows: {
      id: string;
      name: unknown;
      n: number;
      onTime: (typeof o.complianceByClient)[number]['onTime'];
      sla: (typeof o.complianceByClient)[number]['sla'];
    }[],
  ) =>
    rows.map((r) => ({
      key: r.id,
      cells: [
        r.name ? nameText(kit, r.name) : '—',
        kit.f.number(r.n),
        rateCell(fmt, { value: r.onTime.rate, num: r.onTime.met, den: r.onTime.total }, kit),
        rateCell(fmt, { value: r.sla.rate, num: r.sla.met, den: r.sla.total }, kit),
      ],
    }));
  const complianceHead = (first: string) => [
    { label: first },
    { label: t('col.count'), numeric: true },
    { label: t('col.onTime'), numeric: true },
    { label: t('col.sla'), numeric: true },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title={t('charts.intakeVsDone')} className="lg:col-span-2">
        <TrendChart
          title={t('charts.intakeVsDone')}
          points={o.intakeVsDone.map((p) => p.key)}
          series={[
            { key: 's', label: t('charts.submitted'), color: chart(0), values: o.intakeVsDone.map((p) => p.submitted) },
            { key: 'd', label: t('charts.delivered'), color: chart(2), values: o.intakeVsDone.map((p) => p.delivered) },
          ]}
          formatValue={fmt.num}
          formatPoint={fmt.month}
        />
      </Section>
      <Section title={t('charts.turnaroundByType')} testId="turnaround-by-type">
        <DataTable
          empty={t('charts.empty')}
          head={[
            { label: t('col.type') },
            { label: t('col.median'), numeric: true },
            { label: t('col.p90'), numeric: true },
            { label: t('col.count'), numeric: true },
          ]}
          rows={o.turnaroundByType.map((r) => ({
            key: r.id ?? 'none',
            cells: [r.name ? nameText(kit, r.name) : '—', fmt.days(r.median), fmt.days(r.p90), kit.f.number(r.n)],
          }))}
        />
      </Section>
      <Section title={t('charts.backlogAging')}>
        <BreakdownBars
          title={t('charts.backlogAging')}
          rows={o.backlogAging.map((b, i) => ({
            key: b.key,
            label: t(`charts.ageBuckets.${b.key}`),
            color: i >= 2 ? 'var(--color-danger)' : chart(0),
            value: b.count,
          }))}
          formatValue={fmt.num}
        />
      </Section>
      <Section title={t('charts.complianceByClient')}>
        <DataTable empty={t('charts.empty')} head={complianceHead(t('col.client'))} rows={complianceRows(o.complianceByClient)} />
      </Section>
      <Section title={t('charts.complianceByType')}>
        <DataTable empty={t('charts.empty')} head={complianceHead(t('col.type'))} rows={complianceRows(o.complianceByType)} />
      </Section>
      <Section title={t('charts.bottlenecks')} className="lg:col-span-2">
        <DataTable
          empty={t('charts.empty')}
          head={[
            { label: t('col.step') },
            { label: t('col.median'), numeric: true },
            { label: t('col.p90'), numeric: true },
            { label: t('col.count'), numeric: true },
          ]}
          rows={o.bottlenecks.map((b, i) => ({
            key: `${i}`,
            cells: [nameText(kit, b.name), fmt.days(b.median), fmt.days(b.p90), kit.f.number(b.n)],
          }))}
        />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

export function TeamTab({ kit, report }: { kit: ExecKit; report: ExecutiveReport }) {
  const { t } = kit;
  const fmt = useFmt(kit);
  const tm = report.team;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title={t('charts.byDepartment')}>
        <BreakdownBars
          title={t('charts.byDepartment')}
          rows={tm.byDepartment.map((d) => ({
            key: d.id,
            label: nameText(kit, d.name),
            color: d.color || chart(0),
            value: d.utilization.value ?? 0,
            hint: t('tile.parts', { num: fmt.hours(d.logged), den: fmt.hours(d.available) }),
          }))}
          formatValue={fmt.pct}
        />
      </Section>
      <Section title={t('charts.capacityForecast')}>
        <TrendChart
          title={t('charts.capacityForecast')}
          points={tm.forecast.map((w) => w.week)}
          series={[
            { key: 'c', label: t('charts.capacity'), color: chart(1), values: tm.forecast.map((w) => w.capacity) },
            { key: 'd', label: t('charts.demand'), color: chart(4), values: tm.forecast.map((w) => w.demand) },
          ]}
          formatValue={fmt.hours}
          formatPoint={fmt.day}
          height={200}
        />
      </Section>
      <Section title={t('charts.byPerson')} className="lg:col-span-2" testId="team-by-person">
        <DataTable
          empty={t('charts.empty')}
          head={[
            { label: t('col.person') },
            { label: t('col.utilization'), numeric: true },
            { label: t('col.logged'), numeric: true },
            { label: t('col.open'), numeric: true },
            { label: t('col.done'), numeric: true },
            { label: t('col.onTime'), numeric: true },
          ]}
          rows={tm.byPerson.map((p) => ({
            key: p.id,
            cells: [
              p.name,
              rateCell(fmt, p.utilization, kit),
              fmt.hours(p.logged),
              kit.f.number(p.open),
              kit.f.number(p.done),
              rateCell(fmt, p.onTime, kit),
            ],
          }))}
        />
      </Section>
      <Section title={t('charts.hiring')} className="lg:col-span-2" testId="hiring-signal">
        {tm.hiring.length ? (
          <ul className="space-y-2 text-sm">
            {tm.hiring.map((h) => (
              <li key={h.departmentId} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{nameText(kit, h.name)}</span>
                <span className="text-muted-foreground">
                  {t('charts.hiringRow', { week: fmt.day(h.firstWeek!), weeks: h.overWeeks, hours: kit.f.number(Math.round(h.gapHours)) })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-subtle-foreground">{t('charts.hiringNone')}</p>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

export function MarketingTab({ kit, report }: { kit: ExecKit; report: ExecutiveReport }) {
  const { t } = kit;
  const fmt = useFmt(kit);
  const mk = report.marketing;
  const campaignRows = (rows: typeof mk.best) =>
    rows.map((c) => ({
      key: c.id,
      cells: [
        <Link key="n" href={`/campaigns/${c.id}`} className="font-medium hover:underline">
          {c.name}
        </Link>,
        nameText(kit, c.clientName),
        fmt.compact(c.spend),
        fmt.ratio(c.roas),
        fmt.money(c.cpa),
      ],
    }));
  const campaignHead = [
    { label: t('col.campaign') },
    { label: t('col.client') },
    { label: t('col.spend'), numeric: true },
    { label: t('col.roas'), numeric: true },
    { label: t('col.cpa'), numeric: true },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title={t('charts.byPlatform')} className="lg:col-span-2" testId="marketing-by-platform">
        <DataTable
          empty={t('charts.empty')}
          head={[
            { label: t('col.platform') },
            { label: t('col.spend'), numeric: true },
            { label: t('col.conversions'), numeric: true },
            { label: t('col.cpa'), numeric: true },
            { label: t('col.cpl'), numeric: true },
            { label: t('col.roas'), numeric: true },
            { label: t('col.ctr'), numeric: true },
          ]}
          rows={mk.byPlatform.map((p) => ({
            key: p.platform,
            cells: [
              kit.label('platform', p.platform),
              fmt.money(p.spend),
              fmt.num(p.conversions),
              fmt.money(p.cpa),
              fmt.money(p.cpl),
              fmt.ratio(p.roas),
              fmt.pct(p.ctr),
            ],
          }))}
        />
      </Section>
      <Section title={t('charts.spendTrend')}>
        <TrendChart
          title={t('charts.spendTrend')}
          points={mk.trend.map((p) => p.key)}
          series={[{ key: 's', label: t('charts.spend'), color: chart(0), values: mk.trend.map((p) => p.spend) }]}
          formatValue={fmt.compact}
          formatPoint={fmt.month}
          height={200}
        />
      </Section>
      <Section title={t('charts.roasTrend')}>
        <TrendChart
          title={t('charts.roasTrend')}
          points={mk.trend.map((p) => p.key)}
          series={[{ key: 'r', label: t('col.roas'), color: chart(2), values: mk.trend.map((p) => p.roas ?? 0) }]}
          formatValue={fmt.ratio}
          formatPoint={fmt.month}
          height={200}
        />
      </Section>
      <Section title={t('charts.cpaTrend')}>
        <TrendChart
          title={t('charts.cpaTrend')}
          points={mk.trend.map((p) => p.key)}
          series={[{ key: 'c', label: t('col.cpa'), color: chart(4), values: mk.trend.map((p) => p.cpa ?? 0) }]}
          formatValue={fmt.money}
          formatPoint={fmt.month}
          height={200}
        />
      </Section>
      <Section title={t('charts.ctrTrend')}>
        <TrendChart
          title={t('charts.ctrTrend')}
          points={mk.trend.map((p) => p.key)}
          series={[{ key: 'c', label: t('col.ctr'), color: chart(5), values: mk.trend.map((p) => p.ctr ?? 0) }]}
          formatValue={fmt.pct}
          formatPoint={fmt.month}
          height={200}
        />
      </Section>
      <Section title={t('charts.best')}>
        <DataTable empty={t('charts.empty')} head={campaignHead} rows={campaignRows(mk.best)} />
      </Section>
      <Section title={t('charts.worst')}>
        <DataTable empty={t('charts.empty')} head={campaignHead} rows={campaignRows(mk.worst)} />
      </Section>
      <Section title={t('charts.pacing')}>
        {mk.pacing.length ? (
          <ul className="space-y-3 text-sm">
            {mk.pacing.slice(0, 10).map((c) => {
              const spent = c.budgetMinor ? c.spentMinor / c.budgetMinor : 0;
              return (
                <li key={c.id} className="space-y-1">
                  <span className="flex justify-between gap-2">
                    <Link href={`/campaigns/${c.id}`} className="truncate hover:underline">
                      {c.name}
                    </Link>
                    <span className="tabular shrink-0 text-muted-foreground">
                      {fmt.pct(spent)} / {fmt.pct(c.elapsed)}
                    </span>
                  </span>
                  <Progress
                    value={Math.round(spent * 100)}
                    tone={Math.abs(spent - c.elapsed) > 0.2 ? 'warning' : 'brand'}
                    aria-label={c.name}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-subtle-foreground">{t('charts.empty')}</p>
        )}
      </Section>
      <div className="grid gap-4">
        <Section title={t('charts.atRisk')}>
          {mk.atRisk.length ? (
            <ul className="space-y-2 text-sm">
              {mk.atRisk.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <Link href={`/campaigns/${c.id}`} className="truncate hover:underline">
                    {c.name}
                  </Link>
                  <Badge tone={c.health === 'off_track' ? 'danger' : 'warning'}>{kit.label('campaignHealth', c.health)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-subtle-foreground">{t('charts.empty')}</p>
          )}
        </Section>
        <Section title={t('charts.anomalies')}>
          <p className="text-sm">{t('charts.anomaliesBody', mk.insights)}</p>
          <Link href="/insights" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            {t('tile.drill')}
            <DirIcon icon={ArrowUpRight} className="size-3.5" />
          </Link>
        </Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

export function SalesTab({ kit, report }: { kit: ExecKit; report: ExecutiveReport }) {
  const { t } = kit;
  const fmt = useFmt(kit);
  const s = report.sales;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title={t('charts.leadTrend')}>
        <TrendChart
          title={t('charts.leadTrend')}
          points={s.leadTrend.map((p) => p.key)}
          series={[{ key: 'l', label: t('charts.leads'), color: chart(0), values: s.leadTrend.map((p) => p.value) }]}
          formatValue={fmt.num}
          formatPoint={fmt.month}
          height={200}
        />
      </Section>
      <Section title={t('charts.leadsBySource')}>
        <DataTable
          empty={t('charts.empty')}
          head={[{ label: t('col.source') }, { label: t('col.leads'), numeric: true }, { label: t('col.converted'), numeric: true }]}
          rows={s.leadsBySource.map((r) => ({
            key: r.source,
            cells: [kit.label('leadSource', r.source), fmt.num(r.leads), fmt.num(r.converted)],
          }))}
        />
      </Section>
      <Section title={t('charts.funnel')}>
        <DataTable
          empty={t('charts.empty')}
          head={[
            { label: t('col.stage') },
            { label: t('col.reached'), numeric: true },
            { label: t('col.advanced'), numeric: true },
            { label: t('col.rate'), numeric: true },
          ]}
          rows={s.funnel.map((r) => ({
            key: r.stageId,
            cells: [nameText(kit, r.name), fmt.num(r.reached), fmt.num(r.advanced), fmt.pct(r.rate)],
          }))}
        />
      </Section>
      <Section title={t('charts.pipelineByStage')}>
        <BreakdownBars
          title={t('charts.pipelineByStage')}
          rows={s.pipelineByStage.map((r, i) => ({
            key: r.stageId,
            label: nameText(kit, r.name),
            color: chart(i),
            value: r.value,
            hint: kit.f.number(r.count),
          }))}
          formatValue={fmt.compact}
        />
      </Section>
      <Section title={t('charts.forecast')} className="lg:col-span-2">
        <TrendChart
          title={t('charts.forecast')}
          points={s.forecast.map((m) => m.month)}
          series={[
            { key: 'f', label: t('charts.forecastValue'), color: chart(0), values: s.forecast.map((m) => m.forecast) },
            ...(s.forecast.some((m) => m.target !== null)
              ? [{ key: 't', label: t('charts.targetValue'), color: chart(6), values: s.forecast.map((m) => m.target ?? 0) }]
              : []),
          ]}
          formatValue={fmt.compact}
          formatPoint={fmt.month}
          height={200}
        />
      </Section>
      <Section title={t('charts.byOwner')} testId="sales-by-owner">
        <DataTable
          empty={t('charts.empty')}
          head={[
            { label: t('col.salesperson') },
            { label: t('col.won'), numeric: true },
            { label: t('col.lostCount'), numeric: true },
            { label: t('col.winRate'), numeric: true },
            { label: t('col.weighted'), numeric: true },
          ]}
          rows={s.byOwner.map((r) => ({
            key: r.ownerId ?? 'none',
            cells: [
              r.name || '—',
              `${fmt.num(r.wonCount)} · ${fmt.compact(r.wonValue)}`,
              fmt.num(r.lostCount),
              fmt.pct(r.winRate),
              fmt.compact(r.weighted),
            ],
          }))}
        />
      </Section>
      <Section title={t('charts.lostReasons')}>
        {s.lostReasons.length ? (
          <BreakdownBars
            title={t('charts.lostReasons')}
            rows={s.lostReasons.map((r, i) => ({
              key: r.reason,
              label: kit.label('lostReason', r.reason),
              color: chart(i + 3),
              value: r.count,
            }))}
            formatValue={fmt.num}
          />
        ) : (
          <p className="text-sm text-subtle-foreground">{t('charts.empty')}</p>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

export function RiskRow({
  kit,
  item,
  names,
}: {
  kit: ExecKit;
  item: Pick<RiskItem, 'id' | 'severity' | 'reason' | 'params' | 'ownerId' | 'href'> & { category: string };
  names: Record<string, string>;
}) {
  const { t } = kit;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5" data-testid="risk-item">
      <Badge tone={severityTone[item.severity]} dot>
        {t(`severity.${item.severity}`)}
      </Badge>
      <span className="text-xs text-subtle-foreground">{t(`category.${item.category}`)}</span>
      <span className="min-w-0 flex-1 text-sm">{riskText(kit, item)}</span>
      <span className="text-xs text-subtle-foreground">
        {item.ownerId && names[item.ownerId] ? t('attention.owner', { name: names[item.ownerId]! }) : t('attention.noOwner')}
      </span>
      <Link href={item.href} className="inline-flex items-center gap-1 text-xs text-primary hover:underline print:hidden">
        {t('attention.open')}
        <DirIcon icon={ArrowUpRight} className="size-3.5" />
      </Link>
    </li>
  );
}

export function RisksTab({ kit, report }: { kit: ExecKit; report: ExecutiveReport }) {
  const { t } = kit;
  const fmt = useFmt(kit);
  const r = report.risks;
  const hasTrend = r.trend.some((p) => p.high !== null);
  return (
    <div className="grid gap-4">
      <Section title={t('charts.riskRegister')} testId="risk-register">
        {r.items.length ? (
          <ul className="divide-y divide-border">
            {r.items.map((item) => (
              <RiskRow key={item.id} kit={kit} item={item} names={report.names} />
            ))}
          </ul>
        ) : (
          <EmptyState compact icon={AlertTriangle} title={t('attention.empty')} description={t('attention.emptyBody')} />
        )}
      </Section>
      <Section title={t('charts.riskTrend')}>
        {hasTrend ? (
          <TrendChart
            title={t('charts.riskTrend')}
            points={r.trend.map((p) => p.key)}
            series={(['high', 'medium', 'low'] as const).map((sev) => ({
              key: sev,
              label: t(`severity.${sev}`),
              color: sev === 'high' ? 'var(--color-danger)' : sev === 'medium' ? 'var(--color-warning)' : chart(1),
              values: r.trend.map((p) => p[sev] ?? 0),
            }))}
            formatValue={fmt.num}
            formatPoint={fmt.month}
            height={200}
          />
        ) : (
          <p className="text-sm text-subtle-foreground">{t('charts.noTrend')}</p>
        )}
      </Section>
    </div>
  );
}
