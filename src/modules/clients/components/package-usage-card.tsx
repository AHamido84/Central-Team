'use client';

import { CalendarRange, PackageOpen } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Badge, Card, Progress } from '@/components/ui/primitives';
import { localized, type Locale } from '@/lib/i18n/localized';
import { packageItemTypes, type PackageItemType } from '@/modules/clients/constants';
import type { PackageUsage } from '@/modules/clients/server/package-usage';

/** Package summary for the current period: one progress bar per deliverable type (portal + agency). */
export function PackageUsageCard({
  usage,
  action,
  emptyAction,
  compact,
}: {
  usage: PackageUsage | null;
  action?: ReactNode;
  emptyAction?: ReactNode;
  compact?: boolean;
}) {
  const t = useTranslations('clients');
  const locale = useLocale() as Locale;
  const f = useFormat();
  if (!usage) {
    return (
      <Card>
        <EmptyState compact icon={PackageOpen} title={t('noPackage')} description={t('noPackageBody')} action={emptyAction} />
      </Card>
    );
  }
  const label = (type: string) =>
    (packageItemTypes as readonly string[]).includes(type) ? t(`itemTypes.${type as PackageItemType}`) : type;
  const pace = usage.totals.ratio - usage.elapsed;
  return (
    <Card className="p-5" data-testid="package-usage">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-subtle-foreground">{t('currentPackage')}</p>
          <p className="mt-0.5 text-h3 font-semibold">{localized(usage.packageName, locale)}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarRange className="size-3.5" aria-hidden />
            {t('period', { start: f.date(usage.periodStart), end: f.date(usage.periodEnd) })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={pace >= -0.1 ? 'success' : 'warning'}>{t('delivered', { percent: f.percent(usage.totals.ratio) })}</Badge>
          {action}
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex justify-between text-xs text-subtle-foreground">
          <span>{t('periodProgress')}</span>
          <span className="tabular">{f.percent(usage.elapsed)}</span>
        </div>
        <Progress value={usage.elapsed * 100} className="h-1.5" tone="brand" />
      </div>
      <ul className={compact ? 'mt-5 grid gap-3 sm:grid-cols-2' : 'mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3'}>
        {usage.items.map((item) => (
          <li key={item.itemType}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{label(item.itemType)}</span>
              <span className="tabular text-muted-foreground">
                {t('usedOf', { used: f.number(item.used), allowed: f.number(item.allowed) })}
              </span>
            </div>
            <Progress value={item.ratio * 100} tone={item.used > item.allowed ? 'danger' : item.ratio >= 1 ? 'success' : 'brand'} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
