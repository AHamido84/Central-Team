import { z } from 'zod';

import { dueFilters, groupings, MAX_TAGS, sortKeys, swimlanes, taskLayouts, taskPriorities } from '@/modules/tasks/constants';

const date = z.iso.date({ message: 'invalid_date' });
const tag = z
  .string()
  .trim()
  .min(1)
  .max(30, { message: 'too_long' })
  .transform((v) => v.toLowerCase().replace(/\s+/g, '-'));

export const taskTitleSchema = z.string().trim().min(1, { message: 'required' }).max(200, { message: 'too_long' });

export const createTaskSchema = z.object({
  clientId: z.uuid(),
  title: taskTitleSchema,
  description: z.string().max(20000, { message: 'too_long' }).optional(),
  statusId: z.uuid().optional(),
  priority: z.enum(taskPriorities).optional(),
  dueDate: date.nullable().optional(),
  assigneeIds: z.array(z.uuid()).max(10).optional(),
  parentId: z.uuid().optional(),
  requestId: z.uuid().optional(),
  departmentId: z.uuid().nullable().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const taskPatchSchema = z
  .object({
    title: taskTitleSchema,
    description: z.string().max(20000, { message: 'too_long' }),
    statusId: z.uuid(),
    priority: z.enum(taskPriorities),
    startDate: date.nullable(),
    dueDate: date.nullable(),
    estimateMinutes: z.number().int().min(0).max(100000).nullable(),
    tags: z.array(tag).max(MAX_TAGS),
    departmentId: z.uuid().nullable(),
    reviewerId: z.uuid().nullable(),
  })
  .partial();
export type TaskPatch = z.infer<typeof taskPatchSchema>;

export const updateTaskSchema = z
  .object({ taskId: z.uuid(), patch: taskPatchSchema })
  .refine((v) => !v.patch.startDate || !v.patch.dueDate || v.patch.startDate <= v.patch.dueDate, {
    message: 'dates_order',
    path: ['patch', 'dueDate'],
  });

export const moveTaskSchema = z.object({ taskId: z.uuid(), statusId: z.uuid(), position: z.number().finite() });

export const bulkTasksSchema = z.object({
  taskIds: z.array(z.uuid()).min(1).max(200),
  statusId: z.uuid().optional(),
  priority: z.enum(taskPriorities).optional(),
  dueDate: date.nullable().optional(),
  /** Adds this person as an assignee (keeps existing ones). */
  assigneeId: z.uuid().optional(),
  delete: z.boolean().optional(),
});

export const setMembersSchema = z.object({
  taskId: z.uuid(),
  role: z.enum(['assignee', 'watcher']),
  userIds: z.array(z.uuid()).max(15),
});

export const dependencySchema = z.object({ taskId: z.uuid(), dependsOnId: z.uuid(), remove: z.boolean().optional() });

export const checklistAddSchema = z.object({ taskId: z.uuid(), body: z.string().trim().min(1, { message: 'required' }).max(300) });
export const checklistUpdateSchema = z.object({
  itemId: z.uuid(),
  body: z.string().trim().min(1, { message: 'required' }).max(300).optional(),
  isDone: z.boolean().optional(),
  remove: z.boolean().optional(),
});

export const attachmentsSchema = z.object({ taskId: z.uuid(), fileIds: z.array(z.uuid()).min(1).max(10) });
export const removeAttachmentSchema = z.object({ taskId: z.uuid(), fileId: z.uuid() });

export const startTimerSchema = z.object({ taskId: z.uuid() });
export const manualTimeSchema = z.object({
  taskId: z.uuid(),
  date,
  minutes: z.number().int().min(1, { message: 'number_min' }).max(1440, { message: 'number_max' }),
  note: z.string().trim().max(500, { message: 'too_long' }).optional(),
});

export const savedViewConfigSchema = z.object({
  q: z.string().max(100).optional(),
  statusIds: z.array(z.uuid()).max(20).optional(),
  clientIds: z.array(z.uuid()).max(50).optional(),
  assigneeIds: z.array(z.uuid()).max(50).optional(),
  priorities: z.array(z.enum(taskPriorities)).max(4).optional(),
  departmentIds: z.array(z.uuid()).max(20).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
  due: z.enum(dueFilters).optional(),
  mine: z.boolean().optional(),
  showDone: z.boolean().optional(),
  swimlane: z.enum(swimlanes).optional(),
  groupBy: z.enum(groupings).optional(),
  sort: z.enum(sortKeys).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

export const savedViewSchema = z.object({
  viewId: z.uuid().optional(),
  name: z.string().trim().min(1, { message: 'required' }).max(60, { message: 'too_long' }),
  layout: z.enum(taskLayouts),
  isShared: z.boolean(),
  config: savedViewConfigSchema,
});
