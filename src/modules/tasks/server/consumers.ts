import 'server-only';

import { and, eq, inArray, ne } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { clients, profiles, taskDependencies, taskMembers, tasks } from '@/lib/db/schema';
import { defineConsumer } from '@/lib/events/dispatcher';
import { localized } from '@/lib/i18n/localized';
import { notify } from '@/modules/notifications/server/notify';
import { taskReference } from '@/modules/tasks/constants';

async function load(taskId: string, actorId: string | null) {
  const [task] = await dbAdmin.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) return null;
  const [client] = await dbAdmin.select({ name: clients.name }).from(clients).where(eq(clients.id, task.clientId));
  const [actor] = actorId ? await dbAdmin.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, actorId)) : [];
  const assignees = await dbAdmin
    .select({ userId: taskMembers.userId })
    .from(taskMembers)
    .where(and(eq(taskMembers.taskId, taskId), eq(taskMembers.role, 'assignee')));
  return {
    task,
    assignees: assignees.map((a) => a.userId),
    params: {
      actor: actor?.name ?? '',
      client: client ? localized(client.name, 'ar') || localized(client.name, 'en') : '',
      task: `${taskReference(task.number)} · ${task.title}`,
      due: task.dueDate ?? '',
    },
    link: `/tasks?task=${task.id}`,
  };
}

/**
 * Task events → notifications (ADR-028): assigned, ready for review (manual move to a review status), unblocked
 * (every blocker of a dependent task is done → its assignees), due soon and overdue (from the reminder sweep).
 */
export const taskNotifications = defineConsumer({
  name: 'notifications.tasks',
  types: ['task.assigned', 'task.status_changed', 'task.due_soon', 'task.overdue'],
  async handle(event) {
    const ctx = await load(event.payload.taskId, event.actorId);
    if (!ctx) return;
    const base = { organizationId: event.organizationId, actorId: event.actorId, eventId: event.id };
    switch (event.type) {
      case 'task.assigned':
        await notify({ ...base, userIds: event.payload.userIds, type: 'task_assigned', params: ctx.params, link: ctx.link });
        return;
      case 'task.due_soon':
        await notify({ ...base, userIds: ctx.assignees, type: 'task_due_soon', params: ctx.params, link: ctx.link });
        return;
      case 'task.overdue':
        await notify({ ...base, userIds: ctx.assignees, type: 'task_overdue', params: ctx.params, link: ctx.link });
        return;
      case 'task.status_changed': {
        const { to } = event.payload;
        if (to === 'review' && ctx.task.reviewerId) {
          await notify({ ...base, userIds: [ctx.task.reviewerId], type: 'task_review_requested', params: ctx.params, link: ctx.link });
        }
        if (to !== 'done') return;
        // Dependents whose blockers are now all done.
        const dependents = await dbAdmin
          .select({ taskId: taskDependencies.taskId })
          .from(taskDependencies)
          .where(eq(taskDependencies.dependsOnId, ctx.task.id));
        if (!dependents.length) return;
        const ids = dependents.map((d) => d.taskId);
        const stillBlocked = await dbAdmin
          .select({ taskId: taskDependencies.taskId })
          .from(taskDependencies)
          .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnId))
          .where(and(inArray(taskDependencies.taskId, ids), ne(tasks.statusCategory, 'done')));
        const blocked = new Set(stillBlocked.map((s) => s.taskId));
        for (const id of ids.filter((i) => !blocked.has(i))) {
          const next = await load(id, event.actorId);
          if (!next || next.task.statusCategory === 'done') continue;
          await notify({
            ...base,
            userIds: next.assignees,
            type: 'task_unblocked',
            params: { ...next.params, blocker: `${taskReference(ctx.task.number)} · ${ctx.task.title}` },
            link: next.link,
          });
        }
        return;
      }
    }
  },
});
