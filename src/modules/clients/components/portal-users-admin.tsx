'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Pencil, UsersRound } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Bdi, EmptyState } from '@/components/patterns';
import { DataTable } from '@/components/patterns/data-table';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Avatar, Badge } from '@/components/ui/primitives';
import { localized, type Locale } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import {
  ChangeEmailDialog,
  PendingEmailNotice,
  PortalUserDrawer,
  type ChangeEmailTarget,
} from '@/modules/clients/components/portal-user-dialogs';
import type { PortalUserSummary } from '@/modules/clients/server/portal-users';

/** Admin → Users → Portal users (FR4.1 / FR4.2): every portal user with their clients; a row opens the drawer. */
export function PortalUsersAdmin({
  users,
  canChangeEmail,
  canDeactivateAccount,
  meUserId,
}: {
  users: PortalUserSummary[];
  canChangeEmail: boolean;
  canDeactivateAccount: boolean;
  meUserId: string;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const [openId, setOpenId] = useState<string | null>(null);
  const [emailTarget, setEmailTarget] = useState<ChangeEmailTarget | null>(null);
  const clientNames = (u: PortalUserSummary) =>
    u.memberships.filter((m) => m.status === 'active').map((m) => localized(m.clientName, locale));

  const columns = useMemo<ColumnDef<PortalUserSummary>[]>(
    () => [
      {
        id: 'name',
        header: t('common.name'),
        accessorFn: (u) => u.name,
        cell: ({ row }) => {
          const u = row.original;
          return (
            <div className="flex items-center gap-3">
              <Avatar name={u.name} src={publicAssetUrl(u.avatarPath)} size="sm" />
              <div className="min-w-0">
                <p className="truncate font-medium">{u.name}</p>
                <p className="truncate text-xs text-subtle-foreground">
                  <Bdi>{u.email}</Bdi>
                </p>
                {u.pendingEmail ? <PendingEmailNotice userId={u.userId} email={u.pendingEmail.to} canCancel={canChangeEmail} /> : null}
              </div>
            </div>
          );
        },
      },
      {
        id: 'clients',
        header: t('clients.users.clientsColumn'),
        accessorFn: (u) => clientNames(u).join(', '),
        cell: ({ row }) => {
          const names = clientNames(row.original);
          return names.length ? (
            <div className="flex flex-wrap gap-1">
              {names.map((n) => (
                <Badge key={n} tone="outline">
                  {n}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-subtle-foreground">—</span>
          );
        },
      },
      {
        id: 'status',
        header: t('clients.users.accountStatus'),
        accessorFn: (u) => u.accountStatus,
        cell: ({ row }) =>
          row.original.accountStatus === 'active' ? (
            <Badge tone="success">{t('common.active')}</Badge>
          ) : (
            <Badge tone="neutral">{t('common.deactivated')}</Badge>
          ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('common.moreActions')}</span>,
        enableSorting: false,
        cell: ({ row }) =>
          canChangeEmail ? (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={t('common.moreActions')}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    onSelect={() =>
                      setEmailTarget({
                        kind: 'user',
                        userId: row.original.userId,
                        name: row.original.name,
                        email: row.original.email,
                        clientId: null,
                      })
                    }
                    data-testid="portal-user-change-email"
                  >
                    <Pencil />
                    {t('clients.users.changeEmail')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, canChangeEmail],
  );

  return (
    <>
      <DataTable
        testId="portal-users-table"
        data={users}
        columns={columns}
        getRowId={(u) => u.userId}
        onRowClick={(u) => setOpenId(u.userId)}
        searchFn={(u, q) =>
          u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || clientNames(u).some((n) => n.toLowerCase().includes(q))
        }
        filters={[
          {
            id: 'status',
            label: t('common.status'),
            options: [
              { value: 'active', label: t('common.active') },
              { value: 'deactivated', label: t('common.deactivated') },
            ],
          },
        ]}
        emptyState={
          <EmptyState icon={UsersRound} title={t('clients.users.adminEmpty')} description={t('clients.users.adminEmptyBody')} compact />
        }
        mobileCard={(u) => (
          <div className="flex items-center gap-3 px-4 py-3">
            <Avatar name={u.name} src={publicAssetUrl(u.avatarPath)} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{u.name}</p>
              <p className="truncate text-xs text-subtle-foreground">{f.list(clientNames(u))}</p>
            </div>
            {u.accountStatus === 'deactivated' ? <Badge tone="neutral">{t('common.deactivated')}</Badge> : null}
          </div>
        )}
      />
      <PortalUserDrawer
        userId={openId}
        onOpenChange={(o) => !o && setOpenId(null)}
        side="agency"
        canChangeEmail={canChangeEmail}
        canDeactivateAccount={canDeactivateAccount}
        meUserId={meUserId}
      />
      <ChangeEmailDialog target={emailTarget} onOpenChange={(o) => !o && setEmailTarget(null)} />
    </>
  );
}
