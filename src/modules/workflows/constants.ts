import { addWorkingDays } from '@/modules/requests/constants';

export const assigneeModes = ['account_manager', 'role', 'user', 'none'] as const;
export type AssigneeMode = (typeof assigneeModes)[number];

export const deliverableTypes = ['design', 'video', 'copy', 'document', 'other'] as const;
export type DeliverableType = (typeof deliverableTypes)[number];

export const MAX_STEPS = 25;

export type StepLike = { id: string; dependsOn: string[]; slaDays: number; sortOrder: number };

/**
 * Orders steps so every step comes after the steps it depends on (stable by `sortOrder`).
 * Returns null when dependencies reference unknown steps or form a cycle.
 */
export function orderSteps<T extends StepLike>(steps: T[]): T[] | null {
  const byId = new Map(steps.map((s) => [s.id, s]));
  if (steps.some((s) => s.dependsOn.some((d) => !byId.has(d) || d === s.id))) return null;
  const sorted = [...steps].sort((a, b) => a.sortOrder - b.sortOrder);
  const done = new Set<string>();
  const out: T[] = [];
  while (out.length < sorted.length) {
    const next = sorted.find((s) => !done.has(s.id) && s.dependsOn.every((d) => done.has(d)));
    if (!next) return null;
    done.add(next.id);
    out.push(next);
  }
  return out;
}

export type ScheduledStep = { id: string; startDate: string; dueDate: string };

/**
 * Due dates for a workflow started on `start` (YYYY-MM-DD): a step starts when its last blocker is due (or on
 * `start` when it has none) and takes `slaDays` working days (Friday/Saturday off). A 0-day step is due the day it starts.
 */
export function scheduleSteps(steps: StepLike[], start: string): Map<string, ScheduledStep> | null {
  const ordered = orderSteps(steps);
  if (!ordered) return null;
  const out = new Map<string, ScheduledStep>();
  for (const s of ordered) {
    const startDate = s.dependsOn.reduce((max, d) => {
      const due = out.get(d)!.dueDate;
      return due > max ? due : max;
    }, start);
    out.set(s.id, { id: s.id, startDate, dueDate: addWorkingDays(startDate, s.slaDays) });
  }
  return out;
}

/** Steps that transitively depend on `id` (used by the dependency picker to hide choices that would form a cycle). */
export function dependents(steps: StepLike[], id: string): Set<string> {
  const out = new Set<string>();
  let frontier = [id];
  while (frontier.length) {
    const next = steps.filter((s) => s.dependsOn.some((d) => frontier.includes(d)) && !out.has(s.id)).map((s) => s.id);
    next.forEach((n) => out.add(n));
    frontier = next;
  }
  return out;
}
