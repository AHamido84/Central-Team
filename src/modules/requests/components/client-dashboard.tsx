'use client';

import { AlertTriangle, CalendarRange, CheckCircle2, Hourglass, Inbox, MessageCircleQuestion, PackageOpen, Timer } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { EmptyState, StatCard } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Card, Tooltip } from '@/components/ui/primitives';
import { localized, type Locale } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import { packageItemTypes, type PackageItemType } from '@/modules/clients/constants';
import type { PackageUsage } from '@/modules/clients/server/package-usage';

export type ClientRequestStats = { open: number; waiting: number; deliveredThisMonth: number; avgTurnaroundDays: number | null };

/** Portal dashboard headline numbers. */
export function ClientRequestStatsRow({ stats }: { stats: ClientRequestStats }) {
  const t = useTranslations('requests.dashboard');
  const f = useFormat();
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="client-stats">
      <StatCard label={t('open')} value={f.number(stats.open)} icon={Inbox} />
      <StatCard
        label={t('waiting')}
        value={f.number(stats.waiting)}
        icon={MessageCircleQuestion}
        className={cn(stats.waiting > 0 && 'border-danger/40')}
        footer={stats.waiting > 0 ? t('waitingHint') : undefined}
      />
      <StatCard label={t('delivered')} value={f.number(stats.deliveredThisMonth)} icon={CheckCircle2} />
      <StatCard
        label={t('turnaround')}
        value={stats.avgTurnaroundDays === null ? '—' : t('days', { count: f.number(Math.round(stats.avgTurnaroundDays * 10) / 10) })}
        icon={Timer}
        footer={t('turnaroundHint')}
      />
    </div>
  );
}

/**
 * Package usage per item type for the current period: one horizontal bar per item on a shared scale, the
 * allowance as a marker, direct "used / allowed" labels, hover details, and a table for screen readers.
 * Single series → no legend; over-allowance uses the warning status with an icon, never color alone.
 */
export function PackageUsageChart({ usage }: { usage: PackageUsage | null }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  if (!usage) {
    return (
      <Card>
        <EmptyState compact icon={PackageOpen} title={t('clients.noPackage')} description={t('clients.noPackageBody')} />
      </Card>
    );
  }
  const label = (type: string) =>
    (packageItemTypes as readonly string[]).includes(type) ? t(`clients.itemTypes.${type as PackageItemType}`) : type;
  const max = Math.max(1, ...usage.items.map((i) => Math.max(i.allowed, i.used)));
  return (
    <Card className="p-5" data-testid="package-chart">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-subtle-foreground">{t('clients.currentPackage')}</p>
          <p className="mt-0.5 font-semibold">{localized(usage.packageName, locale)}</p>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarRange className="size-3.5" aria-hidden />
          {t('clients.period', { start: f.date(usage.periodStart), end: f.date(usage.periodEnd) })}
        </p>
      </div>
      <ul className="mt-5 grid gap-3.5" aria-hidden>
        {usage.items.map((item) => {
          const over = item.used > item.allowed;
          const usedPct = (Math.min(item.used, item.allowed) / max) * 100;
          const overPct = over ? ((item.used - item.allowed) / max) * 100 : 0;
          const allowedPct = (item.allowed / max) * 100;
          return (
            <li
              key={item.itemType}
              className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto]"
            >
              <span className="truncate text-sm">{label(item.itemType)}</span>
              <Tooltip
                content={t('requests.dashboard.barTooltip', {
                  item: label(item.itemType),
                  used: f.number(item.used),
                  allowed: f.number(item.allowed),
                  left: f.number(Math.max(item.allowed - item.used, 0)),
                })}
              >
                <span
                  className="relative block h-3 rounded-full bg-surface-muted"
                  data-testid="package-bar"
                  data-item={item.itemType}
                  data-used={item.used}
                >
                  {/* Allowance track (recessive) */}
                  <span className="absolute inset-y-0 start-0 rounded-full bg-primary/15" style={{ width: `${allowedPct}%` }} />
                  {/* Used within allowance */}
                  {usedPct > 0 ? (
                    <span className="absolute inset-y-0 start-0 rounded-full bg-primary" style={{ width: `${usedPct}%` }} />
                  ) : null}
                  {/* Over allowance, separated by a 2px surface gap */}
                  {over ? (
                    <span
                      className="absolute inset-y-0 rounded-e-full bg-warning ring-2 ring-surface"
                      style={{ insetInlineStart: `calc(${allowedPct}% + 2px)`, width: `calc(${overPct}% - 2px)` }}
                    />
                  ) : null}
                </span>
              </Tooltip>
              <span className="tabular flex items-center gap-1 text-xs text-muted-foreground">
                {over ? <AlertTriangle className="size-3.5 text-warning" aria-hidden /> : null}
                {t('clients.usedOf', { used: f.number(item.used), allowed: f.number(item.allowed) })}
              </span>
            </li>
          );
        })}
      </ul>
      <table className="sr-only">
        <caption>{t('requests.dashboard.packageUsage')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('clients.itemType')}</th>
            <th scope="col">{t('requests.dashboard.used')}</th>
            <th scope="col">{t('requests.dashboard.allowed')}</th>
          </tr>
        </thead>
        <tbody>
          {usage.items.map((item) => (
            <tr key={item.itemType}>
              <th scope="row">{label(item.itemType)}</th>
              <td>{item.used}</td>
              <td>{item.allowed}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-subtle-foreground">
        <Hourglass className="size-3.5" aria-hidden />
        {t('requests.dashboard.usageNote')}
      </p>
    </Card>
  );
}
