'use server';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { AgencyContext } from '@/lib/auth/context';
import type { Tx } from '@/lib/db/client';
import {
  savedViews,
  taskAttachments,
  taskChecklistItems,
  taskDependencies,
  taskMembers,
  taskStatuses,
  tasks,
  timeEntries,
} from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { can } from '@/lib/permissions/can';
import {
  attachmentsSchema,
  bulkTasksSchema,
  checklistAddSchema,
  checklistUpdateSchema,
  createTaskSchema,
  dependencySchema,
  manualTimeSchema,
  moveTaskSchema,
  removeAttachmentSchema,
  savedViewSchema,
  setMembersSchema,
  startTimerSchema,
  updateTaskSchema,
} from '@/modules/tasks/schemas';
import { getRunningTimer, getTaskDetail, listTasks, type TaskDetail, type TaskListItem } from '@/modules/tasks/server/queries';

const taskPaths = ['/tasks', '/my-work'];

async function loadTask(tx: Tx, taskId: string) {
  const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) throw new ActionFailure('not_found');
  return task;
}

async function emitStatusChange(tx: Tx, ctx: AgencyContext, task: { id: string; clientId: string }, from: string, to: string) {
  if (from === to) return;
  await emitEvent(tx, {
    type: 'task.status_changed',
    organizationId: ctx.organization.id,
    actorId: ctx.session.userId,
    aggregate: { type: 'task', id: task.id },
    clientId: task.clientId,
    payload: { taskId: task.id, clientId: task.clientId, from, to },
  });
}

async function addAssignees(tx: Tx, ctx: AgencyContext, task: { id: string; clientId: string }, userIds: string[]) {
  if (!userIds.length) return;
  const inserted = await tx
    .insert(taskMembers)
    .values(
      userIds.map((userId) => ({
        taskId: task.id,
        userId,
        role: 'assignee',
        organizationId: ctx.organization.id,
        clientId: task.clientId,
      })),
    )
    .onConflictDoNothing()
    .returning({ userId: taskMembers.userId });
  if (!inserted.length) return;
  await emitEvent(tx, {
    type: 'task.assigned',
    organizationId: ctx.organization.id,
    actorId: ctx.session.userId,
    aggregate: { type: 'task', id: task.id },
    clientId: task.clientId,
    payload: { taskId: task.id, clientId: task.clientId, userIds: inserted.map((i) => i.userId) },
  });
}

// ---------------------------------------------------------------------------
// Reads for client components (realtime refresh, drawer)
// ---------------------------------------------------------------------------

export const listTasksAction = defineAction({
  input: z.object({ requestId: z.uuid().optional(), clientId: z.uuid().optional() }),
  side: 'agency',
  permission: 'tasks:read',
  async handler({ input }): Promise<TaskListItem[]> {
    return listTasks(input);
  },
});

export const loadTaskAction = defineAction({
  input: z.object({ taskId: z.uuid() }),
  side: 'agency',
  permission: 'tasks:read',
  async handler({ input, ctx }): Promise<TaskDetail> {
    const task = await getTaskDetail(input.taskId, ctx.session.userId, can(ctx.permissions, 'time:read_all'));
    if (!task) throw new ActionFailure('not_found');
    return task;
  },
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const createTaskAction = defineAction({
  input: createTaskSchema,
  side: 'agency',
  permission: 'tasks:create',
  async handler({ input, tx, ctx }) {
    const [status] = input.statusId
      ? await tx.select().from(taskStatuses).where(eq(taskStatuses.id, input.statusId))
      : await tx.select().from(taskStatuses).where(eq(taskStatuses.isDefault, true));
    if (!status) throw new ActionFailure('invalid_status');
    let clientId = input.clientId;
    if (input.parentId) clientId = (await loadTask(tx, input.parentId)).clientId;
    const [row] = await tx
      .insert(tasks)
      .values({
        organizationId: ctx.organization.id,
        clientId,
        title: input.title,
        description: input.description ?? '',
        statusId: status.id,
        priority: input.priority ?? 'normal',
        dueDate: input.dueDate ?? null,
        parentId: input.parentId ?? null,
        requestId: input.requestId ?? null,
        departmentId: input.departmentId ?? null,
      })
      .returning({ id: tasks.id, number: tasks.number, clientId: tasks.clientId });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'task.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'task', id: row.id },
      clientId: row.clientId,
      payload: { taskId: row.id, clientId: row.clientId, parentId: input.parentId ?? null },
    });
    await addAssignees(tx, ctx, row, input.assigneeIds ?? []);
    return { taskId: row.id, number: row.number };
  },
  revalidate: taskPaths,
});

