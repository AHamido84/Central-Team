'use client';

import { ArrowDown, ArrowUp, ArrowUpDown, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { memo, useMemo, useState } from 'react';

import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Checkbox, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import { Limited } from '@/modules/tasks/components/show-more';
import { TaskRef, useDuration, type StatusOption } from '@/modules/tasks/components/badges';
import { PeoplePicker, type PersonOption } from '@/modules/tasks/components/people-picker';
import { orderedGroups, useGroupLabel } from '@/modules/tasks/components/task-list';
import { BulkDeleteButton } from '@/modules/data/components/bulk-delete';
import { taskPriorities, type Grouping, type SortKey, type TaskPriority } from '@/modules/tasks/constants';
import { groupTasks, sortTasks } from '@/modules/tasks/filter';
import type { TaskPatch } from '@/modules/tasks/schemas';
import { bulkUpdateTasksAction, setTaskMembersAction } from '@/modules/tasks/server/actions';
import type { TaskListItem } from '@/modules/tasks/server/queries';

type Props = {
  tasks: TaskListItem[];
  statuses: StatusOption[];
  groupBy: Grouping;
  sort: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey, dir: 'asc' | 'desc') => void;
  clients: { id: string; name: LocalizedText }[];
  people: PersonOption[];
  today: string;
  canUpdate: boolean;
  canDelete: boolean;
  onOpen: (id: string) => void;
  onPatch: (taskId: string, patch: TaskPatch) => void;
  onChanged: () => void;
};

const TableRow = memo(function TableRow({
  task,
  statuses,
  people,
  today,
  selected,
  onSelect,
  canUpdate,
  onOpen,
  onPatch,
  onChanged,
}: {
  task: TaskListItem;
  statuses: StatusOption[];
  people: PersonOption[];
  today: string;
  selected: boolean;
  onSelect: (on: boolean) => void;
  canUpdate: boolean;
  onOpen: (id: string) => void;
  onPatch: Props['onPatch'];
  onChanged: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const setMembers = useAction(setTaskMembersAction, { refresh: false });
  const duration = useDuration();
  const overdue = task.statusCategory !== 'done' && task.dueDate !== null && task.dueDate < today;
  return (
    <tr
      className={cn('border-b border-border last:border-b-0 hover:bg-surface-muted/50', selected && 'bg-primary-soft/40')}
      data-testid="task-table-row"
      data-task-id={task.id}
    >
      <td className="w-10 px-3">
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onSelect(v === true)}
          aria-label={t('tasks.table.selectTask', { title: task.title })}
        />
      </td>
      <td className="px-2 whitespace-nowrap">
        <TaskRef number={task.number} />
      </td>
      <td className="max-w-72 min-w-48 px-2 py-1.5">
        <button
          type="button"
          className="block w-full truncate text-start text-sm font-medium hover:underline"
          onClick={() => onOpen(task.id)}
          data-task-focus={task.id}
        >
          <bdi>{task.title}</bdi>
        </button>
      </td>
      <td className="max-w-40 truncate px-2 text-sm text-muted-foreground">{localized(task.clientName, locale)}</td>
      <td className="px-2">
        <NativeSelect
          value={task.statusId}
          disabled={!canUpdate}
          onChange={(e) => onPatch(task.id, { statusId: e.target.value })}
          aria-label={t('tasks.fields.status')}
          className="h-8 min-w-36 text-xs"
          data-testid="table-status"
        >
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {localized(s.name, locale)}
            </option>
          ))}
        </NativeSelect>
      </td>
      <td className="min-w-44 px-2">
        <PeoplePicker
          people={people}
          value={task.assignees.map((a) => a.id)}
          disabled={!canUpdate}
          label={t('tasks.fields.assignees')}
          onChange={async (ids) => {
            const res = await setMembers.run({ taskId: task.id, role: 'assignee', userIds: ids });
            if (res.ok) onChanged();
          }}
        />
      </td>
      <td className="px-2">
        <NativeSelect
          value={task.priority}
          disabled={!canUpdate}
          onChange={(e) => onPatch(task.id, { priority: e.target.value as TaskPriority })}
          aria-label={t('tasks.fields.priority')}
          className="h-8 min-w-28 text-xs"
        >
          {taskPriorities.map((p) => (
            <option key={p} value={p}>
              {t(`requests.priorities.${p}`)}
            </option>
          ))}
        </NativeSelect>
      </td>
      <td className="px-2">
        <Input
          type="date"
          dir="ltr"
          value={task.dueDate ?? ''}
          disabled={!canUpdate}
          onChange={(e) => onPatch(task.id, { dueDate: e.target.value || null })}
          aria-label={t('tasks.fields.dueDate')}
          className={cn('h-8 w-36 text-xs', overdue && 'border-danger/60 text-danger')}
        />
      </td>
      <td className="tabular px-2 text-sm whitespace-nowrap text-muted-foreground">
        {task.estimateMinutes ? duration(task.estimateMinutes) : '—'}
      </td>
      <td className="max-w-40 px-2">
        <div className="flex flex-wrap gap-1">
          {task.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} tone="outline">
              <bdi>{`#${tag}`}</bdi>
            </Badge>
          ))}
        </div>
      </td>
      <td className="px-2 text-xs whitespace-nowrap text-subtle-foreground">{f.relative(task.updatedAt)}</td>
    </tr>
  );
});

