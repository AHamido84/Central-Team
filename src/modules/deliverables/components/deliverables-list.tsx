'use client';

import { CheckCheck, FileBox } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Card } from '@/components/ui/primitives';
import { localized, type Locale } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import { ClientDeliverableBadge, DeliverableStatusBadge, deliverableTypeIcon } from '@/modules/deliverables/components/badges';
import { clientState, type DeliverableStatus } from '@/modules/deliverables/constants';
import type { DeliverableSummary } from '@/modules/deliverables/server/queries';

export function DeliverableCard({ d, href, side }: { d: DeliverableSummary; href: string; side: 'agency' | 'client' }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const Icon = deliverableTypeIcon[d.type];
  const awaiting = side === 'client' && d.status === 'client_review';
  return (
    <Link
      href={href}
      className="group block h-full rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      data-testid="deliverable-card"
      data-status={d.status}
    >
      <Card
        className={cn(
          'flex h-full flex-col overflow-hidden transition-shadow group-hover:shadow-md',
          awaiting && 'border-primary/50 ring-1 ring-primary/30',
        )}
      >
        <div className="relative grid aspect-[4/3] place-items-center overflow-hidden bg-surface-muted">
          {d.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
            <img src={d.thumbUrl} alt="" className="size-full object-cover transition-transform group-hover:scale-[1.02]" />
          ) : (
            <Icon className="size-10 text-subtle-foreground" aria-hidden />
          )}
          <span className="absolute start-2 top-2">
            {side === 'agency' ? <DeliverableStatusBadge status={d.status} compact /> : <ClientDeliverableBadge status={d.status} />}
          </span>
        </div>
        <div className="grid flex-1 content-start gap-1 p-3">
          <p className="line-clamp-2 text-sm font-semibold">
            <bdi>{d.title}</bdi>
          </p>
          <p className="truncate text-xs text-subtle-foreground">
            {t(`workflows.deliverableTypes.${d.type}`)}
            {side === 'agency' ? ` · ${localized(d.clientName, locale)}` : ''}
            {d.requestReference ? (
              <>
                {' · '}
                <bdi dir="ltr">{d.requestReference}</bdi>
              </>
            ) : null}
          </p>
          <p className="mt-auto pt-1 text-xs text-muted-foreground">
            {d.versionCount ? t('deliverables.versionN', { n: d.current?.number ?? d.versionCount }) : t('deliverables.noVersions')} ·{' '}
            {f.relative(d.updatedAt)}
          </p>
        </div>
      </Card>
    </Link>
  );
}

const agencyTabs = {
  review: ['internal_review'],
  client: ['client_review'],
  changes: ['internal_changes', 'client_changes'],
  progress: ['in_progress'],
  approved: ['approved'],
} as const;
const clientTabs = ['awaiting', 'revising', 'approved'] as const;

/** Agency deliverables board (by review stage) or the client's approvals center (awaiting / in revision / approved). */
export function DeliverablesList({ deliverables, side }: { deliverables: DeliverableSummary[]; side: 'agency' | 'client' }) {
  const t = useTranslations('deliverables');
  const f = useFormat();
  const tabs = side === 'agency' ? (Object.keys(agencyTabs) as (keyof typeof agencyTabs)[]) : [...clientTabs];
  const inTab = (d: DeliverableSummary, tab: string) =>
    side === 'agency'
      ? (agencyTabs[tab as keyof typeof agencyTabs] as readonly DeliverableStatus[]).includes(d.status)
      : clientState(d.status) === tab;
  const firstWithItems = tabs.find((k) => deliverables.some((d) => inTab(d, k))) ?? tabs[0]!;
  const [tab, setTab] = useState<string>(firstWithItems);
  const list = deliverables.filter((d) => inTab(d, tab));
  return (
    <div className="grid gap-4">
      <nav aria-label={t('tabsLabel')} className="-mx-(--gutter) overflow-x-auto px-(--gutter)">
        <ul className="flex gap-1 border-b border-border" role="tablist">
          {tabs.map((k) => {
            const count = deliverables.filter((d) => inTab(d, k)).length;
            return (
              <li key={k}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={cn(
                    '-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap',
                    tab === k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                  data-testid={`deliverables-tab-${k}`}
                >
                  {t(`listTabs.${k as 'review'}`)}
                  <span
                    className={cn(
                      'tabular rounded-full px-1.5 text-xs',
                      k === 'awaiting' && count ? 'bg-primary text-primary-foreground' : 'bg-surface-muted text-muted-foreground',
                    )}
                  >
                    {f.number(count)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={side === 'client' ? CheckCheck : FileBox}
            title={t(`listEmpty.${tab as 'review'}.title`)}
            description={t(`listEmpty.${tab as 'review'}.body`)}
          />
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="deliverables-list">
          {list.map((d) => (
            <li key={d.id} className="min-w-0">
              <DeliverableCard d={d} side={side} href={side === 'agency' ? `/deliverables/${d.id}` : `/portal/approvals/${d.id}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