export const updateTaskAction = defineAction({
  input: updateTaskSchema,
  side: 'agency',
  permission: 'tasks:update',
  async handler({ input, tx, ctx }) {
    const current = await loadTask(tx, input.taskId);
    const patch = Object.fromEntries(Object.entries(input.patch).filter(([, v]) => v !== undefined));
    if (!Object.keys(patch).length) return { taskId: current.id };
    const [row] = await tx
      .update(tasks)
      .set(patch)
      .where(eq(tasks.id, current.id))
      .returning({ id: tasks.id, statusCategory: tasks.statusCategory });
    if (!row) throw new ActionFailure('forbidden');
    const fields = Object.keys(patch).filter((k) => k !== 'statusId');
    if (fields.length) {
      await emitEvent(tx, {
        type: 'task.updated',
        organizationId: ctx.organization.id,
        actorId: ctx.session.userId,
        aggregate: { type: 'task', id: current.id },
        clientId: current.clientId,
        payload: { taskId: current.id, clientId: current.clientId, fields },
      });
    }
    await emitStatusChange(tx, ctx, current, current.statusCategory, row.statusCategory);
    return { taskId: current.id };
  },
});

/** Board drag & drop: status column + position (fractional, one row rewritten). */
export const moveTaskAction = defineAction({
  input: moveTaskSchema,
  side: 'agency',
  permission: 'tasks:update',
  async handler({ input, tx, ctx }) {
    const current = await loadTask(tx, input.taskId);
    const [row] = await tx
      .update(tasks)
      .set({ statusId: input.statusId, position: input.position })
      .where(eq(tasks.id, current.id))
      .returning({ statusCategory: tasks.statusCategory });
    if (!row) throw new ActionFailure('forbidden');
    await emitStatusChange(tx, ctx, current, current.statusCategory, row.statusCategory);
    return { taskId: current.id };
  },
});

export const bulkUpdateTasksAction = defineAction({
  input: bulkTasksSchema,
  side: 'agency',
  permission: 'tasks:update',
  async handler({ input, tx, ctx }) {
    const rows = await tx.select().from(tasks).where(inArray(tasks.id, input.taskIds));
    if (rows.length !== input.taskIds.length) throw new ActionFailure('not_found');
    if (input.delete) {
      if (!can(ctx.permissions, 'tasks:delete')) throw new ActionFailure('forbidden');
      const deleted = await tx.delete(tasks).where(inArray(tasks.id, input.taskIds)).returning({ id: tasks.id, clientId: tasks.clientId });
      if (deleted.length !== rows.length) throw new ActionFailure('forbidden');
      for (const d of deleted) {
        await emitEvent(tx, {
          type: 'task.deleted',
          organizationId: ctx.organization.id,
          actorId: ctx.session.userId,
          aggregate: { type: 'task', id: d.id },
          clientId: d.clientId,
          payload: { taskId: d.id, clientId: d.clientId },
        });
      }
      return { updated: deleted.length };
    }
    const patch: Partial<typeof tasks.$inferInsert> = {};
    if (input.statusId) patch.statusId = input.statusId;
    if (input.priority) patch.priority = input.priority;
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
    if (Object.keys(patch).length) {
      const updated = await tx
        .update(tasks)
        .set(patch)
        .where(inArray(tasks.id, input.taskIds))
        .returning({ id: tasks.id, statusCategory: tasks.statusCategory });
      if (updated.length !== rows.length) throw new ActionFailure('forbidden');
      for (const r of rows) {
        const after = updated.find((u) => u.id === r.id)!;
        await emitStatusChange(tx, ctx, r, r.statusCategory, after.statusCategory);
      }
    }
    if (input.assigneeId) for (const r of rows) await addAssignees(tx, ctx, r, [input.assigneeId]);
    return { updated: rows.length };
  },
  revalidate: taskPaths,
});

export const deleteTaskAction = defineAction({
  input: z.object({ taskId: z.uuid() }),
  side: 'agency',
  permission: 'tasks:delete',
  async handler({ input, tx, ctx }) {
    const current = await loadTask(tx, input.taskId);
    const [row] = await tx.delete(tasks).where(eq(tasks.id, current.id)).returning({ id: tasks.id });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'task.deleted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'task', id: current.id },
      clientId: current.clientId,
      payload: { taskId: current.id, clientId: current.clientId },
    });
    return null;
  },
  revalidate: taskPaths,
});

