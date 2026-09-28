'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { AlarmClock, ClipboardList, Inbox, MessageSquare, UserRoundX } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { EmptyState, StatCard } from '@/components/patterns';
import { DataTable } from '@/components/patterns/data-table';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { FormIcon, PriorityBadge, RequestStatusBadge, SlaBadge } from '@/modules/requests/components/badges';
import {
  closedStatuses,
  formatRequestNumber,
  inboxViews,
  openStatuses,
  requestPriorities,
  requestStatuses,
  slaState,
  type InboxView,
  type RequestPriority,
} from '@/modules/requests/constants';
import { triageRequestsAction } from '@/modules/requests/server/actions';
import type { RequestListItem } from '@/modules/requests/server/queries';

const priorityRank: Record<RequestPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function inView(r: RequestListItem, view: InboxView, me: string) {
  switch (view) {
    case 'open':
      return openStatuses.includes(r.status);
    case 'mine':
      return openStatuses.includes(r.status) && r.assignee?.id === me;
    case 'unassigned':
      return openStatuses.includes(r.status) && !r.assignee;
    case 'closed':
      return closedStatuses.includes(r.status);
    case 'all':
      return true;
  }
}

/** Agency triage inbox: headline stats, saved views, filters, bulk assign/prioritize and SLA state per row. */
export function RequestsInbox({
  requests,
  me,
  people,
  canTriage,
  showClient = true,
  initialView = 'open',
  basePath = '/requests',
}: {
  requests: RequestListItem[];
  me: string;
  people: { id: string; name: string; avatarPath: string | null }[];
  canTriage: boolean;
  showClient?: boolean;
  initialView?: InboxView;
  basePath?: string;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const router = useRouter();
  const [view, setView] = useState<InboxView>(initialView);
  const triage = useAction(triageRequestsAction, { successMessage: t('requests.saved') });

  const open = requests.filter((r) => openStatuses.includes(r.status));
  const stats = {
    open: open.length,
    unassigned: open.filter((r) => !r.assignee).length,
    overdue: open.filter((r) => slaState(r).state === 'breached').length,
    atRisk: open.filter((r) => slaState(r).state === 'at_risk').length,
  };
  const counts = Object.fromEntries(inboxViews.map((v) => [v, requests.filter((r) => inView(r, v, me)).length])) as Record<
    InboxView,
    number
  >;
  const rows = useMemo(
    () =>
      requests
        .filter((r) => inView(r, view, me))
        .sort((a, b) =>
          view === 'closed' || view === 'all'
            ? b.lastActivityAt.localeCompare(a.lastActivityAt)
            : priorityRank[a.priority] - priorityRank[b.priority] || a.createdAt.localeCompare(b.createdAt),
        ),
    [requests, view, me],
  );

  const clients = [...new Map(requests.map((r) => [r.clientId, localized(r.clientName, locale)])).entries()];
  const forms = [...new Map(requests.map((r) => [r.formId, localized(r.formName, locale)])).entries()];
  const assignees = [...new Map(requests.filter((r) => r.assignee).map((r) => [r.assignee!.id, r.assignee!.name])).entries()];

  const columns = useMemo<ColumnDef<RequestListItem, unknown>[]>(
    () => [
      {
        id: 'title',
        header: t('requests.request'),
        accessorFn: (r) => r.title,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex min-w-64 items-center gap-3">
              <FormIcon icon={r.formIcon} size="sm" />
              <div className="min-w-0">
                <Link
                  href={`${basePath}/${r.id}`}
                  className="block truncate font-medium hover:underline"
                  onClick={(e) => e.stopPropagation()}
                  data-testid="request-link"
                >
                  <bdi>{r.title}</bdi>
                </Link>
                <p className="flex items-center gap-1.5 truncate text-xs text-subtle-foreground">
                  <span className="tabular" dir="ltr">
                    {formatRequestNumber(r.number)}
                  </span>
                  {r.unread > 0 ? (
                    <Badge tone="danger" className="ms-1">
                      <MessageSquare />
                      {f.number(r.unread)}
                    </Badge>
                  ) : null}
                </p>
              </div>
            </div>
          );
        },
      },
      ...(showClient
        ? [
            {
              id: 'client',
              header: t('clients.client'),
              accessorFn: (r: RequestListItem) => r.clientId,
              cell: ({ row }: { row: { original: RequestListItem } }) => (
                <span className="flex items-center gap-2">
                  <Avatar
                    name={localized(row.original.clientName, locale)}
                    src={publicAssetUrl(row.original.clientLogo)}
                    size="xs"
                    square
                  />
                  <span className="truncate">{localized(row.original.clientName, locale)}</span>
                </span>
              ),
            } satisfies ColumnDef<RequestListItem, unknown>,
          ]
        : []),
      {
        id: 'status',
        header: t('common.status'),
        accessorFn: (r) => r.status,
        cell: ({ row }) => <RequestStatusBadge status={row.original.status} />,
      },
      {
        id: 'priority',
        header: t('requests.priority'),
        accessorFn: (r) => r.priority,
        sortingFn: (a, b) => priorityRank[a.original.priority] - priorityRank[b.original.priority],
        cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
      },
      {
        id: 'assignee',
        header: t('requests.assignee'),
        accessorFn: (r) => r.assignee?.id ?? '',
        cell: ({ row }) =>
          row.original.assignee ? (
            <span className="flex items-center gap-2">
              <Avatar name={row.original.assignee.name} src={publicAssetUrl(row.original.assignee.avatarPath)} size="xs" />
              <span className="truncate">{row.original.assignee.name}</span>
            </span>
          ) : (
            <span className="text-subtle-foreground">{t('requests.unassigned')}</span>
          ),
      },
      {
        id: 'form',
        header: t('requests.form'),
        accessorFn: (r) => r.formId,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{localized(row.original.formName, locale)}</span>,
      },
      {
        id: 'sla',
        header: t('requests.sla.title'),
        accessorFn: (r) => slaState(r).dueAt ?? '',
        cell: ({ row }) => <SlaBadge request={row.original} />,
      },
      {
        id: 'activity',
        header: t('requests.lastActivity'),
        accessorFn: (r) => r.lastActivityAt,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{f.relative(row.original.lastActivityAt)}</span>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, showClient, basePath],
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="request-stats">
        <StatCard label={t('requests.stats.open')} value={f.number(stats.open)} icon={Inbox} />
        <StatCard label={t('requests.stats.unassigned')} value={f.number(stats.unassigned)} icon={UserRoundX} />
        <StatCard
          label={t('requests.stats.overdue')}
          value={f.number(stats.overdue)}
          icon={AlarmClock}
          className={cn(stats.overdue > 0 && 'border-danger/40')}
        />
        <StatCard label={t('requests.stats.atRisk')} value={f.number(stats.atRisk)} icon={AlarmClock} />
      </div>

      <nav aria-label={t('requests.views.label')} className="-mx-(--gutter) overflow-x-auto px-(--gutter)">
        <ul className="flex gap-1 border-b border-border" role="tablist">
          {inboxViews.map((v) => (
            <li key={v}>
              <button
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn(
                  '-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap',
                  view === v ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
                data-testid={`inbox-view-${v}`}
              >
                {t(`requests.views.${v}`)}
                <span className="tabular rounded-full bg-surface-muted px-1.5 text-xs text-muted-foreground">{f.number(counts[v])}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <DataTable
        key={view}
        testId="requests-table"
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => router.push(`${basePath}/${r.id}`)}
        searchFn={(r, q) =>
          r.title.toLowerCase().includes(q) ||
          formatRequestNumber(r.number).toLowerCase().includes(q) ||
          String(r.number) === q ||
          localized(r.clientName, locale).toLowerCase().includes(q)
        }
        searchPlaceholder={t('requests.searchPlaceholder')}
        filters={[
          ...(view === 'open' || view === 'all'
            ? [
                {
                  id: 'status',
                  label: t('common.status'),
                  options: requestStatuses
                    .filter((s) => view === 'all' || openStatuses.includes(s))
                    .map((s) => ({ value: s, label: t(`requests.statuses.${s}`) })),
                },
              ]
            : []),
          {
            id: 'priority',
            label: t('requests.priority'),
            options: requestPriorities.map((p) => ({ value: p, label: t(`requests.priorities.${p}`) })),
          },
          ...(showClient
            ? [{ id: 'client', label: t('clients.client'), options: clients.map(([value, label]) => ({ value, label })) }]
            : []),
          ...(view !== 'unassigned' && view !== 'mine'
            ? [{ id: 'assignee', label: t('requests.assignee'), options: assignees.map(([value, label]) => ({ value, label })) }]
            : []),
          { id: 'form', label: t('requests.form'), options: forms.map(([value, label]) => ({ value, label })) },
        ]}
        bulkActions={
          canTriage
            ? (selected, clear) => (
                <>
                  <NativeSelect
                    aria-label={t('requests.bulkAssign')}
                    className="h-8 min-w-40 sm:h-8"
                    value=""
                    disabled={triage.pending}
                    onChange={async (e) => {
                      const v = e.target.value;
                      if (!v) return;
                      const res = await triage.run({ requestIds: selected.map((r) => r.id), assigneeId: v === '__none' ? null : v });
                      if (res.ok) clear();
                    }}
                    data-testid="bulk-assign"
                  >
                    <option value="">{t('requests.bulkAssign')}</option>
                    <option value="__none">{t('requests.unassigned')}</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    aria-label={t('requests.bulkPriority')}
                    className="h-8 min-w-36 sm:h-8"
                    value=""
                    disabled={triage.pending}
                    onChange={async (e) => {
                      const v = e.target.value as RequestPriority | '';
                      if (!v) return;
                      const res = await triage.run({ requestIds: selected.map((r) => r.id), priority: v });
                      if (res.ok) clear();
                    }}
                    data-testid="bulk-priority"
                  >
                    <option value="">{t('requests.bulkPriority')}</option>
                    {requestPriorities.map((p) => (
                      <option key={p} value={p}>
                        {t(`requests.priorities.${p}`)}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button variant="ghost" size="sm" onClick={clear}>
                    {t('common.cancel')}
                  </Button>
                </>
              )
            : undefined
        }
        emptyState={
          <EmptyState
            icon={view === 'mine' ? ClipboardList : Inbox}
            title={t(`requests.empty.${view}.title`)}
            description={t(`requests.empty.${view}.body`)}
          />
        }
        mobileCard={(r) => (
          <div className="flex items-start gap-3 px-4 py-3">
            <FormIcon icon={r.formIcon} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                <bdi>{r.title}</bdi>
              </p>
              <p className="truncate text-xs text-subtle-foreground">
                <span dir="ltr">{formatRequestNumber(r.number)}</span>
                {showClient ? ` · ${localized(r.clientName, locale)}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <RequestStatusBadge status={r.status} />
                <PriorityBadge priority={r.priority} />
                <SlaBadge request={r} />
              </div>
            </div>
            {r.assignee ? <Avatar name={r.assignee.name} src={publicAssetUrl(r.assignee.avatarPath)} size="sm" /> : null}
          </div>
        )}
      />
    </div>
  );
}
