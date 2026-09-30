'use client';

import { Lock, MoreHorizontal } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { createContext, useContext } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { localized, type Locale } from '@/lib/i18n/localized';
import { taskAccess, type TaskEditContext } from '@/modules/tasks/access';
import type { StatusOption } from '@/modules/tasks/components/badges';
import { taskPriorities, type TaskPriority } from '@/modules/tasks/constants';
import type { TaskPatch } from '@/modules/tasks/schemas';
import type { TaskListItem } from '@/modules/tasks/server/queries';

/** What board cards need to offer quick edits (FR1.4). */
export const BoardEditContext = createContext<{
  edit: TaskEditContext;
  statuses: StatusOption[];
  onPatch: (taskId: string, patch: TaskPatch) => void;
} | null>(null);

export function useCardAccess(task: TaskListItem) {
  const board = useContext(BoardEditContext);
  return board ? taskAccess(task, board.edit) : 'none';
}

/** The Kanban card's quick menu: status for anyone who may move the card, priority only with full access. */
export function CardQuickMenu({ task }: { task: TaskListItem }) {
  const t = useTranslations('tasks');
  const tr = useTranslations('requests');
  const locale = useLocale() as Locale;
  const board = useContext(BoardEditContext);
  const access = useCardAccess(task);
  if (!board || access === 'none') return null;
  const stop = {
    onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
    onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
    onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  };
  return (
    <span {...stop} className="-me-1 -mt-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={t('quickMenu', { title: task.title })}
            data-testid="card-menu"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>{t('fields.status')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={task.statusId} onValueChange={(v) => board.onPatch(task.id, { statusId: v })}>
            {board.statuses.map((s) => (
              <DropdownMenuRadioItem key={s.id} value={s.id} data-testid="card-menu-status">
                {localized(s.name, locale)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="flex items-center gap-1">
            {t('fields.priority')}
            {access !== 'full' ? <Lock className="size-3" aria-label={t('access.limited')} /> : null}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={task.priority}
            onValueChange={(v) => access === 'full' && board.onPatch(task.id, { priority: v as TaskPriority })}
          >
            {taskPriorities.map((p) => (
              <DropdownMenuRadioItem key={p} value={p} disabled={access !== 'full'} data-testid="card-menu-priority">
                {tr(`priorities.${p}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