function SortHeader({
  label,
  k,
  sort,
  dir,
  onSort,
}: {
  label: string;
  k: SortKey;
  sort: SortKey;
  dir: 'asc' | 'desc';
  onSort: Props['onSort'];
}) {
  const t = useTranslations('tasks.table');
  const active = sort === k;
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(k, active && dir === 'asc' ? 'desc' : 'asc')}
      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
      aria-label={t('sortBy', { column: label })}
    >
      {label}
      <Icon className={cn('size-3.5', !active && 'opacity-40')} aria-hidden />
    </button>
  );
}

/** Spreadsheet-style table: sortable headers, grouping, inline edits, multi-select with bulk actions. */
export function TaskTable(props: Props) {
  const { tasks, statuses, groupBy, sort, sortDir, onSort, clients, people, today, canUpdate, canDelete, onOpen, onPatch, onChanged } =
    props;
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const bulk = useAction(bulkUpdateTasksAction, { refresh: false });
  const labelOf = useGroupLabel(statuses, clients, people);
  const sorted = useMemo(() => sortTasks(tasks, sort, sortDir), [tasks, sort, sortDir]);
  const groups = orderedGroups(groupTasks(sorted, groupBy, today), groupBy, statuses, (k) => labelOf(groupBy, k).label);
  const visibleIds = new Set(tasks.map((x) => x.id));
  const chosen = [...selected].filter((id) => visibleIds.has(id));
  const allSelected = chosen.length > 0 && chosen.length === tasks.length;

  const runBulk = async (patch: Omit<Parameters<typeof bulkUpdateTasksAction>[0], 'taskIds'>) => {
    const res = await bulk.run({ taskIds: chosen, ...patch });
    if (res.ok) {
      onChanged();
    }
  };

  const head = (label: string, k?: SortKey) => (
    <th scope="col" className="px-2 py-2 text-start text-xs font-medium whitespace-nowrap text-muted-foreground">
      {k ? <SortHeader label={label} k={k} sort={sort} dir={sortDir} onSort={onSort} /> : label}
    </th>
  );

  return (
    <div className="grid gap-3">
      {chosen.length ? (
        <div
          className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-soft/90 p-2 backdrop-blur"
          data-testid="bulk-bar"
        >
          <span className="px-2 text-sm font-medium">{t('tasks.table.selected', { count: chosen.length })}</span>
          <NativeSelect
            value=""
            onChange={(e) => e.target.value && void runBulk({ statusId: e.target.value })}
            aria-label={t('tasks.fields.status')}
            className="h-8 w-40 text-xs"
            disabled={!canUpdate}
            data-testid="bulk-status"
          >
            <option value="">{t('tasks.table.setStatus')}</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {localized(s.name, locale)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            value=""
            onChange={(e) => e.target.value && void runBulk({ priority: e.target.value as TaskPriority })}
            aria-label={t('tasks.fields.priority')}
            className="h-8 w-36 text-xs"
            disabled={!canUpdate}
          >
            <option value="">{t('tasks.table.setPriority')}</option>
            {taskPriorities.map((p) => (
              <option key={p} value={p}>
                {t(`requests.priorities.${p}`)}
              </option>
            ))}
          </NativeSelect>
          <Input
            type="date"
            dir="ltr"
            className="h-8 w-36 text-xs"
            aria-label={t('tasks.table.setDue')}
            disabled={!canUpdate}
            onChange={(e) => e.target.value && void runBulk({ dueDate: e.target.value })}
          />
          <div className="w-48">
            <PeoplePicker
              people={people}
              value={[]}
              single
              label={t('tasks.table.assign')}
              disabled={!canUpdate}
              onChange={(ids) => ids[0] && void runBulk({ assigneeId: ids[0] })}
            />
          </div>
          {canDelete ? (
            <BulkDeleteButton
              type="task"
              items={tasks.filter((x) => selected.has(x.id)).map((x) => ({ id: x.id, name: x.title }))}
              onDone={() => {
                setSelected(new Set());
                onChanged();
              }}
            />
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            className="ms-auto"
            onClick={() => setSelected(new Set())}
            aria-label={t('tasks.table.clearSelection')}
          >
            <X />
          </Button>
        </div>
      ) : null}
      <div className="-mx-(--gutter) overflow-x-auto px-(--gutter)">
        <table className="w-full min-w-[68rem] overflow-hidden rounded-xl border border-border bg-surface text-sm" data-testid="task-table">
          <thead className="border-b border-border bg-surface-muted/60">
            <tr>
              <th scope="col" className="w-10 px-3">
                <Checkbox
                  checked={allSelected ? true : chosen.length ? 'indeterminate' : false}
                  onCheckedChange={(v) => setSelected(v === true ? new Set(tasks.map((x) => x.id)) : new Set())}
                  aria-label={t('tasks.table.selectAll')}
                />
              </th>
              {head(t('tasks.fields.ref'), 'number')}
              {head(t('tasks.fields.title'), 'title')}
              {head(t('tasks.fields.client'))}
              {head(t('tasks.fields.status'))}
              {head(t('tasks.fields.assignees'))}
              {head(t('tasks.fields.priority'), 'priority')}
              {head(t('tasks.fields.dueDate'), 'due')}
              {head(t('tasks.fields.estimate'))}
              {head(t('tasks.fields.tags'))}
              {head(t('tasks.fields.updated'), 'updated')}
            </tr>
          </thead>
          {groups.map(([key, list]) => {
            const { label, dot } = labelOf(groupBy, key);
            return (
              <tbody key={key}>
                {groupBy !== 'none' ? (
                  <tr className="border-b border-border bg-surface-muted/40">
                    <th colSpan={11} scope="rowgroup" className="px-3 py-1.5 text-start text-xs font-semibold">
                      <span className="inline-flex items-center gap-2">
                        {dot ? <span className={cn('size-2 rounded-full', dot)} aria-hidden /> : null}
                        {label}
                        <span className="tabular font-normal text-muted-foreground">{f.number(list.length)}</span>
                      </span>
                    </th>
                  </tr>
                ) : null}
                <Limited items={list}>
                  {(shown, showMore) => (
                    <>
                      {shown.map((task) => (
                        <TableRow
                          key={`${key}-${task.id}`}
                          task={task}
                          statuses={statuses}
                          people={people}
                          today={today}
                          selected={selected.has(task.id)}
                          onSelect={(on) => setSelected((s) => new Set(on ? [...s, task.id] : [...s].filter((x) => x !== task.id)))}
                          canUpdate={canUpdate}
                          onOpen={onOpen}
                          onPatch={onPatch}
                          onChanged={onChanged}
                        />
                      ))}
                      {list.length > shown.length ? (
                        <tr className="border-b border-border">
                          <td colSpan={11} className="py-1 text-center">
                            {showMore(list.length - shown.length, () => undefined)}
                          </td>
                        </tr>
                      ) : null}
                    </>
                  )}
                </Limited>
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
