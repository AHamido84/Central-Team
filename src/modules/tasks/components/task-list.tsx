'use client';

import { ChevronDown, Lock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { memo, useState } from 'react';

import { useFormat } from '@/components/providers';
import { AvatarGroup } from '@/components/ui/primitives';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { DeliverableStatusBadge } from '@/modules/deliverables/components/badges';
import { PriorityBadge } from '@/modules/requests/components/badges';
import { categoryIcon, DueDate, statusDot, TaskRef, type StatusOption } from '@/modules/tasks/components/badges';
import type { Grouping } from '@/modules/tasks/constants';
import { groupTasks } from '@/modules/tasks/filter';
import type { TaskListItem } from '@/modules/tasks/server/queries';

export function useGroupLabel(
  statuses: StatusOption[],
  clients: { id: string; name: LocalizedText }[],
  people: { id: string; name: string }[],
) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  return (by: Grouping, key: string): { label: string; dot?: string } => {
    switch (by) {
      case 'status': {
        const s = statuses.find((x) => x.id === key);
        return { label: s ? localized(s.name, locale) : key, dot: s ? statusDot[s.color] : undefined };
      }
      case 'client':
        return { label: localized(clients.find((c) => c.id === key)?.name ?? {}, locale) };
      case 'assignee':
        return { label: key === 'none' ? t('tasks.unassigned') : (people.find((p) => p.id === key)?.name ?? '') };
      case 'priority':
        return { label: t(`requests.priorities.${key as 'low'}`) };
      case 'due':
        return { label: t(`tasks.dueBuckets.${key as 'overdue'}`) };
      default:
        return { label: t('tasks.allTasks') };
    }
  };
}

/** Ordered group keys: statuses follow the org's order, due buckets follow time, the rest alphabetically. */
export function orderedGroups<T>(
  groups: Map<string, T[]>,
  by: Grouping,
  statuses: StatusOption[],
  labelOf: (key: string) => string,
): [string, T[]][] {
  const entries = [...groups.entries()];
  if (by === 'status') return statuses.filter((s) => groups.has(s.id)).map((s) => [s.id, groups.get(s.id)!]);
  if (by === 'due')
    return (['overdue', 'today', 'week', 'later', 'none'] as const).filter((k) => groups.has(k)).map((k) => [k, groups.get(k)!]);
  if (by === 'priority') return (['urgent', 'high', 'normal', 'low'] as const).filter((k) => groups.has(k)).map((k) => [k, groups.get(k)!]);
  return entries.sort((a, b) => Number(a[0] === 'none') - Number(b[0] === 'none') || labelOf(a[0]).localeCompare(labelOf(b[0])));
}

const Row = memo(function Row({
  task,
  status,
  today,
  onOpen,
  onToggleDone,
}: {
  task: TaskListItem;
  status: StatusOption | undefined;
  today: string;
  onOpen: (id: string) => void;
  onToggleDone?: (task: TaskListItem) => void;
}) {
  const t = useTranslations('tasks');
  const locale = useLocale() as Locale;
  const done = task.statusCategory === 'done';
  const Icon = status ? categoryIcon[status.category] : categoryIcon.todo;
  return (
    <li
      className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-surface-muted/60"
      data-testid="task-row"
      data-task-id={task.id}
    >
      <button
        type="button"
        onClick={() => onToggleDone?.(task)}
        disabled={!onToggleDone}
        aria-label={done ? t('markNotDone') : t('markDone')}
        aria-pressed={done}
        className={cn(
          'rounded-full p-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          done ? 'text-success' : 'text-subtle-foreground hover:text-foreground',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </button>
      <button type="button" className="min-w-0 flex-1 text-start" onClick={() => onOpen(task.id)}>
        <span className={cn('block truncate text-sm font-medium', done && 'text-muted-foreground line-through')}>
          <bdi>{task.title}</bdi>
        </span>
        <span className="flex items-center gap-2 truncate text-xs text-subtle-foreground">
          <TaskRef number={task.number} />
          <span className="truncate">{localized(task.clientName, locale)}</span>
          {task.blocked ? <Lock className="size-3 text-danger" aria-label={t('blocked')} /> : null}
        </span>
      </button>
      <span className="hidden sm:inline-flex">
        {task.deliverable ? <DeliverableStatusBadge status={task.deliverable.status} compact /> : null}
      </span>
      <span className="hidden md:inline-flex">{task.priority !== 'normal' ? <PriorityBadge priority={task.priority} /> : null}</span>
      <span className="w-36 text-end whitespace-nowrap">
        <DueDate date={task.dueDate} done={done} today={today} />
      </span>
      <span className="hidden w-20 justify-end sm:flex">
        {task.assignees.length ? (
          <AvatarGroup
            people={task.assignees.map((a) => ({ id: a.id, name: a.name, src: publicAssetUrl(a.avatarPath) }))}
            size="xs"
            max={3}
          />
        ) : null}
      </span>
    </li>
  );
});

/** Compact grouped list (collapsible groups). */
export function TaskList({
  tasks,
  statuses,
  groupBy,
  clients,
  people,
  today,
  onOpen,
  onToggleDone,
}: {
  tasks: TaskListItem[];
  statuses: StatusOption[];
  groupBy: Grouping;
  clients: { id: string; name: LocalizedText }[];
  people: { id: string; name: string }[];
  today: string;
  onOpen: (id: string) => void;
  onToggleDone?: (task: TaskListItem) => void;
}) {
  const f = useFormat();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const labelOf = useGroupLabel(statuses, clients, people);
  const groups = orderedGroups(groupTasks(tasks, groupBy, today), groupBy, statuses, (k) => labelOf(groupBy, k).label);
  return (
    <div className="grid gap-4" data-testid="task-list">
      {groups.map(([key, list]) => {
        const { label, dot } = labelOf(groupBy, key);
        const isCollapsed = collapsed.has(key);
        return (
          <section key={key} className="overflow-hidden rounded-xl border border-border bg-surface">
            {groupBy !== 'none' ? (
              <button
                type="button"
                onClick={() => setCollapsed((s) => new Set(s.has(key) ? [...s].filter((x) => x !== key) : [...s, key]))}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-2 border-b border-border bg-surface-muted/60 px-3 py-2 text-start text-sm font-semibold"
              >
                <ChevronDown className={cn('size-4 transition-transform', isCollapsed && '-rotate-90 rtl:rotate-90')} aria-hidden />
                {dot ? <span className={cn('size-2 rounded-full', dot)} aria-hidden /> : null}
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span className="tabular text-xs font-normal text-muted-foreground">{f.number(list.length)}</span>
              </button>
            ) : null}
            {!isCollapsed ? (
              <ul>
                {list.map((task) => (
                  <Row
                    key={task.id}
                    task={task}
                    status={statuses.find((s) => s.id === task.statusId)}
                    today={today}
                    onOpen={onOpen}
                    onToggleDone={onToggleDone}
                  />
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
