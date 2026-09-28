'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { MailX, MoreHorizontal, RotateCw, Send, Users, XCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { DataTable } from '@/components/patterns/data-table';
import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Avatar, Badge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { resendInvitationAction, revokeInvitationAction } from '@/modules/invitations/server/actions';
import { InviteTeamDialog } from '@/modules/rbac/components/invite-team-dialog';
import { MemberSheet } from '@/modules/rbac/components/member-sheet';
import type { InvitationRow, PermissionRow, RoleSummary, TeamMember } from '@/modules/rbac/server/queries';

export type TeamAdminProps = {
  members: TeamMember[];
  invitations: InvitationRow[] | null;
  roles: RoleSummary[];
  departments: { id: string; name: LocalizedText }[];
  permissions: PermissionRow[];
  me: { userId: string; isSuperAdmin: boolean; permissions: string[] };
};

const statusTone = { pending: 'info', accepted: 'success', revoked: 'neutral', expired: 'warning' } as const;

function InvitationActions({
  invitation,
  canResend,
  canRevoke,
  onResend,
  onRevoke,
}: {
  invitation: InvitationRow;
  canResend: boolean;
  canRevoke: boolean;
  onResend: () => void;
  onRevoke: () => Promise<unknown>;
}) {
  const t = useTranslations();
  const [confirm, setConfirm] = useState(false);
  if (invitation.status !== 'pending' && invitation.status !== 'expired') return null;
  if (!canResend && !canRevoke) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.moreActions')}
            onClick={(e) => e.stopPropagation()}
            data-testid="invitation-actions"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {canResend ? (
            <DropdownMenuItem onSelect={onResend} data-testid="invitation-resend">
              <RotateCw />
              {t('admin.users.resend')}
            </DropdownMenuItem>
          ) : null}
          {canRevoke && invitation.status === 'pending' ? (
            <DropdownMenuItem destructive onSelect={() => setConfirm(true)} data-testid="invitation-revoke">
              <XCircle />
              {t('admin.users.revoke')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('admin.users.revokeTitle')}
        description={t('admin.users.revokeBody', { email: invitation.email })}
        confirmLabel={t('admin.users.revoke')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={onRevoke}
      />
    </>
  );
}

export function TeamAdmin(props: TeamAdminProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const router = useRouter();
  const search = useSearchParams();
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const can = (p: string) => props.me.permissions.includes(p);
  const agencyRoles = props.roles.filter((r) => r.side === 'agency');
  const roleName = (id: string) => {
    const r = props.roles.find((x) => x.id === id);
    return r ? localized(r.name, locale) : '';
  };
  const deptName = (id: string) => {
    const d = props.departments.find((x) => x.id === id);
    return d ? localized(d.name, locale) : '';
  };
  const grantable = agencyRoles
    .filter((r) => props.me.isSuperAdmin || (!r.isLocked && r.permissionKeys.every((k) => can(k))))
    .map((r) => r.id);

  const resend = useAction(resendInvitationAction, { successMessage: t('admin.users.inviteResent') });
  const revoke = useAction(revokeInvitationAction, { successMessage: t('admin.users.inviteRevoked') });

  const memberColumns = useMemo<ColumnDef<TeamMember, unknown>[]>(
    () => [
      {
        id: 'member',
        header: t('admin.users.member'),
        accessorFn: (m) => m.name,
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar name={row.original.name} src={publicAssetUrl(row.original.avatarPath)} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-medium">{row.original.name}</p>
              <p className="truncate text-xs text-subtle-foreground" dir="ltr">
                {row.original.email}
              </p>
            </div>
          </div>
        ),
      },
      {
        id: 'roles',
        header: t('common.roles'),
        accessorFn: (m) => m.roleIds,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.roleIds.map((id) => (
              <Badge key={id} tone="brand">
                {roleName(id)}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: 'departments',
        header: t('admin.users.departments'),
        accessorFn: (m) => m.departmentIds,
        enableSorting: false,
        cell: ({ row }) => <span className="text-muted-foreground">{f.list(row.original.departmentIds.map(deptName)) || '—'}</span>,
      },
      {
        id: 'jobTitle',
        header: t('admin.users.jobTitle'),
        accessorFn: (m) => m.jobTitle ?? '',
        cell: ({ getValue }) => <span className="text-muted-foreground">{String(getValue() || '—')}</span>,
      },
      {
        id: 'status',
        header: t('common.status'),
        accessorFn: (m) => m.status,
        cell: ({ row }) =>
          row.original.status === 'active' ? (
            row.original.onboarded ? (
              <Badge tone="success" dot>
                {t('common.active')}
              </Badge>
            ) : (
              <Badge tone="info" dot>
                {t('admin.users.notOnboarded')}
              </Badge>
            )
          ) : (
            <Badge tone="neutral" dot>
              {t('common.deactivated')}
            </Badge>
          ),
      },
      {
        id: 'joinedAt',
        header: t('admin.users.joined'),
        accessorFn: (m) => m.joinedAt,
        cell: ({ row }) => <span className="tabular text-muted-foreground">{f.date(row.original.joinedAt)}</span>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  const invitationColumns = useMemo<ColumnDef<InvitationRow, unknown>[]>(
    () => [
      {
        id: 'email',
        header: t('common.email'),
        accessorFn: (i) => i.email,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.fullName ?? row.original.email}</p>
            <p className="truncate text-xs text-subtle-foreground" dir="ltr">
              {row.original.email}
            </p>
          </div>
        ),
      },
      {
        id: 'roles',
        header: t('common.roles'),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.roleIds.map((id) => (
              <Badge key={id} tone="outline">
                {roleName(id)}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: 'status',
        header: t('common.status'),
        accessorFn: (i) => i.status,
        cell: ({ row }) => (
          <Badge tone={statusTone[row.original.status]} dot>
            {t(`common.${row.original.status}`)}
          </Badge>
        ),
      },
      {
        id: 'invitedBy',
        header: t('admin.users.invitedBy'),
        accessorFn: (i) => i.invitedByName ?? '',
        cell: ({ getValue }) => <span className="text-muted-foreground">{String(getValue() || '—')}</span>,
      },
      {
        id: 'sent',
        header: t('admin.users.lastSent'),
        accessorFn: (i) => i.lastSentAt,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {f.relative(row.original.lastSentAt)}
            {row.original.sendCount > 1 ? ` · ${t('admin.users.sentTimes', { count: row.original.sendCount })}` : ''}
          </span>
        ),
      },
      {
        id: 'expires',
        header: t('admin.users.expires'),
        accessorFn: (i) => i.expiresAt,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.status === 'pending' || row.original.status === 'expired' ? f.relative(row.original.expiresAt) : '—'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => (
          <InvitationActions
            invitation={row.original}
            canResend={can('invitations:resend')}
            canRevoke={can('invitations:revoke')}
            onResend={() => void resend.run({ invitationId: row.original.id })}
            onRevoke={() => revoke.run({ invitationId: row.original.id })}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  const tab = search.get('tab') === 'invitations' && props.invitations ? 'invitations' : 'members';
  const openMember = props.members.find((m) => m.userId === openUserId) ?? null;
  const pendingCount = props.invitations?.filter((i) => i.status === 'pending').length ?? 0;

  return (
    <>
      <Tabs value={tab} onValueChange={(v) => router.replace(v === 'invitations' ? '?tab=invitations' : '?', { scroll: false })}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="members">
              <Users />
              {t('admin.users.membersTab')}
              <Badge tone="neutral">{f.number(props.members.length)}</Badge>
            </TabsTrigger>
            {props.invitations ? (
              <TabsTrigger value="invitations" data-testid="tab-invitations">
                <Send />
                {t('admin.users.invitationsTab')}
                {pendingCount ? <Badge tone="info">{f.number(pendingCount)}</Badge> : null}
              </TabsTrigger>
            ) : null}
          </TabsList>
          {can('invitations:create') ? (
            <InviteTeamDialog roles={agencyRoles} departments={props.departments} grantable={grantable} />
          ) : null}
        </div>
        <TabsContent value="members">
          <DataTable
            testId="members-table"
            data={props.members}
            columns={memberColumns}
            getRowId={(m) => m.userId}
            onRowClick={(m) => setOpenUserId(m.userId)}
            searchFn={(m, q) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)}
            filters={[
              {
                id: 'roles',
                label: t('common.role'),
                options: agencyRoles.map((r) => ({ value: r.id, label: localized(r.name, locale) })),
              },
              {
                id: 'departments',
                label: t('common.department'),
                options: props.departments.map((d) => ({ value: d.id, label: localized(d.name, locale) })),
              },
              {
                id: 'status',
                label: t('common.status'),
                options: [
                  { value: 'active', label: t('common.active') },
                  { value: 'deactivated', label: t('common.deactivated') },
                ],
              },
            ]}
            mobileCard={(m) => (
              <div className="flex items-center gap-3 px-4 py-3">
                <Avatar name={m.name} src={publicAssetUrl(m.avatarPath)} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.name}</p>
                  <p className="truncate text-xs text-subtle-foreground">{f.list(m.roleIds.map(roleName))}</p>
                </div>
                {m.status === 'deactivated' ? <Badge tone="neutral">{t('common.deactivated')}</Badge> : null}
              </div>
            )}
          />
        </TabsContent>
        {props.invitations ? (
          <TabsContent value="invitations">
            <DataTable
              testId="invitations-table"
              data={props.invitations}
              columns={invitationColumns}
              getRowId={(i) => i.id}
              searchFn={(i, q) => i.email.toLowerCase().includes(q) || (i.fullName ?? '').toLowerCase().includes(q)}
              filters={[
                {
                  id: 'status',
                  label: t('common.status'),
                  options: (['pending', 'expired', 'accepted', 'revoked'] as const).map((s) => ({ value: s, label: t(`common.${s}`) })),
                },
              ]}
              emptyState={
                <EmptyState icon={MailX} title={t('admin.users.noInvitations')} description={t('admin.users.noInvitationsBody')} compact />
              }
              mobileCard={(i) => (
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{i.fullName ?? i.email}</p>
                    <p className="truncate text-xs text-subtle-foreground" dir="ltr">
                      {i.email}
                    </p>
                  </div>
                  <Badge tone={statusTone[i.status]}>{t(`common.${i.status}`)}</Badge>
                  <InvitationActions
                    invitation={i}
                    canResend={can('invitations:resend')}
                    canRevoke={can('invitations:revoke')}
                    onResend={() => void resend.run({ invitationId: i.id })}
                    onRevoke={() => revoke.run({ invitationId: i.id })}
                  />
                </div>
              )}
            />
          </TabsContent>
        ) : null}
      </Tabs>
      <MemberSheet
        key={openMember ? `${openMember.userId}:${openMember.roleIds.join()}:${openMember.jobTitle}` : 'none'}
        member={openMember}
        onOpenChange={(o) => !o && setOpenUserId(null)}
        roles={agencyRoles}
        departments={props.departments}
        permissions={props.permissions.filter((p) => p.side === 'agency')}
        me={props.me}
        grantable={grantable}
      />
    </>
  );
}
