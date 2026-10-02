'use server';

import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { Tx } from '@/lib/db/client';
import { requests, taskDependencies, taskStatuses, tasks, workflowTemplateSteps, workflowTemplates } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { isLocale } from '@/lib/i18n/localized';
import { addWorkingDays } from '@/modules/requests/constants';
import { dayInZone } from '@/modules/tasks/constants';
import { createFromPlan, planFromTemplate } from '@/modules/workflows/generate';
import {
  addRequestTaskSchema,
  convertSchema,
  saveStatusesSchema,
  saveStepsSchema,
  templateSettingsSchema,
} from '@/modules/workflows/schemas';
import { templatesForRequestType, type TemplateDetail } from '@/modules/workflows/server/queries';
import { convertRequest } from '@/modules/workflows/server/services';

// ---------------------------------------------------------------------------
// Templates (workflows:manage)
// ---------------------------------------------------------------------------

async function clearOtherDefaults(tx: Tx, requestTypeId: string | null, keep: string) {
  if (!requestTypeId) return;
  await tx
    .update(workflowTemplates)
    .set({ isDefault: false })
    .where(
      and(
        eq(workflowTemplates.requestTypeId, requestTypeId),
        eq(workflowTemplates.isDefault, true),
        sql`${workflowTemplates.id} <> ${keep}`,
      ),
    );
}

export const createTemplateAction = defineAction({
  input: templateSettingsSchema,
  side: 'agency',
  permission: 'workflows:manage',
  async handler({ input, tx, ctx }) {
    const id = crypto.randomUUID();
    await clearOtherDefaults(tx, input.isDefault ? input.requestTypeId : null, id);
    await tx.insert(workflowTemplates).values({
      id,
      organizationId: ctx.organization.id,
      ...input,
      isDefault: input.isDefault && input.requestTypeId !== null,
      createdBy: ctx.session.userId,
    });
    // Every template starts with one step so it can be used right away.
    await tx.insert(workflowTemplateSteps).values({
      organizationId: ctx.organization.id,
      templateId: id,
      name: { ar: 'تنفيذ', en: 'Production' },
      assigneeMode: 'account_manager',
      slaDays: 2,
      sortOrder: 0,
    });
    await emitEvent(tx, {
      type: 'workflow_template.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'workflow_template', id },
      payload: { templateId: id },
    });
    return { templateId: id };
  },
  revalidate: ['/admin/workflows'],
});

export const updateTemplateAction = defineAction({
  input: templateSettingsSchema.extend({ templateId: z.uuid() }),
  side: 'agency',
  permission: 'workflows:manage',
  async handler({ input, tx, ctx }) {
    const { templateId, ...patch } = input;
    await clearOtherDefaults(tx, patch.isDefault ? patch.requestTypeId : null, templateId);
    const [row] = await tx
      .update(workflowTemplates)
      .set({ ...patch, isDefault: patch.isDefault && patch.requestTypeId !== null })
      .where(eq(workflowTemplates.id, templateId))
      .returning({ id: workflowTemplates.id });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'workflow_template.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'workflow_template', id: templateId },
      payload: { templateId, fields: Object.keys(patch) },
    });
    return { templateId };
  },
  revalidate: (i) => ['/admin/workflows', `/admin/workflows/${i.templateId}`],
});

/**
 * Saves the builder's whole step list. Step ids are kept (generated tasks reference them), removed steps are
 * deleted; dependencies are validated again by a deferred trigger at commit.
 */
