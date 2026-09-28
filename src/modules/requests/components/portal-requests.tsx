'use client';

import { ArrowUpRight, ClipboardList, MessageCircleQuestion, MessageSquare, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { DirIcon, EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Card, NativeSelect } from '@/components/ui/primitives';
import { localized, type Locale } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import { ExtraBadge, RequestStatusBadge, TypeIcon } from '@/modules/requests/components/badges';
import { activeStatuses, closedStatuses, type RequestStatus } from '@/modules/requests/constants';
import type { RequestListItem } from '@/modules/requests/server/queries';

const portalTabs = ['open', 'waiting', 'active', 'delivered', 'closed', 'drafts'] as const;
type PortalTab = (typeof portalTabs)[number];

function inTab(status: RequestStatus, tab: PortalTab) {
  switch (tab) {
    case 'open':
      return status !== 'draft' && !closedStatuses.includes(status);
    case 'waiting':
      return status === 'needs_info';
    case 'active':
      return status === 'submitted' || status === 'under_review' || activeStatuses.includes(status);
    case 'delivered':
      return status === 'delivered';
    case 'closed':
      return closedStatuses.includes(status);
    case 'drafts':
      return status === 'draft';
  }
}

export function RequestRow({ r, href }: { r: RequestListItem; href: string }) {
  const t = useTranslations('requests');
  const locale = useLocale() as Locale;
  const f = useFormat();
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
      data-testid="portal-request-row"
    >
      <TypeIcon icon={r.typeIcon} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          <bdi>{r.title || t('untitledDraft')}</bdi>
        </span>
        <span className="block truncate text-xs text-subtle-foreground">
          {r.reference ? (
            <>
              <bdi dir="ltr">{r.reference}</bdi> ·{' '}
            </>
          ) : null}
          {localized(r.typeName, locale)} · {t('updatedWhen', { when: f.relative(r.lastActivityAt) })}
        </span>
      </span>
      {r.unread > 0 ? (
        <Badge tone="danger">
          <MessageSquare />
          {f.number(r.unread)}
        </Badge>
      ) : null}
      <RequestStatusBadge status={r.status} />
      <DirIcon icon={ArrowUpRight} className="hidden size-4 text-subtle-foreground sm:block" />
    </Link>
  );
}

/** A request as a card (portal list): status, type, needs-info question, dates. */
function RequestCard({ r }: { r: RequestListItem }) {
  const t = useTranslations('requests');
  const locale = useLocale() as Locale;
  const f = useFormat();
  const href = r.status === 'draft' ? `/portal/requests/${r.id}/edit` : `/portal/requests/${r.id}`;
  return (
    <Link
      href={href}
      className="group block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      data-testid="portal-request-row"
    >
      <Card className={cn('grid gap-3 p-4 transition-shadow group-hover:shadow-md', r.status === 'needs_info' && 'border-danger/40')}>
        <div className="flex items-start gap-3">
          <TypeIcon icon={r.typeIcon} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">
              <bdi>{r.title || t('untitledDraft')}</bdi>
            </p>
            <p className="truncate text-xs text-subtle-foreground">
              {r.reference ? (
                <>
                  <bdi dir="ltr">{r.reference}</bdi> ·{' '}
                </>
              ) : null}
              {localized(r.typeName, locale)}
            </p>
          </div>
          <RequestStatusBadge status={r.status} />
        </div>
        {r.status === 'needs_info' && r.needsInfoReason ? (
          <p className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm" data-testid="card-needs-info">
            <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            <span dir="auto" className="line-clamp-2">
              {r.needsInfoReason}
            </span>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle-foreground">
          <span>{t('updatedWhen', { when: f.relative(r.lastActivityAt) })}</span>
          {r.dueDate && !closedStatuses.includes(r.status) ? (
            <span>{t('expectedOn', { date: f.date(`${r.dueDate}T12:00:00`, 'medium') })}</span>
          ) : null}
          {r.isExtra ? <ExtraBadge /> : null}
          {r.unread > 0 ? (
            <Badge tone="danger">
              <MessageSquare />
              {f.number(r.unread)}
            </Badge>
          ) : null}
        </div>
      </Card>
    </Link>
  );
}

/** Portal list: status tabs, search, type filter; cards (one column on mobile, two on desktop). */
export function PortalRequestsList({ requests, canCreate }: { requests: RequestListItem[]; canCreate: boolean }) {
  const t = useTranslations('requests');
  const locale = useLocale() as Locale;
  const f = useFormat();
  const [tab, setTab] = useState<PortalTab>(requests.some((r) => r.status === 'needs_info') ? 'waiting' : 'open');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const types = [...new Map(requests.map((r) => [r.typeId, localized(r.typeName, locale)])).entries()];
  const q = query.trim().toLowerCase();
  const list = requests
    .filter((r) => inTab(r.status, tab))
    .filter((r) => !type || r.typeId === type)
    .filter((r) => !q || r.title.toLowerCase().includes(q) || (r.reference ?? '').toLowerCase().includes(q));
  const counts = Object.fromEntries(portalTabs.map((k) => [k, requests.filter((r) => inTab(r.status, k)).length])) as Record<
    PortalTab,
    number
  >;
  const newButton = canCreate ? (
    <Button asChild>
      <Link href="/portal/requests/new" data-testid="new-request">
        <Plus />
        {t('newRequest')}
      </Link>
    </Button>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-72">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('portalSearch')}
            aria-label={t('portalSearch')}
            className="ps-9"
            data-testid="portal-search"
          />
        </div>
        {types.length > 1 ? (
          <div className="w-44">
            <NativeSelect value={type} onChange={(e) => setType(e.target.value)} aria-label={t('type')} data-testid="portal-type-filter">
              <option value="">{t('allTypes')}</option>
              {types.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div className="ms-auto">{newButton}</div>
      </div>
      <nav aria-label={t('views.label')} className="-mx-(--gutter) overflow-x-auto px-(--gutter)">
        <ul className="flex gap-1 border-b border-border" role="tablist">
          {portalTabs
            .filter((k) => k !== 'drafts' || counts.drafts > 0)
            .map((k) => (
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
                  data-testid={`portal-tab-${k}`}
                >
                  {t(`portalTabs.${k}`)}
                  <span
                    className={cn(
                      'tabular rounded-full px-1.5 text-xs',
                      k === 'waiting' && counts.waiting ? 'bg-danger text-white' : 'bg-surface-muted text-muted-foreground',
                    )}
                  >
                    {f.number(counts[k])}
                  </span>
                </button>
              </li>
            ))}
        </ul>
      </nav>
      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={q || type ? Search : ClipboardList}
            title={q || type ? t('portalEmpty.noMatchTitle') : t(`portalEmpty.${tab}.title`)}
            description={
              q || type
                ? t('portalEmpty.noMatchBody')
                : tab === 'open' && !canCreate
                  ? t('portalEmpty.readOnly')
                  : t(`portalEmpty.${tab}.body`)
            }
            action={tab === 'open' && !q && !type ? newButton : null}
          />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="portal-requests">
          {list.map((r) => (
            <li key={r.id} className="min-w-0">
              <RequestCard r={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
