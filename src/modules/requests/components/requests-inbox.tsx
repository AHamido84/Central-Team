'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { AlarmClock, ArrowUpRight, ClipboardList, Hourglass, Inbox, MessageSquare, UserRoundX } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { DirIcon, EmptyState, SectionTitle, StatCard } from '@/components/patterns';
import { DataTable } from '@/components/patterns/data-table';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/overlays';
import { Avatar, Badge, NativeSelect, Skeleton } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { ExtraBadge, PriorityBadge, RequestStatusBadge, SlaBadge, TypeIcon } from '@/modules/requests/components/badges';
import { BriefView } from '@/modules/requests/components/brief-fields';
import { agencyAllowed, StatusActionButtons } from '@/modules/requests/components/request-detail';
import {
  inboxViews,
  inInboxView,
  openStatuses,
  requestPriorities,
  requestStatuses,
  slaState,
  type InboxView,
  type RequestPriority,
} from '@/modules/requests/constants';
import { previewRequestAction, triageRequestsAction } from '@/modules/requests/server/actions';
import type { RequestDetail, RequestListItem } from '@/modules/requests/server/queries';
import { ConvertToTasksButton } from '@/modules/workflows/components/convert-dialog';
import { convertTemplatesAction } from '@/modules/workflows/server/actions';
import type { TemplateDetail } from '@/modules/workflows/server/queries';

export type ConvertOptions = { today: string; canManageWorkflows: boolean };

const priorityRank: Record<RequestPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const slaRank = { overdue: 0, at_risk: 1, on_track: 2, missed: 3, met: 4, none: 5 } as const;

