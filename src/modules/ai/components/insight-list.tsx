'use client';

import { ChevronRight, Lightbulb } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { DirIcon, EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Badge, Card, NativeSelect } from '@/components/ui/primitives';
import { localized, type LocalizedText } from '@/lib/i18n/localized';
import { InsightStatusBadge, SeverityBadge } from '@/modules/ai/components/badges';
import { useTextKit } from '@/modules/ai/components/use-text-kit';
import { insightTitle } from '@/modules/ai/insight-text';
import { insightKinds, insightSeverities, insightStatuses } from '@/modules/ai/insights-core';
import type { InsightListItem } from '@/modules/ai/server/queries';

/** Rows of insights (the /insights page and the campaign tab). */
export function InsightRows({ items, showCampaign = true }: { items: InsightListItem[]; showCampaign?: boolean }) {
  const t = useTranslations('ai');
  const locale = useLocale();
  const f = useFormat();
  const kit = useTextKit();
  return (
    <ul className="divide-y divide-border">
      {items.map((i) => (
        <li key={i.id} data-testid="insight-row" data-kind={i.kind}>
          <Link
            href={`/insights/${i.id}`}
            className="group flex items-start gap-3 px-4 py-3.5 focus-visible:bg-surface-muted focus-visible:outline-none sm:px-5"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={i.severity} />
                <span className="text-xs text-subtle-foreground">{t(`kind.${i.kind}`)}</span>
              </div>
              <p className="text-sm font-medium group-hover:underline">{insightTitle(kit, i)}</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle-foreground">
                {showCampaign ? (
                  <span className="min-w-0 truncate">
                    <bdi>{i.campaign.name}</bdi> · <bdi>{localized(i.client.name, locale as 'ar' | 'en')}</bdi>
                  </span>
                ) : null}
                <span>{t('insights.detected', { date: f.date(`${i.detectedOn}T12:00:00Z`) })}</span>
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <InsightStatusBadge status={i.status} />
              {i.recommendations > 0 && (i.status === 'open' || i.status === 'acknowledged') ? (
                <Badge tone="accent" data-testid="insight-recs">
                  <Lightbulb aria-hidden />
                  {i.recommendations}
                </Badge>
              ) : null}
            </div>
            <DirIcon icon={ChevronRight} className="mt-1 size-4 shrink-0 text-subtle-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

type Filters = { clientId?: string; severity?: string; kind?: string; status?: string };

export function InsightList({
  items,
  filters,
  clients,
}: {
  items: InsightListItem[];
  filters: Filters;
  clients: { id: string; name: LocalizedText }[];
}) {
  const t = useTranslations('ai');
  const locale = useLocale() as 'ar' | 'en';
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (key: keyof Filters, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}${next.size ? `?${next}` : ''}`);
  };
  const select = (key: keyof Filters, label: string, options: { value: string; label: string }[], all = t('insights.filterAll')) => (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-subtle-foreground">
      {label}
      <NativeSelect value={filters[key] ?? ''} onChange={(e) => set(key, e.target.value)} data-testid={`filter-${key}`}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {select(
          'clientId',
          t('insights.filterClient'),
          clients.map((c) => ({ value: c.id, label: localized(c.name, locale) })),
        )}
        {select(
          'severity',
          t('insights.filterSeverity'),
          insightSeverities.map((s) => ({ value: s, label: t(`severity.${s}`) })),
        )}
        {select(
          'kind',
          t('insights.filterKind'),
          insightKinds.map((k) => ({ value: k, label: t(`kind.${k}`) })),
        )}
        {select(
          'status',
          t('insights.filterStatus'),
          [{ value: 'all', label: t('insights.filterAll') }, ...insightStatuses.map((s) => ({ value: s, label: t(`status.${s}`) }))],
          t('insights.active'),
        )}
      </div>
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={Lightbulb} title={t('insights.empty')} description={t('insights.emptyHint')} />
        ) : (
          <InsightRows items={items} />
        )}
      </Card>
    </div>
  );
}
