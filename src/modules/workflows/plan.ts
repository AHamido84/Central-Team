import { z } from 'zod';

import { addWorkingDays } from '@/modules/requests/constants';
import { taskPriorities, type TaskPriority } from '@/modules/tasks/constants';
import { deliverableTypes, orderSteps, type DeliverableType } from '@/modules/workflows/constants';

/**
 * A conversion plan (FR1.3): the tasks a request will get, reviewed and edited before anything is created. Items come
 * from the workflow's steps (`stepId`) or are added by hand (`stepId: null` — "outside the workflow"). Shared by the
 * review screen and the server, which validates it again and creates exactly what was reviewed.
 */
export type PlanItem = {
  /** Stable id within the plan (step id for workflow items, a random id for added ones). */
  key: string;
  stepId: string | null;
  title: string;
  departmentId: string | null;
  assigneeId: string | null;
  reviewerId: string | null;
  priority: TaskPriority;
  /** Working days; drives the dates unless they were set by hand. */
  durationDays: number;
  startDate: string;
  dueDate: string;
  /** Dates typed by the user are kept when the plan is rescheduled. */
  manualDates: boolean;
  dependsOn: string[];
  deliverableType: DeliverableType | null;
  requiresInternalReview: boolean;
  requiresClientApproval: boolean;
};

export const MAX_PLAN_ITEMS = 40;

const day = z.iso.date({ message: 'invalid_date' });

export const planItemSchema = z
  .object({
    key: z.string().min(1).max(64),
    stepId: z.uuid().nullable(),
    title: z.string().trim().min(1, { message: 'required' }).max(200, { message: 'too_long' }),
    departmentId: z.uuid().nullable(),
    assigneeId: z.uuid().nullable(),
    reviewerId: z.uuid().nullable(),
    priority: z.enum(taskPriorities),
    durationDays: z.number().int().min(0).max(365),
    startDate: day,
    dueDate: day,
    manualDates: z.boolean(),
    dependsOn: z.array(z.string().min(1).max(64)).max(MAX_PLAN_ITEMS),
    deliverableType: z.enum(deliverableTypes).nullable(),
    requiresInternalReview: z.boolean(),
    requiresClientApproval: z.boolean(),
  })
  .refine((i) => i.startDate <= i.dueDate, { message: 'invalid_date_range', path: ['dueDate'] });

export const planSchema = z
  .array(planItemSchema)
  .min(1, { message: 'min_one' })
  .max(MAX_PLAN_ITEMS)
  .refine((items) => new Set(items.map((i) => i.key)).size === items.length, { message: 'duplicate' })
  .refine((items) => orderPlan(items) !== null, { message: 'dependency_cycle' });

/** Items in dependency order (stable by their position); null on an unknown dependency or a cycle. */
export function orderPlan<T extends Pick<PlanItem, 'key' | 'dependsOn'>>(items: T[]): T[] | null {
  const ordered = orderSteps(items.map((i, index) => ({ ...i, id: i.key, slaDays: 0, sortOrder: index })));
  return ordered ? ordered.map(({ id: _id, slaDays: _s, sortOrder: _o, ...rest }) => rest as unknown as T) : null;
}

/**
 * Recomputes dates after an edit: an item starts when the last item it depends on is due (or on `start`) and takes
 * `durationDays` working days. Items with hand-set dates keep them (their due date still feeds their dependents).
 */
export function schedulePlan(items: PlanItem[], start: string): PlanItem[] {
  const ordered = orderPlan(items);
  if (!ordered) return items;
  const due = new Map<string, string>();
  const next = new Map<string, PlanItem>();
  for (const item of ordered) {
    if (item.manualDates) {
      next.set(item.key, item);
      due.set(item.key, item.dueDate);
      continue;
    }
    const startDate = item.dependsOn.reduce((max, d) => {
      const dd = due.get(d);
      return dd && dd > max ? dd : max;
    }, start);
    const dueDate = addWorkingDays(startDate, item.durationDays);
    next.set(item.key, { ...item, startDate, dueDate });
    due.set(item.key, dueDate);
  }
  return items.map((i) => next.get(i.key) ?? i);
}

/** Items that transitively depend on `key` (the dependency picker hides them to prevent cycles). */
export function planDependents(items: Pick<PlanItem, 'key' | 'dependsOn'>[], key: string): Set<string> {
  const out = new Set<string>();
  let frontier = [key];
  while (frontier.length) {
    const found = items.filter((i) => i.dependsOn.some((d) => frontier.includes(d)) && !out.has(i.key)).map((i) => i.key);
    found.forEach((k) => out.add(k));
    frontier = found;
  }
  return out;
}
