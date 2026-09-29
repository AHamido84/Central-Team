'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Briefcase, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { EmptyState } from '@/components/patterns';
import { DataTable } from '@/components/patterns/data-table';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Avatar, Badge } from '@/components/ui/primitives';
import { localized, type Locale } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { clientStatuses, clientStatusTone, industries, type ClientStatus } from '@/modules/clients/constants';
import type { ClientListItem } from '@/modules/clients/server/queries';
import { ClientHealthBadge } from '@/modules/operations/components/health';
import type { ClientHealth, HealthReason } from '@/modules/operations/health';

type HealthMap = Record<string, { health: ClientHealth; score: number; reasons: HealthReason[] }>;

export function ClientsTable({ clients, canCreate, health }: { clients: ClientListItem[]; canCreate: boolean; health?: HealthMap }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const router = useRouter();
  const managers = [...new Map(clients.filter((c) => c.accountManager).map((c) => [c.accountManager!.id, c.accountManager!])).values()];

  const columns = useMemo<ColumnDef<ClientListItem, unknown>[]>(
    () => [
      {
        id: 'name',
        header: t('clients.client'),
        accessorFn: (c) => localized(c.name, locale),
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar name={localized(row.original.name, locale)} src={publicAssetUrl(row.original.logoPath)} size="md" square />
            <div className="min-w-0">
              <p className="truncate font-medium">{localized(row.original.name, locale)}</p>
              <p className="truncate text-xs text-subtle-foreground">
                {row.original.industry ? t(`clients.industries.${row.original.industry as (typeof industries)[number]}`) : '—'}
                {row.original.city ? ` · ${t(`clients.cities.${row.original.city as 'riyadh'}`)}` : ''}
              </p>
            </div>
          </div>
        ),
      },
      {
        id: 'status',
        header: t('common.status'),
        accessorFn: (c) => c.status,
        cell: ({ row }) => (
          <Badge tone={clientStatusTone[row.original.status as ClientStatus]} dot>
            {t(`clients.statuses.${row.original.status as ClientStatus}`)}
          </Badge>
        ),
      },
      ...(health
        ? [
            {
              id: 'health',
              header: t('operations.health.title'),
              accessorFn: (c: ClientListItem) => health[c.id]?.score ?? 101,
              cell: ({ row }: { row: { original: ClientListItem } }) => {
                const h = health[row.original.id];
                return h ? <ClientHealthBadge health={h.health} score={h.score} reasons={h.reasons} /> : '—';
              },
            } satisfies ColumnDef<ClientListItem, unknown>,
          ]
        : []),
      {
        id: 'am',
        header: t('clients.accountManager'),
        accessorFn: (c) => c.accountManager?.id ?? '',
        cell: ({ row }) =>
          row.original.accountManager ? (
            <span className="flex items-center gap-2">
              <Avatar name={row.original.accountManager.name} src={publicAssetUrl(row.original.accountManager.avatarPath)} size="xs" />
              <span className="truncate">{row.original.accountManager.name}</span>
            </span>
          ) : (
            <span className="text-subtle-foreground">—</span>
          ),
      },
      {
        id: 'package',
        header: t('clients.package'),
        accessorFn: (c) => (c.packageName ? localized(c.packageName, locale) : ''),
        cell: ({ getValue }) => <span className="text-muted-foreground">{String(getValue() || '—')}</span>,
      },
      {
        id: 'users',
        header: t('clients.portalUsers'),
        accessorFn: (c) => c.portalUsers,
        cell: ({ getValue }) => <span className="tabular">{f.number(Number(getValue()))}</span>,
      },
      {
        id: 'lastMessage',
        header: t('clients.lastMessage'),
        accessorFn: (c) => c.lastMessageAt ?? '',
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.lastMessageAt ? f.relative(row.original.lastMessageAt) : '—'}</span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, health],
  );

  return (
    <DataTable
      testId="clients-table"
      data={clients}
      columns={columns}
      getRowId={(c) => c.id}
      onRowClick={(c) => router.push(`/clients/${c.id}`)}
      searchFn={(c, q) => (c.name.ar ?? '').toLowerCase().includes(q) || (c.name.en ?? '').toLowerCase().includes(q) || c.slug.includes(q)}
      searchPlaceholder={t('clients.searchPlaceholder')}
      filters={[
        { id: 'status', label: t('common.status'), options: clientStatuses.map((s) => ({ value: s, label: t(`clients.statuses.${s}`) })) },
        { id: 'am', label: t('clients.accountManager'), options: managers.map((m) => ({ value: m.id, label: m.name })) },
      ]}
      emptyState={
        <EmptyState
          icon={Briefcase}
          title={t('clients.emptyTitle')}
          description={t('clients.emptyBody')}
          action={
            canCreate ? (
              <Button asChild>
                <Link href="/clients/new">
                  <Plus />
                  {t('clients.new')}
                </Link>
              </Button>
            ) : null
          }
        />
      }
      mobileCard={(c) => (
        <div className="flex items-center gap-3 px-4 py-3">
          <Avatar name={localized(c.name, locale)} src={publicAssetUrl(c.logoPath)} size="md" square />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{localized(c.name, locale)}</p>
            <p className="truncate text-xs text-subtle-foreground">{c.accountManager?.name ?? '—'}</p>
          </div>
          {health?.[c.id] ? (
            <ClientHealthBadge health={health[c.id]!.health} score={health[c.id]!.score} reasons={health[c.id]!.reasons} />
          ) : (
            <Badge tone={clientStatusTone[c.status as ClientStatus]}>{t(`clients.statuses.${c.status as ClientStatus}`)}</Badge>
          )}
        </div>
      )}
    />
  );
}
