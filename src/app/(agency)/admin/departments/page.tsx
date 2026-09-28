import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import { departmentMembers } from '@/lib/db/schema';
import { DepartmentsAdmin, type DepartmentView } from '@/modules/departments/components/departments-admin';
import type { DepartmentColor } from '@/modules/departments/constants';
import { listDepartments, listTeam } from '@/modules/rbac/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('departments') };
}

export default async function DepartmentsPage() {
  const ctx = await requireAgency('departments:manage');
  const t = await getTranslations('admin.departments');
  const [depts, team, memberships] = await Promise.all([
    listDepartments(ctx),
    listTeam(ctx),
    withRls((tx) => tx.select().from(departmentMembers).where(eq(departmentMembers.organizationId, ctx.organization.id))),
  ]);
  const departments: DepartmentView[] = depts.map((d) => ({
    id: d.id,
    name: d.name,
    color: d.color as DepartmentColor,
    isArchived: d.isArchived,
    members: memberships.filter((m) => m.departmentId === d.id).map((m) => ({ userId: m.userId, isLead: m.isLead })),
  }));
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <DepartmentsAdmin
        departments={departments}
        people={team
          .filter((m) => m.status === 'active')
          .map((m) => ({ userId: m.userId, name: m.name, avatarPath: m.avatarPath, jobTitle: m.jobTitle }))}
      />
    </>
  );
}
