import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { listAgencyPeople } from '@/modules/clients/server/queries';
import { listReviewQueue } from '@/modules/deliverables/server/queries';
import { listDepartments } from '@/modules/rbac/server/queries';
import { MyWork } from '@/modules/tasks/components/my-work';
import { dayInZone } from '@/modules/tasks/constants';
import { getRunningTimer, getTaskEditContext, listTasks } from '@/modules/tasks/server/queries';
import { listTaskStatuses } from '@/modules/workflows/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('myWork') };
}

export default async function MyWorkPage() {
  const ctx = await requireAgency('tasks:read');
  if (!ctx.flags['module.tasks']) notFound();
  const t = await getTranslations('tasks.myWork');
  const me = ctx.session.userId;
  const [tasks, reviews, statuses, people, departments, timer] = await Promise.all([
    listTasks(),
    listReviewQueue(me),
    listTaskStatuses(),
    listAgencyPeople(ctx),
    listDepartments(ctx),
    getRunningTimer(me),
  ]);
  const edit = await getTaskEditContext(ctx.organization.id, me);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <MyWork
        initialTasks={tasks}
        reviews={reviews}
        statuses={statuses.map((s) => ({ id: s.id, name: s.name, category: s.category, color: s.color }))}
        people={people.map((p) => ({ id: p.id, name: p.name, avatarPath: p.avatar_path }))}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        me={me}
        today={dayInZone(new Date(), ctx.organization.defaultTimezone)}
        timer={timer}
        perms={{
          canCreate: can(ctx.permissions, 'tasks:create'),
          canUpdate: can(ctx.permissions, 'tasks:update'),
          canDelete: can(ctx.permissions, 'tasks:delete'),
          canManageDeliverables: can(ctx.permissions, 'deliverables:manage'),
          edit,
        }}
      />
    </>
  );
}
