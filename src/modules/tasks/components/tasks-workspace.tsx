'use client';

import { KanbanSquare, SearchX } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/patterns';
import { Card } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import { statusDot, TaskRef, type StatusOption } from '@/modules/tasks/components/badges';
import { NewTaskDialog, type NewTaskDefaults } from '@/modules/tasks/components/new-task-dialog';
import type { PersonOption } from '@/modules/tasks/components/people-picker';
import { TaskBoard } from '@/modules/tasks/components/task-board';
import { MonthCalendar } from '@/modules/tasks/components/task-calendar';
import { TaskDrawer, type DrawerContext } from '@/modules/tasks/components/task-drawer';
import { TaskList } from '@/modules/tasks/components/task-list';
import { TaskTable } from '@/modules/tasks/components/task-table';
import { TaskToolbar } from '@/modules/tasks/components/task-toolbar';
import { useTaskMutations, useTasks } from '@/modules/tasks/components/use-tasks';
import { taskLayouts, type SavedViewConfig, type TaskLayout } from '@/modules/tasks/constants';
import { activeFilterCount, applyFilters, sortTasks } from '@/modules/tasks/filter';
import { deleteViewAction, saveViewAction } from '@/modules/tasks/server/actions';
import type { RunningTimer, SavedViewItem, TaskListItem } from '@/modules/tasks/server/queries';

export type WorkspaceProps = {
  initialTasks: TaskListItem[];
  statuses: StatusOption[];
  people: PersonOption[];
  clients: { id: string; name: LocalizedText }[];
  departments: { id: string; name: LocalizedText }[];
  views: SavedViewItem[];
  me: string;
  today: string;
  timer: RunningTimer;
  perms: { canCreate: boolean; canUpdate: boolean; canDelete: boolean; canManageDeliverables: boolean };
  initialLayout: TaskLayout;
  initialViewId: string | null;
};

const storageKey = (me: string) => `tasks-workspace:${me}`;

/** Hook shared by /tasks and /my-work: drawer state in the URL (?task=), optimistic edits, running timer. */
export function useDrawer(
  tasks: TaskListItem[],
  statuses: StatusOption[],
  base: Omit<DrawerContext, 'allTasks' | 'onPatch' | 'onRefresh' | 'timer' | 'onTimerChange'> & { timer: RunningTimer },
) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openTaskId = params.get('task');
  const [timer, setTimer] = useState<RunningTimer>(base.timer);
  const mutations = useTaskMutations(statuses);
  const setOpen = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set('task', id);
      else next.delete('task');
      const q = next.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  const ctx: DrawerContext = {
    ...base,
    allTasks: tasks,
    timer,
    onTimerChange: setTimer,
    onPatch: mutations.update,
    onRefresh: mutations.refresh,
  };
  return { openTaskId, setOpen, ctx, mutations };
}