export const saveTemplateStepsAction = defineAction({
  input: saveStepsSchema,
  side: 'agency',
  permission: 'workflows:manage',
  async handler({ input, tx, ctx }) {
    const [template] = await tx
      .select({ id: workflowTemplates.id })
      .from(workflowTemplates)
      .where(eq(workflowTemplates.id, input.templateId));
    if (!template) throw new ActionFailure('not_found');
    const ids = input.steps.map((s) => s.id);
    await tx
      .delete(workflowTemplateSteps)
      .where(and(eq(workflowTemplateSteps.templateId, input.templateId), notInArray(workflowTemplateSteps.id, ids)));
    const existing = await tx
      .select({ id: workflowTemplateSteps.id, templateId: workflowTemplateSteps.templateId })
      .from(workflowTemplateSteps)
      .where(inArray(workflowTemplateSteps.id, ids));
    if (existing.some((e) => e.templateId !== input.templateId)) throw new ActionFailure('validation');
    const known = new Set(existing.map((e) => e.id));
    for (const [i, s] of input.steps.entries()) {
      const values = {
        name: s.name,
        description: s.description,
        departmentId: s.departmentId,
        assigneeMode: s.assigneeMode,
        assigneeRoleId: s.assigneeMode === 'role' ? s.assigneeRoleId : null,
        assigneeUserId: s.assigneeMode === 'user' ? s.assigneeUserId : null,
        slaDays: s.slaDays,
        dependsOn: s.dependsOn,
        requiresInternalReview: s.requiresInternalReview,
        requiresClientApproval: s.requiresClientApproval,
        deliverableType: s.deliverableType,
        sortOrder: i,
      };
      if (known.has(s.id)) await tx.update(workflowTemplateSteps).set(values).where(eq(workflowTemplateSteps.id, s.id));
      else
        await tx
          .insert(workflowTemplateSteps)
          .values({ id: s.id, organizationId: ctx.organization.id, templateId: input.templateId, ...values });
    }
    // Fire the deferred dependency check now so a bad graph returns a clean error instead of failing at commit.
    await tx.execute(sql`set constraints all immediate`);
    await tx.update(workflowTemplates).set({ updatedAt: new Date() }).where(eq(workflowTemplates.id, input.templateId));
    await emitEvent(tx, {
      type: 'workflow_template.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'workflow_template', id: input.templateId },
      payload: { templateId: input.templateId, fields: ['steps'] },
    });
    return { templateId: input.templateId };
  },
  revalidate: (i) => ['/admin/workflows', `/admin/workflows/${i.templateId}`],
});

// ---------------------------------------------------------------------------
// Task statuses (workflows:manage)
// ---------------------------------------------------------------------------

export const saveTaskStatusesAction = defineAction({
  input: saveStatusesSchema,
  side: 'agency',
  permission: 'workflows:manage',
  async handler({ input, tx, ctx }) {
    const keep = input.statuses.map((s) => s.id).filter(Boolean) as string[];
    // Only one default at a time (unique index): clear it first, then write in order.
    await tx.update(taskStatuses).set({ isDefault: false }).where(eq(taskStatuses.isDefault, true));
    if (keep.length) await tx.delete(taskStatuses).where(notInArray(taskStatuses.id, keep));
    else await tx.delete(taskStatuses);
    const ids: string[] = [];
    for (const [i, s] of input.statuses.entries()) {
      const values = { name: s.name, category: s.category, color: s.color, isDefault: s.isDefault, sortOrder: i + 1 };
      if (s.id) {
        const [row] = await tx.update(taskStatuses).set(values).where(eq(taskStatuses.id, s.id)).returning({ id: taskStatuses.id });
        if (!row) throw new ActionFailure('not_found');
        ids.push(row.id);
      } else {
        const [row] = await tx
          .insert(taskStatuses)
          .values({ organizationId: ctx.organization.id, key: `custom_${crypto.randomUUID().slice(0, 8)}`, ...values })
          .returning({ id: taskStatuses.id });
        ids.push(row!.id);
      }
    }
    await tx.execute(sql`set constraints all immediate`);
    await emitEvent(tx, {
      type: 'task_statuses.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'task_statuses' },
      payload: { statusIds: ids },
    });
    return { statusIds: ids };
  },
  revalidate: ['/admin/workflows', '/tasks', '/my-work'],
});

// ---------------------------------------------------------------------------
// Convert a request into tasks (tasks:create; the request's own transition rules still apply)
// ---------------------------------------------------------------------------

/** The plan a template proposes for a request, for the review step (nothing is written). */
export const previewConversionAction = defineAction({
  input: convertSchema.pick({ requestId: true, templateId: true, startDate: true }),
  side: 'agency',
  permission: 'tasks:create',
  async handler({ input, tx, ctx }) {
    const [request] = await tx.select().from(requests).where(eq(requests.id, input.requestId));
    if (!request) throw new ActionFailure('not_found');
    if (request.convertedAt) throw new ActionFailure('already_converted');
    const [template] = await tx
      .select({ id: workflowTemplates.id, isActive: workflowTemplates.isActive })
      .from(workflowTemplates)
      .where(eq(workflowTemplates.id, input.templateId));
    if (!template?.isActive) throw new ActionFailure('not_found');
    const start = input.startDate ?? dayInZone(new Date(), ctx.organization.defaultTimezone);
    try {
      const items = await planFromTemplate(tx, {
        organizationId: ctx.organization.id,
        locale: isLocale(ctx.organization.defaultLocale) ? ctx.organization.defaultLocale : 'ar',
        request: { id: request.id, clientId: request.clientId, title: request.title, priority: request.priority },
        templateId: template.id,
        start,
      });
      return { start, items };
    } catch (error) {
      const message = (error as Error).message;
      if (message === 'workflow_empty' || message === 'dependency_cycle') throw new ActionFailure(message);
      throw error;
    }
  },
});

