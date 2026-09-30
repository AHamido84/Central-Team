'use client';

import { CheckSquare, GitBranch, Lock, MessageSquare } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { memo } from 'react';

import { useFormat } from '@/components/providers';
import { AvatarGroup, Badge, Tooltip } from '@/components/ui/primitives';
import { localized, type Locale } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { DeliverableStatusBadge } from '@/modules/deliverables/components/badges';
import { PriorityBadge } from '@/modules/requests/components/badges';
import { DueDate, TaskRef } from '@/modules/tasks/components/badges';
import type { TaskListItem } from '@/modules/tasks/server/queries';

/** A task on the board / calendar. Light on purpose: boards render hundreds of these. */
export const TaskCard = memo(function TaskCard({
  task,
  today,
  onOpen,
  showClient = true,
  className,
  dragging,
}: {
  task: TaskListItem;
  today: string;
  onOpen?: (id: string) => void;
  showClient?: boolean;
  className?: string;
  dragging?: boolean;
}) {
  const t = useTranslations('tasks');
  const locale = useLocale() as Locale;
  const f = useFormat();
  const done = task.statusCategory === 'done';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen?.(task.id);
      }}
      className={cn(
        'group grid cursor-pointer gap-2 rounded-lg border border-border bg-surface p-3 text-start shadow-xs transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        dragging && 'shadow-lg ring-2 ring-primary',
        done && 'opacity-75',
        className,
      )}
      data-testid="task-card"
      data-task-id={task.id}
      data-task-focus={task.id}
    >
      <div className="flex items-start gap-2">
        <p className={cn('min-w-0 flex-1 text-sm leading-snug font-medium', done && 'line-through decoration-subtle-foreground')}>
          <bdi>{task.title}</bdi>
        </p>
        {task.blocked ? (
          <Tooltip content={t('blockedHint')}>
            <Lock className="mt-0.5 size-3.5 shrink-0 text-danger" aria-label={t('blocked')} />
          </Tooltip>
        ) : null}
      </div>
      {showClient || task.requestReference ? (
        <p className="truncate text-xs text-subtle-foreground">
          {showClient ? localized(task.clientName, locale) : null}
          {showClient && task.requestReference ? ' · ' : null}
          {task.requestReference ? <bdi dir="ltr">{task.requestReference}</bdi> : null}
        </p>
      ) : null}
      {task.priority === 'high' || task.priority === 'urgent' || task.deliverable || task.tags.length ? (
        <div className="flex flex-wrap gap-1">
          {task.priority === 'high' || task.priority === 'urgent' ? <PriorityBadge priority={task.priority} /> : null}
          {task.deliverable ? <DeliverableStatusBadge status={task.deliverable.status} compact /> : null}
          {task.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} tone="outline">
              <bdi>{`#${tag}`}</bdi>
            </Badge>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-2 text-xs text-subtle-foreground">
        <TaskRef number={task.number} />
        <DueDate date={task.dueDate} done={done} today={today} />
        <span className="ms-auto flex items-center gap-2">
          {task.checklist ? (
            <span
              className="tabular inline-flex items-center gap-0.5"
              aria-label={t('checklistProgress', { done: task.checklistDone, total: task.checklist })}
            >
              <CheckSquare className="size-3.5" aria-hidden />
              {f.number(task.checklistDone)}/{f.number(task.checklist)}
            </span>
          ) : null}
          {task.subtasks ? (
            <span
              className="tabular inline-flex items-center gap-0.5"
              aria-label={t('subtaskProgress', { done: task.subtasksDone, total: task.subtasks })}
            >
              <GitBranch className="size-3.5" aria-hidden />
              {f.number(task.subtasksDone)}/{f.number(task.subtasks)}
            </span>
          ) : null}
          {task.comments ? (
            <span className="tabular inline-flex items-center gap-0.5" aria-label={t('commentCount', { count: task.comments })}>
              <MessageSquare className="size-3.5" aria-hidden />
              {f.number(task.comments)}
            </span>
          ) : null}
          {task.assignees.length ? (
            <AvatarGroup
              people={task.assignees.map((a) => ({ id: a.id, name: a.name, src: publicAssetUrl(a.avatarPath) }))}
              size="xs"
              max={3}
            />
          ) : null}
        </span>
      </div>
    </div>
  );
});
