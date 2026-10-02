'use client';

import { History } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import type { StatusOption } from '@/modules/tasks/components/badges';
import { taskReference } from '@/modules/tasks/constants';
import { loadTaskHistoryAction } from '@/modules/tasks/server/actions';
import type { TaskHistoryEntry, TaskListItem } from '@/modules/tasks/server/queries';

// Columns people care about; bookkeeping (positions, derived status, timestamps, reminders) is not shown.
const shownFields = [
  'title',
  'description',
  'status_id',
  'priority',
  'start_date',
  'due_date',
  'department_id',
  'reviewer_id',
  'estimate_minutes',
  'tags',
] as const;
const fieldLabel: Record<(typeof shownFields)[number], string> = {
  title: 'title',
  description: 'description',
  status_id: 'status',
  priority: 'priority',
  start_date: 'startDate',
  due_date: 'dueDate',
  department_id: 'department',
  reviewer_id: 'reviewer',
  estimate_minutes: 'estimate',
  tags: 'tags',
};

/** Every change to the task, its people, checklist and dependencies — loaded when opened (FR1.4). */
export function TaskHistory({
  taskId,
  statuses,
  people,
  departments,
  allTasks,
}: {
  taskId: string;
  statuses: StatusOption[];
  people: { id: string; name: string }[];
  departments: { id: string; name: LocalizedText }[];
  allTasks: TaskListItem[];
}) {
  const t = useTranslations('tasks');
  const tr = useTranslations('requests');
  const locale = useLocale() as Locale;
  const f = useFormat();
  const [entries, setEntries] = useState<TaskHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const person = (id: unknown) => people.find((p) => p.id === id)?.name ?? t('history.someone');
  const value = (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return t('history.empty_value');
    switch (field) {
      case 'status_id':
        return localized(statuses.find((s) => s.id === v)?.name ?? {}, locale) || t('history.empty_value');
      case 'department_id':
        return localized(departments.find((d) => d.id === v)?.name ?? {}, locale) || t('history.empty_value');
      case 'reviewer_id':
        return person(v);
      case 'priority':
        return tr(`priorities.${v as 'normal'}`);
      case 'start_date':
      case 'due_date':
        return f.date(`${String(v)}T12:00:00`, 'medium');
      case 'tags':
        return (v as string[]).map((x) => `#${x}`).join(' ');
      default:
        return String(v).slice(0, 60);
    }
  };
  const taskName = (id: unknown) => {
    const other = allTasks.find((x) => x.id === id);
    return other ? `${taskReference(other.number)} ${other.title}` : t('history.empty_value');
  };

  const describe = (e: TaskHistoryEntry): string[] => {
    const row = (e.after ?? e.before ?? {}) as Record<string, unknown>;
    if (e.table === 'tasks') {
      if (e.action === 'insert') return [t('history.created')];
      if (e.action === 'delete') return [t('history.deleted')];
      return shownFields
        .filter((k) => e.changedFields.includes(k))
        .map((k) => {
          const label = t(`fields.${fieldLabel[k]}` as 'fields.title');
          return k === 'description'
            ? t('history.changed', { field: label })
            : t('history.changedFromTo', { field: label, from: value(k, e.before?.[k]), to: value(k, e.after?.[k]) });
        });
    }
    if (e.table === 'task_members') {
      const role = t(`history.roles.${row.role === 'watcher' ? 'watcher' : 'assignee'}`);
      return [t(e.action === 'delete' ? 'history.removedMember' : 'history.addedMember', { name: person(row.user_id), role })];
    }
    if (e.table === 'task_checklist_items') {
      const body = String(row.body ?? '');
      if (e.action === 'insert') return [t('history.checkAdded', { body })];
      if (e.action === 'delete') return [t('history.checkRemoved', { body })];
      if (e.changedFields.includes('is_done')) return [t(row.is_done ? 'history.checkDone' : 'history.checkUndone', { body })];
      return [t('history.checkEdited', { body })];
    }
    return [t(e.action === 'delete' ? 'history.depRemoved' : 'history.depAdded', { task: taskName(row.depends_on_id) })];
  };

  if (!entries) {
    return (
      <div className="grid gap-2">
        {loading ? (
          <>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={async () => {
              setLoading(true);
              const res = await loadTaskHistoryAction({ taskId });
              setLoading(false);
              if (res.ok) setEntries(res.data);
            }}
            data-testid="history-show"
          >
            <History />
            {t('history.show')}
          </Button>
        )}
      </div>
    );
  }
  const lines = entries.flatMap((e) => describe(e).map((text, i) => ({ key: `${e.id}-${i}`, e, text })));
  if (!lines.length) return <p className="text-sm text-muted-foreground">{t('history.empty')}</p>;
  return (
    <ol className="grid gap-2" data-testid="task-history">
      {lines.map(({ key, e, text }) => (
        <li key={key} className="grid gap-0.5 text-sm" data-testid="history-entry">
          <span>
            <span className="font-medium">{e.actorName ?? t('history.someone')}</span> <span dir="auto">{text}</span>
          </span>
          <time dateTime={e.createdAt} className="text-xs text-subtle-foreground">
            {f.dateTime(e.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}
