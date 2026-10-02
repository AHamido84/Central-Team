'use client';

import { FileChartColumn } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { useFormat } from '@/components/providers';
import { EmptyState } from '@/components/patterns';
import { Badge, Card } from '@/components/ui/primitives';
import { localized } from '@/lib/i18n/localized';
import type { ReportSummary } from '@/modules/campaigns/server/queries';

export function ReportList({
  reports,
  hrefBase,
  showClient = true,
  showStatus = true,
  emptyLabel,
  emptyBody,
}: {
  reports: ReportSummary[];
  hrefBase: string;
  showClient?: boolean;
  showStatus?: boolean;
  emptyLabel?: string;
  emptyBody?: string;
}) {
  const t = useTranslations('reports');
  const locale = useLocale() as 'ar' | 'en';
  const f = useFormat();
  const noon = (d: string) => `${d}T12:00:00Z`;
  if (reports.length === 0) {
    return (
      <Card>
        <EmptyState compact icon={FileChartColumn} title={emptyLabel ?? t('list.emptyTitle')} description={emptyBody} />
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border" data-testid="report-list">
        {reports.map((r) => (
          <li key={r.id}>
            <Link
              href={`${hrefBase}/${r.id}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-surface-muted/50 focus-visible:bg-surface-muted focus-visible:outline-none"
              data-testid="report-row"
              data-report-id={r.id}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground">
                  <FileChartColumn className="size-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium" dir="auto">
                    {r.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[
                      showClient ? localized(r.clientName, locale) : null,
                      r.campaign?.name ?? null,
                      t('view.period', { start: f.dayMonth(noon(r.periodStart)), end: f.date(noon(r.periodEnd)) }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-2">
                {r.scheduled ? <Badge tone="outline">{t('scheduled')}</Badge> : null}
                {showStatus ? (
                  <Badge tone={r.status === 'published' ? 'success' : 'warning'} dot>
                    {t(`status.${r.status}`)}
                  </Badge>
                ) : null}
                <span className="text-xs text-subtle-foreground">{f.date(r.publishedAt ?? r.updatedAt)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