/** Replaces the assignees or watchers of a task. */
export const setTaskMembersAction = defineAction({
  input: setMembersSchema,
  side: 'agency',
  permission: 'tasks:update',
  async handler({ input, tx, ctx }) {
    const task = await loadTask(tx, input.taskId);
    const current = await tx
      .select({ userId: taskMembers.userId })
      .from(taskMembers)
      .where(and(eq(taskMembers.taskId, task.id), eq(taskMembers.role, input.role)));
    const have = new Set(current.map((c) => c.userId));
    const want = new Set(input.userIds);
    const removed = [...have].filter((id) => !want.has(id));
    if (removed.length) {
      await tx
        .delete(taskMembers)
        .where(and(eq(taskMembers.taskId, task.id), eq(taskMembers.role, input.role), inArray(taskMembers.userId, removed)));
    }
    const added = [...want].filter((id) => !have.has(id));
    if (input.role === 'assignee') await addAssignees(tx, ctx, task, added);
    else if (added.length) {
      await tx
        .insert(taskMembers)
        .values(
          added.map((userId) => ({
            taskId: task.id,
            userId,
            role: 'watcher',
            organizationId: ctx.organization.id,
            clientId: task.clientId,
          })),
        );
    }
    return { taskId: task.id };
  },
});

export const setDependencyAction = defineAction({
  input: dependencySchema,
  side: 'agency',
  permission: 'tasks:update',
  async handler({ input, tx, ctx }) {
    const task = await loadTask(tx, input.taskId);
    if (input.remove) {
      await tx
        .delete(taskDependencies)
        .where(and(eq(taskDependencies.taskId, task.id), eq(taskDependencies.dependsOnId, input.dependsOnId)));
    } else {
      await tx
        .insert(taskDependencies)
        .values({ taskId: task.id, dependsOnId: input.dependsOnId, organizationId: ctx.organization.id, clientId: task.clientId })
        .onConflictDoNothing();
    }
    await emitEvent(tx, {
      type: 'task.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'task', id: task.id },
      clientId: task.clientId,
      payload: { taskId: task.id, clientId: task.clientId, fields: ['dependencies'] },
    });
    return { taskId: task.id };
  },
});

// ---------------------------------------------------------------------------
// Checklist & attachments
// ---------------------------------------------------------------------------

export const addChecklistItemAction = defineAction({
  input: checklistAddSchema,
  side: 'agency',
  permission: 'tasks:update',
  async handler({ input, tx, ctx }) {
    const task = await loadTask(tx, input.taskId);
    const [{ n }] = (await tx.execute<{ n: number }>(
      sql`select coalesce(max(sort_order), 0)::int + 1 as n from public.task_checklist_items where task_id = ${task.id}`,
    )) as unknown as [{ n: number }];
    const [row] = await tx
      .insert(taskChecklistItems)
      .values({ taskId: task.id, body: input.body, sortOrder: n, organizationId: ctx.organization.id, clientId: task.clientId })
      .returning({ id: taskChecklistItems.id });
    return { itemId: row!.id };
  },
});

export const updateChecklistItemAction = defineAction({
  input: checklistUpdateSchema,
  side: 'agency',
  permission: 'tasks:update',
  async handler({ input, tx }) {
    if (input.remove) {
      const [row] = await tx
        .delete(taskChecklistItems)
        .where(eq(taskChecklistItems.id, input.itemId))
        .returning({ id: taskChecklistItems.id });
      if (!row) throw new ActionFailure('not_found');
      return null;
    }
    const patch: Partial<typeof taskChecklistItems.$inferInsert> = {};
    if (input.body !== undefined) patch.body = input.body;
    if (input.isDone !== undefined) patch.isDone = input.isDone;
    const [row] = await tx
      .update(taskChecklistItems)
      .set(patch)
      .where(eq(taskChecklistItems.id, input.itemId))
      .returning({ id: taskChecklistItems.id });
    if (!row) throw new ActionFailure('not_found');
    return null;
  },
});

/** Links internal attachments (uploaded to the task's thread path with internal visibility) to the task. */
export const addTaskAttachmentsAction = defineAction({
  input: attachmentsSchema,
  side: 'agency',
  permission: 'tasks:update',
  async handler({ input, tx, ctx }) {
    const task = await loadTask(tx, input.taskId);
    await tx
      .insert(taskAttachments)
      .values(input.fileIds.map((fileId) => ({ taskId: task.id, fileId, organizationId: ctx.organization.id, clientId: task.clientId })))
      .onConflictDoNothing();
    return null;
  },
});

export const removeTaskAttachmentAction = defineAction({
  input: removeAttachmentSchema,
  side: 'agency',
  permission: 'tasks:update',
  async handler({ input, tx }) {
    await tx.delete(taskAttachments).where(and(eq(taskAttachments.taskId, input.taskId), eq(taskAttachments.fileId, input.fileId)));
    return null;
  },
});