export function TasksWorkspace(props: WorkspaceProps) {
  const { statuses, people, clients, departments, me, today, perms } = props;
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tasks = useTasks(props.initialTasks);
  const [views, setViews] = useState(props.views);
  const initialView = views.find((v) => v.id === props.initialViewId) ?? null;
  const [activeViewId, setActiveViewId] = useState<string | null>(initialView?.id ?? null);
  const [layout, setLayoutState] = useState<TaskLayout>(initialView?.layout ?? props.initialLayout);
  const [config, setConfig] = useState<SavedViewConfig>(initialView?.config ?? {});
  const [newTask, setNewTask] = useState<NewTaskDefaults | null>(null);
  const saveView = useAction(saveViewAction, { refresh: false });
  const deleteView = useAction(deleteViewAction, { refresh: false, successMessage: t('common.deleted') });
  const { openTaskId, setOpen, ctx, mutations } = useDrawer(tasks, statuses, {
    me,
    today,
    statuses,
    people,
    departments,
    canUpdate: perms.canUpdate,
    canDelete: perms.canDelete,
    canCreate: perms.canCreate,
    canManageDeliverables: perms.canManageDeliverables,
    timer: props.timer,
  });

  // Per-viewer convenience: remember the last layout and filters when no saved view is active.
  useEffect(() => {
    if (props.initialViewId) return;
    try {
      const raw = localStorage.getItem(storageKey(me));
      if (!raw) return;
      const saved = JSON.parse(raw) as { layout?: TaskLayout; config?: SavedViewConfig };
      // Browser storage is only readable after hydration; restoring it here is the intended one-time sync.
      /* eslint-disable react-hooks/set-state-in-effect */
      if (saved.layout && taskLayouts.includes(saved.layout) && !params.get('layout')) setLayoutState(saved.layout);
      if (saved.config) setConfig(saved.config);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      // Storage unavailable (private mode) — defaults are fine.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once on mount
  }, []);
  useEffect(() => {
    if (activeViewId) return;
    try {
      localStorage.setItem(storageKey(me), JSON.stringify({ layout, config }));
    } catch {
      // Ignore storage failures.
    }
  }, [layout, config, activeViewId, me]);

  const setLayout = (l: TaskLayout) => {
    setLayoutState(l);
    const next = new URLSearchParams(params.toString());
    next.set('layout', l);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const filtered = useMemo(() => applyFilters(tasks, config, me, today), [tasks, config, me, today]);
  const ordered = useMemo(
    () => sortTasks(filtered, config.sort ?? 'due', config.sortDir ?? 'asc'),
    [filtered, config.sort, config.sortDir],
  );
  const order = useMemo(() => ordered.map((x) => x.id), [ordered]);
  const doneStatus = statuses.find((s) => s.category === 'done');
  const reopenStatus = statuses.find((s) => s.category === 'active') ?? statuses[0];
  const toggleDone = (task: TaskListItem) => {
    const target = task.statusCategory === 'done' ? reopenStatus : doneStatus;
    if (target) void mutations.update(task.id, { statusId: target.id });
  };

  const empty =
    filtered.length === 0 && layout !== 'calendar' ? (
      <Card>
        <EmptyState
          icon={activeFilterCount(config) || config.q ? SearchX : KanbanSquare}
          title={activeFilterCount(config) || config.q ? t('tasks.empty.filteredTitle') : t('tasks.empty.title')}
          description={activeFilterCount(config) || config.q ? t('tasks.empty.filteredBody') : t('tasks.empty.body')}
        />
      </Card>
    ) : null;

  return (
    <div className="grid gap-4" data-testid="tasks-workspace" data-layout={layout}>
      <TaskToolbar
        layout={layout}
        onLayout={setLayout}
        config={config}
        onConfig={(c) => setConfig(c)}
        statuses={statuses}
        clients={clients}
        people={people}
        departments={departments}
        views={views}
        activeViewId={activeViewId}
        onApplyView={(v) => {
          setActiveViewId(v?.id ?? null);
          setConfig(v?.config ?? {});
          if (v) setLayoutState(v.layout);
        }}
        onSaveView={async ({ name, isShared, viewId }) => {
          const res = await saveView.run({ viewId, name, isShared, layout, config });
          if (!res.ok) return false;
          toast.success(t('tasks.views.savedToast'));
          const item: SavedViewItem = { id: res.data.viewId, name, isShared, layout, config, mine: true };
          setViews((list) => [...list.filter((v) => v.id !== item.id), item].sort((a, b) => a.name.localeCompare(b.name)));
          setActiveViewId(item.id);
          return true;
        }}
        onDeleteView={async (id) => {
          const res = await deleteView.run({ viewId: id });
          if (res.ok) {
            setViews((list) => list.filter((v) => v.id !== id));
            setActiveViewId(null);
          }
        }}
        onNew={() => setNewTask({})}
        canCreate={perms.canCreate}
      />

      {empty ??
        (layout === 'board' ? (
          <TaskBoard
            tasks={filtered}
            statuses={
              config.statusIds?.length
                ? statuses.filter((s) => config.statusIds!.includes(s.id))
                : statuses.filter((s) => config.showDone || s.category !== 'done')
            }
            swimlane={config.swimlane ?? 'none'}
            clients={clients}
            people={people}
            today={today}
            canUpdate={perms.canUpdate}
            onOpen={setOpen}
            onMove={(id, statusId, position) => void mutations.move(id, statusId, position)}
            onAdd={perms.canCreate ? (statusId) => setNewTask({ statusId }) : undefined}
          />
        ) : layout === 'list' ? (
          <TaskList
            tasks={ordered}
            statuses={statuses}
            groupBy={config.groupBy ?? 'status'}
            clients={clients}
            people={people}
            today={today}
            onOpen={setOpen}
            onToggleDone={perms.canUpdate ? toggleDone : undefined}
          />
        ) : layout === 'table' ? (
          <TaskTable
            tasks={filtered}
            statuses={statuses}
            groupBy={config.groupBy ?? 'none'}
            sort={config.sort ?? 'due'}
            sortDir={config.sortDir ?? 'asc'}
            onSort={(sort, sortDir) => setConfig({ ...config, sort, sortDir })}
            clients={clients}
            people={people}
            today={today}
            canUpdate={perms.canUpdate}
            canDelete={perms.canDelete}
            onOpen={setOpen}
            onPatch={(id, patch) => void mutations.update(id, patch)}
            onChanged={() => mutations.refresh('')}
          />
        ) : (
          <MonthCalendar
            items={filtered}
            dayOf={(task) => task.dueDate}
            today={today}
            testId="task-calendar"
            renderItem={(task) => {
              const status = statuses.find((s) => s.id === task.statusId);
              return (
                <button
                  type="button"
                  onClick={() => setOpen(task.id)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-md border border-border bg-surface px-1.5 py-1 text-start text-xs hover:bg-surface-muted',
                    task.statusCategory === 'done' && 'text-muted-foreground line-through',
                  )}
                  data-testid="calendar-task"
                >
                  <span
                    className={cn('size-1.5 shrink-0 rounded-full', status ? statusDot[status.color] : 'bg-subtle-foreground')}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <bdi>{task.title}</bdi>
                  </span>
                </button>
              );
            }}
            aside={
              <Card className="hidden self-start p-4 xl:block">
                <h3 className="text-sm font-semibold">{t('tasks.calendar.noDue')}</h3>
                <p className="mb-3 text-xs text-muted-foreground">{t('tasks.calendar.noDueHint')}</p>
                <ul className="grid gap-1.5">
                  {filtered
                    .filter((x) => !x.dueDate)
                    .slice(0, 15)
                    .map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          onClick={() => setOpen(task.id)}
                          className="flex w-full items-center gap-2 text-start text-sm hover:underline"
                        >
                          <TaskRef number={task.number} />
                          <span className="min-w-0 flex-1 truncate">
                            <bdi>{task.title}</bdi>
                          </span>
                        </button>
                        <span className="block truncate text-xs text-subtle-foreground">{localized(task.clientName, locale)}</span>
                      </li>
                    ))}
                </ul>
              </Card>
            }
          />
        ))}

      <TaskDrawer taskId={openTaskId} onClose={() => setOpen(null)} onOpen={setOpen} order={order} ctx={ctx} />
      <NewTaskDialog
        open={newTask !== null}
        onOpenChange={(o) => !o && setNewTask(null)}
        defaults={newTask ?? {}}
        clients={clients}
        statuses={statuses}
        people={people}
        me={me}
        onCreated={(id) => {
          mutations.refresh(id);
          setOpen(id);
        }}
      />
    </div>
  );
}
