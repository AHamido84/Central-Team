'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Copy, FileUp, Plus, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { EmptyState } from '@/components/patterns';
import { DataTable } from '@/components/patterns/data-table';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { publicAssetUrl } from '@/lib/storage';
import { LeadStatusBadge, ScoreMeter } from '@/modules/crm/components/badges';
import { LeadDialog } from '@/modules/crm/components/lead-dialog';
import { LeadImportDialog } from '@/modules/crm/components/lead-import';
import { crmServices, leadReference, leadSources, leadStatuses } from '@/modules/crm/constants';
import { assignLeadsAction } from '@/modules/crm/server/actions';
import type { LeadListItem } from '@/modules/crm/server/queries';
import { BulkDeleteButton } from '@/modules/data/components/bulk-delete';
import { RowActions } from '@/modules/data/components/row-actions';

export function LeadsTable({
  leads,
  owners,
  me,
  canManage,
  canManageAll,
  canDelete = false,
}: {
  leads: LeadListItem[];
  owners: { id: string; name: string }[];
  me: string;
  canManage: boolean;
  canManageAll: boolean;
  /** `leads:delete`: moves leads to the Trash (FR5, ADR-094). */
  canDelete?: boolean;
}) {
  const t = useTranslations();
  const f = useFormat();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [assignTo, setAssignTo] = useState('');
  const assign = useAction(assignLeadsAction, { successMessage: t('crm.leads.assigned') });

  const columns = useMemo<ColumnDef<LeadListItem, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('crm.leads.name'),
        accessorFn: (l) => l.fullName,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium">
              <bdi>{row.original.fullName}</bdi>
              {row.original.duplicates ? (
                <Badge tone="warning" title={t('crm.leads.duplicates')}>
                  <Copy aria-hidden />
                  {f.number(row.original.duplicates)}
                </Badge>
              ) : null}
            </p>
            <p className="truncate text-xs text-subtle-foreground">
              <span dir="ltr">{leadReference(row.original.number)}</span>
              {row.original.company ? (
                <>
                  {' '}
                  · <bdi>{row.original.company}</bdi>
                </>
              ) : null}
            </p>
          </div>
        ),
      },
      {
        id: 'contact',
        header: t('crm.leads.contact'),
        accessorFn: (l) => l.phone ?? l.email ?? '',
        cell: ({ row }) => (
          <div className="text-xs text-muted-foreground" dir="ltr">
            {row.original.phone ? <p>{row.original.phone}</p> : null}
            {row.original.email ? <p className="truncate">{row.original.email}</p> : null}
          </div>
        ),
      },
      {
        id: 'source',
        header: t('crm.leads.source'),
        accessorFn: (l) => l.source,
        cell: ({ row }) => <span className="text-sm">{t(`crm.sources.${row.original.source}`)}</span>,
      },
      {
        id: 'services',
        accessorFn: (l) => l.services,
        header: t('crm.leads.services'),
        enableHiding: true,
        cell: ({ row }) => (
          <span className="line-clamp-1 text-xs text-muted-foreground">
            {row.original.services.map((s) => t(`crm.services.${s as (typeof crmServices)[number]}`)).join(' · ') || '—'}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('crm.leads.status'),
        accessorFn: (l) => l.status,
        cell: ({ row }) => <LeadStatusBadge status={row.original.status} />,
      },
      {
        id: 'score',
        header: t('crm.leads.score'),
        accessorFn: (l) => l.score,
        cell: ({ row }) => <ScoreMeter score={row.original.score} />,
      },
      {
        id: 'owner',
        header: t('crm.leads.owner'),
        accessorFn: (l) => l.owner?.id ?? '',
        cell: ({ row }) =>
          row.original.owner ? (
            <span className="flex items-center gap-2 text-sm">
              <Avatar name={row.original.owner.name} src={publicAssetUrl(row.original.owner.avatarPath)} size="xs" />
              <span className="truncate">{row.original.owner.name}</span>
            </span>
          ) : (
            <span className="text-sm text-subtle-foreground">{t('crm.leads.unassigned')}</span>
          ),
      },
      {
        id: 'lastActivity',
        header: t('crm.leads.lastActivity'),
        accessorFn: (l) => l.lastActivityAt,
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{f.relative(row.original.lastActivityAt)}</span>,
      },
      ...(canDelete
        ? [
            {
              id: 'actions',
              header: () => <span className="sr-only">{t('data.actions.column')}</span>,
              enableSorting: false,
              enableHiding: false,
              cell: ({ row }) => (
                <div className="flex justify-end">
                  <RowActions label={row.original.fullName} del={{ type: 'lead', id: row.original.id }} testId="lead-row-actions" />
                </div>
              ),
            } satisfies ColumnDef<LeadListItem, unknown>,
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canDelete],
  );

  const filters = [
    {
      id: 'status',
      label: t('crm.leads.status'),
      options: leadStatuses.filter((s) => s !== 'merged').map((s) => ({ value: s, label: t(`crm.statuses.${s}`) })),
    },
    { id: 'source', label: t('crm.leads.source'), options: leadSources.map((s) => ({ value: s, label: t(`crm.sources.${s}`) })) },
    { id: 'services', label: t('crm.leads.filterService'), options: crmServices.map((s) => ({ value: s, label: t(`crm.services.${s}`) })) },
    { id: 'owner', label: t('crm.leads.filterOwner'), options: owners.map((o) => ({ value: o.id, label: o.name })) },
  ];

  return (
    <>
      <DataTable
        testId="leads-table"
        data={leads}
        columns={columns}
        getRowId={(l) => l.id}
        onRowClick={(l) => router.push(`/crm/leads/${l.id}`)}
        searchPlaceholder={t('crm.leads.search')}
        searchFn={(l, q) =>
          [l.fullName, l.company, l.phone, l.email, leadReference(l.number), ...l.tags].some((x) =>
            x?.toLowerCase().includes(q.toLowerCase()),
          )
        }
        filters={filters}
        toolbar={
          canManage ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setImporting(true)} data-testid="lead-import-open">
                <FileUp />
                {t('crm.leads.import')}
              </Button>
              <Button onClick={() => setCreating(true)} data-testid="lead-new">
                <Plus />
                {t('crm.leads.new')}
              </Button>
            </div>
          ) : null
        }
        bulkActions={
          canManage || canDelete
            ? (rows, clear) => (
                <div className="flex flex-wrap items-center gap-2">
                  {canManage ? (
                    <>
                      <NativeSelect
                        value={assignTo}
                        onChange={(e) => setAssignTo(e.target.value)}
                        aria-label={t('crm.leads.assignTo')}
                        className="h-8 min-w-40"
                      >
                        <option value="">{t('crm.leads.unassigned')}</option>
                        {(canManageAll ? owners : owners.filter((o) => o.id === me)).map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </NativeSelect>
                      <Button
                        size="sm"
                        loading={assign.pending}
                        onClick={async () => {
                          const res = await assign.run({ leadIds: rows.map((r) => r.id), ownerId: assignTo || null });
                          if (res.ok) clear();
                        }}
                      >
                        <UserPlus />
                        {t('crm.leads.assignSelected')}
                      </Button>
                    </>
                  ) : null}
                  {canDelete ? (
                    <BulkDeleteButton type="lead" items={rows.map((r) => ({ id: r.id, name: r.fullName }))} onDone={clear} />
                  ) : null}
                </div>
              )
            : undefined
        }
        mobileCard={(l) => (
          <div className="flex items-start gap-3 px-4 py-3" data-testid="lead-card">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                <bdi>{l.fullName}</bdi>
              </p>
              <p className="truncate text-xs text-subtle-foreground">
                <span dir="ltr">{leadReference(l.number)}</span> · {t(`crm.sources.${l.source}`)}
                {l.owner ? ` · ${l.owner.name}` : ''}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <LeadStatusBadge status={l.status} />
                <ScoreMeter score={l.score} />
              </div>
            </div>
            {canDelete ? <RowActions label={l.fullName} del={{ type: 'lead', id: l.id }} testId="lead-row-actions" /> : null}
          </div>
        )}
        emptyState={
          <EmptyState
            icon={UserPlus}
            title={t('crm.leads.empty')}
            description={t('crm.leads.emptyBody')}
            action={
              canManage ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus />
                  {t('crm.leads.new')}
                </Button>
              ) : null
            }
          />
        }
      />
      <LeadDialog lead={null} open={creating} onOpenChange={setCreating} owners={owners} me={me} canManageAll={canManageAll} />
      <LeadImportDialog open={importing} onOpenChange={setImporting} owners={owners} canManageAll={canManageAll} />
    </>
  );
}
