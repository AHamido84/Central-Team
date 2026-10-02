import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgencyAny } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { PortalUsersAdmin } from '@/modules/clients/components/portal-users-admin';
import { listPortalUsers } from '@/modules/clients/server/portal-users';
import { TeamAdmin } from '@/modules/rbac/components/team-admin';
import { listDepartments, listPermissions, listRoles, listTeam, listTeamInvitations } from '@/modules/rbac/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('users') };
}

export default async function UsersPage() {
  const ctx = await requireAgencyAny(['users:read', 'invitations:read']);
  const t = await getTranslations('admin.users');
  const showPortal = can(ctx.permissions, 'client_users:manage');
  const [members, invitations, roles, departments, permissions, portalUsers] = await Promise.all([
    listTeam(ctx),
    can(ctx.permissions, 'invitations:read') ? listTeamInvitations(ctx) : Promise.resolve(null),
    listRoles(ctx),
    listDepartments(ctx),
    listPermissions(),
    showPortal ? listPortalUsers() : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <TeamAdmin
        members={members}
        invitations={invitations}
        roles={roles}
        departments={departments.filter((d) => !d.isArchived).map((d) => ({ id: d.id, name: d.name }))}
        permissions={permissions}
        me={{ userId: ctx.session.userId, isSuperAdmin: ctx.isSuperAdmin, permissions: [...ctx.permissions] }}
        portalUsers={
          portalUsers
            ? {
                count: portalUsers.length,
                content: (
                  <PortalUsersAdmin
                    users={portalUsers}
                    canChangeEmail={can(ctx.permissions, 'client_users:update_email')}
                    canDeactivateAccount={can(ctx.permissions, 'users:deactivate')}
                    meUserId={ctx.session.userId}
                  />
                ),
              }
            : null
        }
      />
    </>
  );
}
