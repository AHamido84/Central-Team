import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { RolesAdmin } from '@/modules/rbac/components/roles-admin';
import { listPermissions, listRoles } from '@/modules/rbac/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('roles') };
}

export default async function RolesPage() {
  const ctx = await requireAgency('roles:read');
  const t = await getTranslations('admin.roles');
  const [roles, permissions] = await Promise.all([listRoles(ctx), listPermissions()]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <RolesAdmin roles={roles} permissions={permissions} me={{ isSuperAdmin: ctx.isSuperAdmin, permissions: [...ctx.permissions] }} />
    </>
  );
}
