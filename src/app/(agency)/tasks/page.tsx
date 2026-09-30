import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { listAgencyPeople, listClients } from '@/modules/clients/server/queries';
import { listDepartments } from '@/modules/rbac/server/queries';
import { TasksWorkspace } from '@/modules/tasks/components/tasks-workspace';
import { dayInZone, taskLayouts, type TaskLayout } from '@/modules/tasks/constants';
import { getRunningTimer, getTaskEditContext, listSavedViews, listTasks } from '@/modules/tasks/server/queries';
import { listTaskStatuses } from '@/modules/workflows/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('tasks') };
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ layout?: string; view?: string }> }) {
  const ctx = await requireAgency('tasks:read');
  if (!ctx.flags['module.tasks']) notFound();
  const { layout, view } = await searchParams;
  const t = await getTranslations('tasks');
  const me = ctx.session.userId;
  const [tasks, statuses, people, clients, departments, views, timer] = await Promise.all([
    listTasks(),
    listTaskStatuses(),
    listAgencyPeople(ctx),
    listClients(ctx),
    listDepartments(ctx),
    listSavedViews(me),
    getRunningTimer(me),
  ]);
  const edit = await getTaskEditContext(ctx.organization.id, me);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <TasksWorkspace
        initialTasks={tasks}
        statuses={statuses.map((s) => ({ id: s.id, name: s.name, category: s.category, color: s.color }))}
        people={people.map((p) => ({ id: p.id, name: p.name, avatarPath: p.avatar_path }))}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        views={views}
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
        initialLayout={taskLayouts.includes(layout as TaskLayout) ? (layout as TaskLayout) : 'board'}
        initialViewId={view ?? null}
      />
    </>
  );
}
