/** Status categories drive behaviour; organizations name their statuses freely (ADR-036). */
export const statusCategories = ['todo', 'active', 'review', 'changes', 'blocked', 'done'] as const;
export type StatusCategory = (typeof statusCategories)[number];
export const openCategories: readonly StatusCategory[] = ['todo', 'active', 'review', 'changes', 'blocked'];

export const statusColors = ['neutral', 'info', 'primary', 'accent', 'warning', 'danger', 'success'] as const;
export type StatusColor = (typeof statusColors)[number];

export const taskPriorities = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof taskPriorities)[number];
export const priorityRank: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export const taskLayouts = ['board', 'list', 'table', 'calendar'] as const;
export type TaskLayout = (typeof taskLayouts)[number];

export const swimlanes = ['none', 'assignee', 'client'] as const;
export type Swimlane = (typeof swimlanes)[number];

export const groupings = ['none', 'status', 'client', 'assignee', 'priority', 'due'] as const;
export type Grouping = (typeof groupings)[number];

export const sortKeys = ['due', 'priority', 'created', 'updated', 'title', 'number'] as const;
export type SortKey = (typeof sortKeys)[number];

export const dueFilters = ['any', 'overdue', 'today', 'week', 'none'] as const;
export type DueFilter = (typeof dueFilters)[number];

/** Filters + presentation saved with a view (and mirrored in the URL). */
export type SavedViewConfig = {
  q?: string;
  statusIds?: string[];
  clientIds?: string[];
  assigneeIds?: string[];
  priorities?: TaskPriority[];
  departmentIds?: string[];
  tags?: string[];
  due?: DueFilter;
  mine?: boolean;
  showDone?: boolean;
  swimlane?: Swimlane;
  groupBy?: Grouping;
  sort?: SortKey;
  sortDir?: 'asc' | 'desc';
};

export const myWorkSections = ['overdue', 'today', 'week', 'waiting', 'later'] as const;
export type MyWorkSection = (typeof myWorkSections)[number];

export const MAX_TAGS = 10;

/** `T-123` */
export function taskReference(n: number) {
  return `T-${n}`;
}

/** YYYY-MM-DD of `d` in the given IANA time zone. */
export function dayInZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** End of the Sunday-based week containing `day` (Saturday). */
export function endOfWeek(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return addDays(day, 6 - d.getUTCDay());
}

type DueTask = { dueDate: string | null; statusCategory: StatusCategory };

export function isOverdue(t: DueTask, today: string) {
  return t.statusCategory !== 'done' && t.dueDate !== null && t.dueDate < today;
}

/**
 * My Work buckets. "Waiting on me" = work parked on the user as reviewer; everything else is bucketed by due date.
 */
export function myWorkSection(t: DueTask & { isAssignee: boolean; isReviewer: boolean }, today: string): MyWorkSection | null {
  if (t.statusCategory === 'done') return null;
  if (t.isReviewer && t.statusCategory === 'review') return 'waiting';
  if (!t.isAssignee) return null;
  if (t.dueDate === null) return 'later';
  if (t.dueDate < today) return 'overdue';
  if (t.dueDate === today) return 'today';
  if (t.dueDate <= endOfWeek(today)) return 'week';
  return 'later';
}

/** A fractional position between two neighbours (board ordering). */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1000;
  if (before === null) return (after as number) - 1000;
  if (after === null) return before + 1000;
  return (before + after) / 2;
}

/** Minutes → "1h 30m" parts (formatted by the UI). */
export function splitMinutes(total: number) {
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** Minutes a running or finished timer covers (rounded up to the minute, at least 1). */
export function timerMinutes(startedAt: string | Date, endedAt: string | Date) {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return Math.min(1440, Math.max(1, Math.ceil(ms / 60000)));
}