// ---------------------------------------------------------------------------
// Time tracking (internal; your own entries only)
// ---------------------------------------------------------------------------

async function stopRunning(tx: Tx, ctx: AgencyContext) {
  const stopped = await tx
    .update(timeEntries)
    .set({ endedAt: new Date() })
    .where(and(eq(timeEntries.userId, ctx.session.userId), isNull(timeEntries.endedAt)))
    .returning({ taskId: timeEntries.taskId, clientId: timeEntries.clientId, minutes: timeEntries.minutes });
  for (const s of stopped) {
    await emitEvent(tx, {
      type: 'time_entry.recorded',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'task', id: s.taskId },
      clientId: s.clientId,
      payload: { taskId: s.taskId, clientId: s.clientId, minutes: s.minutes },
    });
  }
  return stopped;
}

export const startTimerAction = defineAction({
  input: startTimerSchema,
  side: 'agency',
  permission: 'tasks:read',
  async handler({ input, tx, ctx }) {
    const task = await loadTask(tx, input.taskId);
    await stopRunning(tx, ctx);
    const [row] = await tx
      .insert(timeEntries)
      .values({
        taskId: task.id,
        userId: ctx.session.userId,
        organizationId: ctx.organization.id,
        clientId: task.clientId,
        source: 'timer',
      })
      .returning({ id: timeEntries.id, startedAt: timeEntries.startedAt });
    return { entryId: row!.id, startedAt: row!.startedAt.toISOString() };
  },
});

export const stopTimerAction = defineAction({
  input: z.object({}),
  side: 'agency',
  permission: 'tasks:read',
  async handler({ tx, ctx }) {
    const stopped = await stopRunning(tx, ctx);
    return { minutes: stopped[0]?.minutes ?? 0, taskId: stopped[0]?.taskId ?? null };
  },
});

export const addManualTimeAction = defineAction({
  input: manualTimeSchema,
  side: 'agency',
  permission: 'tasks:read',
  async handler({ input, tx, ctx }) {
    const task = await loadTask(tx, input.taskId);
    const startedAt = new Date(`${input.date}T09:00:00+03:00`);
    await tx.insert(timeEntries).values({
      taskId: task.id,
      userId: ctx.session.userId,
      organizationId: ctx.organization.id,
      clientId: task.clientId,
      source: 'manual',
      startedAt,
      endedAt: startedAt,
      minutes: input.minutes,
      note: input.note ?? '',
    });
    await emitEvent(tx, {
      type: 'time_entry.recorded',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'task', id: task.id },
      clientId: task.clientId,
      payload: { taskId: task.id, clientId: task.clientId, minutes: input.minutes },
    });
    return null;
  },
});

export const deleteTimeEntryAction = defineAction({
  input: z.object({ entryId: z.uuid() }),
  side: 'agency',
  permission: 'tasks:read',
  async handler({ input, tx }) {
    const [row] = await tx.delete(timeEntries).where(eq(timeEntries.id, input.entryId)).returning({ id: timeEntries.id });
    if (!row) throw new ActionFailure('not_found');
    return null;
  },
});

export const getRunningTimerAction = defineAction({
  input: z.object({}),
  side: 'agency',
  permission: 'tasks:read',
  async handler({ ctx }) {
    return getRunningTimer(ctx.session.userId);
  },
});

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

export const saveViewAction = defineAction({
  input: savedViewSchema,
  side: 'agency',
  permission: 'tasks:read',
  async handler({ input, tx, ctx }) {
    const values = { name: input.name, layout: input.layout, isShared: input.isShared, config: input.config };
    if (input.viewId) {
      const [row] = await tx.update(savedViews).set(values).where(eq(savedViews.id, input.viewId)).returning({ id: savedViews.id });
      if (!row) throw new ActionFailure('not_found');
      return { viewId: row.id };
    }
    const [row] = await tx
      .insert(savedViews)
      .values({ ...values, organizationId: ctx.organization.id, ownerId: ctx.session.userId })
      .returning({ id: savedViews.id });
    return { viewId: row!.id };
  },
  revalidate: ['/tasks'],
});

export const deleteViewAction = defineAction({
  input: z.object({ viewId: z.uuid() }),
  side: 'agency',
  permission: 'tasks:read',
  async handler({ input, tx }) {
    const [row] = await tx.delete(savedViews).where(eq(savedViews.id, input.viewId)).returning({ id: savedViews.id });
    if (!row) throw new ActionFailure('not_found');
    return null;
  },
  revalidate: ['/tasks'],
});