function PreviewDrawer({
  request,
  onOpenChange,
  me,
  canTriage,
  convert,
}: {
  request: RequestListItem | null;
  onOpenChange: (open: boolean) => void;
  me: string;
  canTriage: boolean;
  convert?: ConvertOptions;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const requestId = request?.id;
  useEffect(() => {
    if (!requestId) return;
    let cancelled = false;
    void previewRequestAction({ requestId }).then((res) => {
      if (!cancelled && res.ok) setDetail(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [requestId]);
  const current = detail && detail.id === request?.id ? detail : null;
  const convertible = Boolean(
    convert && request && !request.convertedAt && ['submitted', 'under_review', 'accepted'].includes(request.status),
  );
  const [templates, setTemplates] = useState<{ typeId: string; list: TemplateDetail[] } | null>(null);
  const typeId = request?.typeId;
  useEffect(() => {
    if (!convertible || !typeId) return;
    let cancelled = false;
    void convertTemplatesAction({ requestTypeId: typeId }).then((res) => {
      if (!cancelled && res.ok) setTemplates({ typeId, list: res.data });
    });
    return () => {
      cancelled = true;
    };
  }, [convertible, typeId]);
  return (
    <Sheet open={Boolean(request)} onOpenChange={onOpenChange}>
      <SheetContent closeLabel={t('common.close')} className="w-[min(96vw,34rem)]" data-testid="request-preview">
        {request ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-border p-5 pe-12">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <span dir="ltr" className="tabular">
                  {request.reference}
                </span>
                · {localized(request.clientName, locale)}
              </p>
              <SheetTitle className="mt-1 text-lg">
                <bdi>{request.title}</bdi>
              </SheetTitle>
              <SheetDescription className="mt-2 flex flex-wrap items-center gap-1.5">
                <RequestStatusBadge status={request.status} />
                <PriorityBadge priority={request.priority} />
                <SlaBadge request={request} />
                {request.isExtra ? <ExtraBadge /> : null}
              </SheetDescription>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">{t('requests.submittedBy')}</dt>
                  <dd className="truncate">{request.author?.name ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('requests.submittedAt')}</dt>
                  <dd>{request.submittedAt ? f.relative(request.submittedAt) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('requests.fields.desiredDate')}</dt>
                  <dd>{request.desiredDate ? f.date(`${request.desiredDate}T12:00:00`, 'medium') : '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('requests.assignee')}</dt>
                  <dd className="truncate">{request.assignee?.name ?? t('requests.unassigned')}</dd>
                </div>
              </dl>
              <section>
                <SectionTitle title={t('requests.brief')} />
                {current ? (
                  <BriefView fields={current.fields} brief={current.brief} files={current.attachments} />
                ) : (
                  <div className="grid gap-3">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                )}
              </section>
            </div>
            <div className="grid gap-3 border-t border-border p-4">
              <StatusActionButtons
                request={request}
                side="agency"
                allowed={agencyAllowed(request.status, canTriage, request.assigneeId === me)}
              />
              {convertible && convert && templates?.typeId === request.typeId ? (
                <ConvertToTasksButton
                  requestId={request.id}
                  templates={templates.list}
                  today={convert.today}
                  canManageWorkflows={convert.canManageWorkflows}
                />
              ) : null}
              <Button asChild variant="ghost" size="sm" className="justify-self-start">
                <Link href={`/requests/${request.id}`} data-testid="open-request">
                  {t('requests.openFull')}
                  <DirIcon icon={ArrowUpRight} />
                </Link>
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Agency triage inbox: stats, views, filters, sort by age / SLA / priority, preview drawer, bulk triage. */
export function RequestsInbox({
  requests,
  me,
  people,
  canTriage,
  showClient = true,
  initialView = 'new',
  convert,
}: {
  requests: RequestListItem[];
  me: string;
  people: { id: string; name: string; avatarPath: string | null }[];
  canTriage: boolean;
  showClient?: boolean;
  initialView?: InboxView;
  /** "Convert to tasks" in the preview drawer (when tasks are enabled and allowed). */
  convert?: ConvertOptions;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const [view, setView] = useState<InboxView>(initialView);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const triage = useAction(triageRequestsAction, { successMessage: t('requests.saved') });

  const open = requests.filter((r) => openStatuses.includes(r.status));
  const stats = {
    new: requests.filter((r) => r.status === 'submitted').length,
    unassigned: open.filter((r) => !r.assigneeId).length,
    overdue: open.filter((r) => slaState(r) === 'overdue').length,
    atRisk: open.filter((r) => slaState(r) === 'at_risk').length,
  };
  const counts = Object.fromEntries(inboxViews.map((v) => [v, requests.filter((r) => inInboxView(r, v, me)).length])) as Record<
    InboxView,
    number
  >;
  // Default order: most urgent SLA first, then priority, then oldest.
  const rows = useMemo(
    () =>
      requests
        .filter((r) => inInboxView(r, view, me))
        .sort((a, b) =>
          view === 'closed' || view === 'all'
            ? b.lastActivityAt.localeCompare(a.lastActivityAt)
            : slaRank[slaState(a)] - slaRank[slaState(b)] ||
              priorityRank[a.priority] - priorityRank[b.priority] ||
              (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''),
        ),
    [requests, view, me],
  );
  const preview = requests.find((r) => r.id === previewId) ?? null;

  const clients = [...new Map(requests.map((r) => [r.clientId, localized(r.clientName, locale)])).entries()];
  const types = [...new Map(requests.map((r) => [r.typeId, localized(r.typeName, locale)])).entries()];
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
              <TypeIcon icon={r.typeIcon} size="sm" />
              <div className="min-w-0">
                <Link
                  href={`/requests/${r.id}`}
                  className="block truncate font-medium hover:underline"
                  onClick={(e) => e.stopPropagation()}
                  data-testid="request-link"
                >
                  <bdi>{r.title}</bdi>
                </Link>
                <p className="flex items-center gap-1.5 truncate text-xs text-subtle-foreground">
                  <span className="tabular" dir="ltr">
                    {r.reference}
                  </span>
                  {r.isExtra ? <ExtraBadge /> : null}
                  {r.unread > 0 ? (
                    <Badge tone="danger">
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
        id: 'sla',
        header: t('requests.sla.title'),
        accessorFn: (r) => r.dueDate ?? '9999',
        cell: ({ row }) => <SlaBadge request={row.original} />,
      },
      {
        id: 'age',
        header: t('requests.age'),
        accessorFn: (r) => r.submittedAt ?? '',
        sortingFn: (a, b) => (a.original.submittedAt ?? '').localeCompare(b.original.submittedAt ?? ''),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-muted-foreground">
            {row.original.submittedAt ? f.relative(row.original.submittedAt) : '—'}
          </span>
        ),
      },
      {
        id: 'assignee',
        header: t('requests.assignee'),
        accessorFn: (r) => r.assigneeId ?? '',
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
        id: 'type',
        header: t('requests.type'),
        accessorFn: (r) => r.typeId,
        cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{localized(row.original.typeName, locale)}</span>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, showClient],
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="request-stats">
        <StatCard label={t('requests.stats.new')} value={f.number(stats.new)} icon={Inbox} />
        <StatCard label={t('requests.stats.unassigned')} value={f.number(stats.unassigned)} icon={UserRoundX} />
        <StatCard
          label={t('requests.stats.overdue')}
          value={f.number(stats.overdue)}
          icon={AlarmClock}
          className={cn(stats.overdue > 0 && 'border-danger/40')}
        />
        <StatCard label={t('requests.stats.atRisk')} value={f.number(stats.atRisk)} icon={Hourglass} />
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
        onRowClick={(r) => setPreviewId(r.id)}
        searchFn={(r, q) =>
          r.title.toLowerCase().includes(q) ||
          (r.reference ?? '').toLowerCase().includes(q) ||
          localized(r.clientName, locale).toLowerCase().includes(q)
        }
        searchPlaceholder={t('requests.searchPlaceholder')}
        filters={[
          ...(view === 'all'
            ? [
                {
                  id: 'status',
                  label: t('common.status'),
                  options: requestStatuses.filter((s) => s !== 'draft').map((s) => ({ value: s, label: t(`requests.statuses.${s}`) })),
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
          ...(view !== 'mine'
            ? [{ id: 'assignee', label: t('requests.assignee'), options: assignees.map(([value, label]) => ({ value, label })) }]
            : []),
          { id: 'type', label: t('requests.type'), options: types.map(([value, label]) => ({ value, label })) },
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
          <div className="flex items-start gap-3 px-4 py-3" data-testid="request-card">
            <TypeIcon icon={r.typeIcon} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                <bdi>{r.title}</bdi>
              </p>
              <p className="truncate text-xs text-subtle-foreground">
                <span dir="ltr">{r.reference}</span>
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
      <PreviewDrawer request={preview} onOpenChange={(o) => !o && setPreviewId(null)} me={me} canTriage={canTriage} convert={convert} />
    </div>
  );
}