/**
 * Adds a task to a converted request, outside its workflow (FR1.3). Unless dates are given, it starts when the last
 * task it waits for is due (or today) and lasts `durationDays` working days; request progress includes it.
 */
export const addRequestTaskAction = defineAction({
  input: addRequestTaskSchema,
  side: 'agency',
  permission: 'tasks:create',
  async handler({ input, tx, ctx }) {
    const [request] = await tx.select().from(requests).where(eq(requests.id, input.requestId));
    if (!request) throw new ActionFailure('not_found');
    const blockers = input.dependsOn.length
      ? await tx
          .select({ id: tasks.id, dueDate: tasks.dueDate })
          .from(tasks)
          .where(and(inArray(tasks.id, input.dependsOn), eq(tasks.requestId, request.id)))
      : [];
    if (blockers.length !== input.dependsOn.length) throw new ActionFailure('validation');
    const today = dayInZone(new Date(), ctx.organization.defaultTimezone);
    const startDate = input.startDate ?? blockers.reduce((max, b) => (b.dueDate && b.dueDate > max ? b.dueDate : max), today);
    const dueDate = input.dueDate ?? addWorkingDays(startDate, input.durationDays);
    if (dueDate < startDate) throw new ActionFailure('validation');
    const locale = isLocale(ctx.organization.defaultLocale) ? ctx.organization.defaultLocale : 'ar';
    const created = await createFromPlan(tx, {
      organizationId: ctx.organization.id,
      request: { id: request.id, clientId: request.clientId, title: request.title },
      templateId: null,
      items: [
        {
          key: 'new',
          stepId: null,
          title: input.title,
          departmentId: input.departmentId,
          assigneeId: input.assigneeId,
          reviewerId: input.reviewerId,
          priority: input.priority,
          durationDays: input.durationDays,
          startDate,
          dueDate,
          manualDates: true,
          dependsOn: [],
          deliverableType: null,
          requiresInternalReview: Boolean(input.reviewerId),
          requiresClientApproval: false,
        },
      ],
      createdBy: ctx.session.userId,
      locale,
    });
    const taskId = created.taskIds[0]!;
    if (blockers.length) {
      await tx
        .insert(taskDependencies)
        .values(blockers.map((b) => ({ taskId, dependsOnId: b.id, organizationId: ctx.organization.id, clientId: request.clientId })));
    }
    await emitEvent(tx, {
      type: 'task.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'task', id: taskId },
      clientId: request.clientId,
      payload: { taskId, clientId: request.clientId, parentId: null },
    });
    if (input.assigneeId) {
      await emitEvent(tx, {
        type: 'task.assigned',
        organizationId: ctx.organization.id,
        actorId: ctx.session.userId,
        aggregate: { type: 'task', id: taskId },
        clientId: request.clientId,
        payload: { taskId, clientId: request.clientId, userIds: [input.assigneeId] },
      });
    }
    return { taskId, requestId: request.id };
  },
  revalidate: (_i, r) => [`/requests/${r.requestId}`, '/tasks', '/my-work', `/portal/requests/${r.requestId}`],
});

export const convertRequestToTasksAction = defineAction({
  input: convertSchema,
  side: 'agency',
  permission: 'tasks:create',
  async handler({ input, tx, ctx }) {
    return convertRequest(tx, ctx, input);
  },
  revalidate: (_i, r) => [
    '/requests',
    `/requests/${r.requestId}`,
    '/tasks',
    '/my-work',
    `/portal/requests/${r.requestId}`,
    '/portal/requests',
  ],
});

/** Workflows offered for a request type (inbox preview drawer loads them on demand). */
export const convertTemplatesAction = defineAction({
  input: z.object({ requestTypeId: z.uuid() }),
  side: 'agency',
  permission: 'tasks:create',
  async handler({ input }): Promise<TemplateDetail[]> {
    return templatesForRequestType(input.requestTypeId);
  },
});
