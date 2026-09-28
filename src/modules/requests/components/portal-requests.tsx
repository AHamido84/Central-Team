'use client';

import { ArrowUpRight, ClipboardList, MessageSquare, Plus } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { DirIcon, EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/primitives';
import { localized, type Locale } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import { FormIcon, RequestStatusBadge } from '@/modules/requests/components/badges';
import { closedStatuses, formatRequestNumber, openStatuses } from '@/modules/requests/constants';
import type { PublishedForm, RequestListItem } from '@/modules/requests/server/queries';

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
      <FormIcon icon={r.formIcon} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          <bdi>{r.title}</bdi>
        </span>
        <span className="block truncate text-xs text-subtle-foreground">
          <span dir="ltr">{formatRequestNumber(r.number)}</span> · {localized(r.formName, locale)} ·{' '}
          {t('updatedWhen', { when: f.relative(r.lastActivityAt) })}
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

/** Portal list: active vs closed, "waiting for you" first. */
export function PortalRequestsList({ requests, canCreate }: { requests: RequestListItem[]; canCreate: boolean }) {
  const t = useTranslations('requests');
  const f = useFormat();
  const [tab, setTab] = useState<'active' | 'closed'>('active');
  const active = requests
    .filter((r) => openStatuses.includes(r.status))
    .sort(
      (a, b) =>
        Number(b.status === 'waiting_client') - Number(a.status === 'waiting_client') || b.lastActivityAt.localeCompare(a.lastActivityAt),
    );
  const closed = requests.filter((r) => closedStatuses.includes(r.status));
  const list = tab === 'active' ? active : closed;
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
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5" role="tablist" aria-label={t('views.label')}>
          {(['active', 'closed'] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                tab === key ? 'bg-primary-soft text-primary-soft-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
              data-testid={`portal-tab-${key}`}
            >
              {t(`portalTabs.${key}`)}{' '}
              <span className="tabular text-xs">({f.number(key === 'active' ? active.length : closed.length)})</span>
            </button>
          ))}
        </div>
        <div className="ms-auto">{newButton}</div>
      </div>
      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={tab === 'active' ? t('portalEmpty.activeTitle') : t('portalEmpty.closedTitle')}
            description={
              tab === 'active'
                ? canCreate
                  ? t('portalEmpty.activeBody')
                  : t('portalEmpty.activeBodyReadOnly')
                : t('portalEmpty.closedBody')
            }
            action={tab === 'active' ? newButton : null}
          />
        ) : (
          <ul className="divide-y divide-border" data-testid="portal-requests">
            {list.map((r) => (
              <li key={r.id}>
                <RequestRow r={r} href={`/portal/requests/${r.id}`} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Form picker for a new request. */
export function FormPicker({ forms }: { forms: PublishedForm[] }) {
  const t = useTranslations('requests');
  const locale = useLocale() as Locale;
  if (forms.length === 0) {
    return (
      <Card>
        <EmptyState icon={ClipboardList} title={t('noFormsTitle')} description={t('noFormsBody')} />
      </Card>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="form-picker">
      {forms.map((form) => (
        <li key={form.id}>
          <Link href={`/portal/requests/new/${form.id}`} className="group block h-full" data-testid="form-option">
            <Card className="flex h-full items-start gap-3 p-4 transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-ring">
              <FormIcon icon={form.icon} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{localized(form.name, locale)}</span>
                {localized(form.description, locale) ? (
                  <span className="mt-0.5 block text-sm text-muted-foreground">{localized(form.description, locale)}</span>
                ) : null}
                {form.responseSlaHours ? (
                  <span className="mt-2 block text-xs text-subtle-foreground">{t('responseTime', { hours: form.responseSlaHours })}</span>
                ) : null}
              </span>
              <DirIcon icon={ArrowUpRight} className="size-4 text-subtle-foreground" />
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
