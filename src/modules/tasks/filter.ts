import { endOfWeek, priorityRank, type Grouping, type SavedViewConfig, type SortKey } from '@/modules/tasks/constants';

/** The fields filtering, sorting and grouping need (a subset of `TaskListItem`, so tests can build them cheaply). */
export type FilterableTask = {
  id: string;
  number: number;
  title: string;
  clientId: string;
  statusId: string;
  statusCategory: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  dueDate: string | null;
  tags: string[];
  departmentId: string | null;
  reviewerId: string | null;
  parentId: string | null;
  requestReference?: string | null;
  assignees: { id: string }[];
  createdAt: string;
  updatedAt: string;
};

/** Done tasks (last 30 days) show by default; a view hides them with `showDone: false`. */
export const showsDone = (config: SavedViewConfig) => config.showDone !== false;

/** Applies a view's filters. Subtasks show up only through their parent unless a search targets them. */
export function applyFilters<T extends FilterableTask>(tasks: T[], config: SavedViewConfig, me: string, today: string): T[] {
  const q = (config.q ?? '').trim().toLowerCase();
  const week = endOfWeek(today);
  return tasks.filter((t) => {
    if (t.parentId && !q) return false;
    if (!showsDone(config) && t.statusCategory === 'done') return false;
    if (q && !`${t.title} t-${t.number} ${t.requestReference ?? ''} ${t.tags.join(' ')}`.toLowerCase().includes(q)) return false;
    if (config.statusIds?.length && !config.statusIds.includes(t.statusId)) return false;
    if (config.clientIds?.length && !config.clientIds.includes(t.clientId)) return false;
    if (config.priorities?.length && !config.priorities.includes(t.priority)) return false;
    if (config.departmentIds?.length && (!t.departmentId || !config.departmentIds.includes(t.departmentId))) return false;
    if (config.tags?.length && !config.tags.some((tag) => t.tags.includes(tag))) return false;
    if (config.assigneeIds?.length) {
      const unassigned = config.assigneeIds.includes('none') && t.assignees.length === 0;
      if (!unassigned && !t.assignees.some((a) => config.assigneeIds!.includes(a.id))) return false;
    }
    if (config.mine && !t.assignees.some((a) => a.id === me) && t.reviewerId !== me) return false;
    switch (config.due ?? 'any') {
      case 'overdue':
        if (!t.dueDate || t.dueDate >= today || t.statusCategory === 'done') return false;
        break;
      case 'today':
        if (t.dueDate !== today) return false;
        break;
      case 'week':
        if (!t.dueDate || t.dueDate < today || t.dueDate > week) return false;
        break;
      case 'none':
        if (t.dueDate) return false;
        break;
    }
    return true;
  });
}

export function sortTasks<T extends FilterableTask>(tasks: T[], key: SortKey = 'due', dir: 'asc' | 'desc' = 'asc'): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  const cmp = (a: T, b: T): number => {
    switch (key) {
      case 'due':
        // No due date sorts last in both directions.
        if (a.dueDate === b.dueDate) return priorityRank[a.priority] - priorityRank[b.priority];
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return sign * a.dueDate.localeCompare(b.dueDate);
      case 'priority':
        return sign * (priorityRank[a.priority] - priorityRank[b.priority]) || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9');
      case 'created':
        return sign * a.createdAt.localeCompare(b.createdAt);
      case 'updated':
        return sign * a.updatedAt.localeCompare(b.updatedAt);
      case 'title':
        return sign * a.title.localeCompare(b.title);
      case 'number':
        return sign * (a.number - b.number);
    }
  };
  return [...tasks].sort(cmp);
}

export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none';

export function dueBucket(dueDate: string | null, today: string): DueBucket {
  if (!dueDate) return 'none';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  if (dueDate <= endOfWeek(today)) return 'week';
  return 'later';
}

/** Groups tasks by a dimension; a task with several assignees appears under each of them. */
export function groupTasks<T extends FilterableTask>(tasks: T[], by: Grouping, today: string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  const push = (key: string, t: T) => out.set(key, [...(out.get(key) ?? []), t]);
  for (const t of tasks) {
    switch (by) {
      case 'none':
        push('all', t);
        break;
      case 'status':
        push(t.statusId, t);
        break;
      case 'client':
        push(t.clientId, t);
        break;
      case 'priority':
        push(t.priority, t);
        break;
      case 'due':
        push(dueBucket(t.dueDate, today), t);
        break;
      case 'assignee':
        if (t.assignees.length === 0) push('none', t);
        else t.assignees.forEach((a) => push(a.id, t));
        break;
    }
  }
  return out;
}

/** Number of active filters (for the toolbar badge). */
export function activeFilterCount(config: SavedViewConfig): number {
  return [
    config.statusIds?.length,
    config.clientIds?.length,
    config.assigneeIds?.length,
    config.priorities?.length,
    config.departmentIds?.length,
    config.tags?.length,
    config.due && config.due !== 'any' ? 1 : 0,
    config.mine ? 1 : 0,
    showsDone(config) ? 0 : 1,
  ].filter(Boolean).length;
}
