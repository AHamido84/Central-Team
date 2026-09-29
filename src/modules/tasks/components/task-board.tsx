'use client';

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { memo, useId, useMemo, useState } from 'react';

import { useFormat } from '@/components/providers';
import { Avatar } from '@/components/ui/primitives';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { statusDot, type StatusOption } from '@/modules/tasks/components/badges';
import { TaskCard } from '@/modules/tasks/components/task-card';
import { positionBetween, type Swimlane } from '@/modules/tasks/constants';
import type { TaskListItem } from '@/modules/tasks/server/queries';

type Lane = { key: string; label: string; avatar?: { name: string; src: string | null } };
const SEP = '::';

/**
 * Keyboard dragging: Left/Right jump to the neighbouring column (whatever the page direction), Up/Down reorder within
 * a column — the default getter only looks for the nearest card, which never crosses an empty gap between columns.
 */
const columnKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { collisionRect, droppableContainers, droppableRects } = args.context;
  if ((event.code === 'ArrowLeft' || event.code === 'ArrowRight') && collisionRect) {
    event.preventDefault();
    const cx = collisionRect.left + collisionRect.width / 2;
    const cy = collisionRect.top + collisionRect.height / 2;
    let best: { left: number; top: number; width: number; score: number } | null = null;
    for (const c of droppableContainers.getEnabled()) {
      if (!c.data.current || c.data.current.taskId) continue;
      const rect = droppableRects.get(c.id);
      if (!rect) continue;
      const dx = rect.left + rect.width / 2 - cx;
      if (event.code === 'ArrowLeft' ? dx >= -1 : dx <= 1) continue;
      // Nearest column in that direction, preferring the same swimlane (vertical distance).
      const dy = Math.max(0, rect.top - cy, cy - (rect.top + rect.height));
      const score = Math.abs(dx) + dy * 4;
      if (!best || score < best.score) best = { left: rect.left, top: rect.top, width: rect.width, score };
    }
    return best ? { x: best.left + (best.width - collisionRect.width) / 2, y: best.top + 8 } : undefined;
  }
  return sortableKeyboardCoordinates(event, args);
};

const SortableCard = memo(function SortableCard({
  task,
  lane,
  today,
  onOpen,
  showClient,
}: {
  task: TaskListItem;
  lane: string;
  today: string;
  onOpen: (id: string) => void;
  showClient: boolean;
}) {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({
    id: `${lane}${SEP}${task.id}`,
    data: { taskId: task.id, statusId: task.statusId, lane },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && 'opacity-40')}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} today={today} onOpen={onOpen} showClient={showClient} />
    </div>
  );
});

function Column({
  lane,
  status,
  tasks,
  today,
  onOpen,
  onAdd,
  showClient,
  showHeader,
}: {
  lane: string;
  status: StatusOption;
  tasks: TaskListItem[];
  today: string;
  onOpen: (id: string) => void;
  onAdd?: (statusId: string) => void;
  showClient: boolean;
  showHeader: boolean;
}) {
  const t = useTranslations('tasks');
  const locale = useLocale() as Locale;
  const f = useFormat();
  const { setNodeRef, isOver } = useDroppable({ id: `${lane}${SEP}${status.id}`, data: { statusId: status.id, lane } });
  const name = localized(status.name, locale);
  return (
    <section
      className={cn('flex w-72 shrink-0 flex-col rounded-xl bg-surface-muted/60', isOver && 'ring-2 ring-primary/60')}
      aria-label={name}
      data-testid="board-column"
      data-status-id={status.id}
      data-category={status.category}
    >
      {showHeader ? (
        <header className="flex items-center gap-2 px-3 pt-3 pb-2">
          <span className={cn('size-2 rounded-full', statusDot[status.color])} aria-hidden />
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</h3>
          <span className="tabular rounded-full bg-surface px-1.5 text-xs text-muted-foreground">{f.number(tasks.length)}</span>
          {onAdd ? (
            <button
              type="button"
              onClick={() => onAdd(status.id)}
              className="rounded p-1 text-subtle-foreground hover:bg-surface hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={t('addInColumn', { status: name })}
            >
              <Plus className="size-4" />
            </button>
          ) : null}
        </header>
      ) : null}
      <SortableContext items={tasks.map((task) => `${lane}${SEP}${task.id}`)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn('grid min-h-16 content-start gap-2 overflow-y-auto px-2 pb-3', showHeader ? 'max-h-[calc(100dvh-18rem)]' : 'pt-2')}
        >
          {tasks.map((task) => (
            <SortableCard key={task.id} task={task} lane={lane} today={today} onOpen={onOpen} showClient={showClient} />
          ))}
          {tasks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-subtle-foreground">
              {t('dropHere')}
            </p>
          ) : null}
        </div>
      </SortableContext>
    </section>
  );
}

/**
 * Kanban board: one column per status, optional swimlanes (assignee or client). Drag & drop with mouse, touch and
 * keyboard (space to pick up, arrows to move); a drop writes the new status and a fractional position.
 */
export function TaskBoard({
  tasks,
  statuses,
  swimlane,
  clients,
  people,
  today,
  canUpdate,
  onOpen,
  onMove,
  onAdd,
}: {
  tasks: TaskListItem[];
  statuses: StatusOption[];
  swimlane: Swimlane;
  clients: { id: string; name: LocalizedText }[];
  people: { id: string; name: string; avatarPath: string | null }[];
  today: string;
  canUpdate: boolean;
  onOpen: (id: string) => void;
  onMove: (taskId: string, statusId: string, position: number) => void;
  onAdd?: (statusId: string) => void;
}) {
  const t = useTranslations('tasks');
  const locale = useLocale() as Locale;
  const dndId = useId();
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeyboardCoordinates }),
  );

  const laneOf = (task: TaskListItem) =>
    swimlane === 'assignee' ? (task.assignees[0]?.id ?? 'none') : swimlane === 'client' ? task.clientId : 'all';
  const lanes: Lane[] = useMemo(() => {
    if (swimlane === 'none') return [{ key: 'all', label: '' }];
    const keys = [...new Set(tasks.map(laneOf))];
    return keys
      .map((key): Lane => {
        if (swimlane === 'client') return { key, label: localized(clients.find((c) => c.id === key)?.name ?? {}, locale) };
        if (key === 'none') return { key, label: t('unassigned') };
        const p = people.find((x) => x.id === key);
        return { key, label: p?.name ?? '', avatar: p ? { name: p.name, src: publicAssetUrl(p.avatarPath) } : undefined };
      })
      .sort((a, b) => Number(a.key === 'none') - Number(b.key === 'none') || a.label.localeCompare(b.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- laneOf only depends on swimlane
  }, [tasks, swimlane, clients, people, locale, t]);

  const cell = useMemo(() => {
    const map = new Map<string, TaskListItem[]>();
    for (const task of tasks) {
      const key = `${laneOf(task)}${SEP}${task.statusId}`;
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position || a.number - b.number);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- laneOf only depends on swimlane
  }, [tasks, swimlane]);

  const statusName = (id: string) => localized(statuses.find((s) => s.id === id)?.name ?? {}, locale);
  const taskOf = (id: string | number | undefined) => tasks.find((x) => x.id === String(id ?? '').split(SEP)[1]);
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('dnd.picked', { title: taskOf(active.id)?.title ?? '' }),
    onDragOver: ({ over }) => (over ? t('dnd.over', { status: statusName(String(over.data.current?.statusId ?? '')) }) : t('dnd.outside')),
    onDragEnd: ({ over, active }) =>
      over
        ? t('dnd.dropped', { title: taskOf(active.id)?.title ?? '', status: statusName(String(over.data.current?.statusId ?? '')) })
        : t('dnd.cancelled'),
    onDragCancel: () => t('dnd.cancelled'),
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.data.current?.taskId ?? ''));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || !canUpdate) return;
    const taskId = String(active.data.current?.taskId);
    const lane = String(over.data.current?.lane ?? 'all');
    const statusId = String(over.data.current?.statusId ?? '');
    if (!statusId) return;
    const column = (cell.get(`${lane}${SEP}${statusId}`) ?? []).filter((x) => x.id !== taskId);
    const overTaskId = over.data.current?.taskId as string | undefined;
    let index = column.length;
    if (overTaskId && overTaskId !== taskId) {
      const overIndex = column.findIndex((x) => x.id === overTaskId);
      const source = cell.get(`${String(active.data.current?.lane)}${SEP}${String(active.data.current?.statusId)}`) ?? [];
      const movingDown =
        active.data.current?.statusId === statusId &&
        source.findIndex((x) => x.id === taskId) < source.findIndex((x) => x.id === overTaskId);
      index = overIndex + (movingDown ? 1 : 0);
    } else if (overTaskId === taskId) {
      return;
    }
    const before = column[index - 1]?.position ?? null;
    const after = column[index]?.position ?? null;
    const task = tasks.find((x) => x.id === taskId);
    if (!task) return;
    const position = positionBetween(before, after);
    if (task.statusId === statusId && position === task.position) return;
    onMove(taskId, statusId, position);
  };

  const active = activeId ? tasks.find((x) => x.id === activeId) : null;
  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t('dnd.instructions') } }}
    >
      <div className="-mx-(--gutter) overflow-x-auto px-(--gutter) pb-4" data-testid="task-board">
        <div className="inline-grid min-w-full gap-4">
          {swimlane !== 'none' ? (
            <div className="flex gap-3">
              {statuses.map((s) => (
                <div key={s.id} className="flex w-72 shrink-0 items-center gap-2 px-3">
                  <span className={cn('size-2 rounded-full', statusDot[s.color])} aria-hidden />
                  <span className="truncate text-sm font-semibold">{localized(s.name, locale)}</span>
                </div>
              ))}
            </div>
          ) : null}
          {lanes.map((lane) => (
            <div key={lane.key} className="grid gap-2" data-testid="board-lane">
              {swimlane !== 'none' ? (
                <h3 className="sticky start-0 flex w-fit items-center gap-2 text-sm font-semibold">
                  {lane.avatar ? <Avatar name={lane.avatar.name} src={lane.avatar.src} size="xs" /> : null}
                  {lane.label}
                </h3>
              ) : null}
              <div className="flex gap-3">
                {statuses.map((s) => (
                  <Column
                    key={s.id}
                    lane={lane.key}
                    status={s}
                    tasks={cell.get(`${lane.key}${SEP}${s.id}`) ?? []}
                    today={today}
                    onOpen={onOpen}
                    onAdd={onAdd}
                    showClient={swimlane !== 'client'}
                    showHeader={swimlane === 'none'}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <DragOverlay>{active ? <TaskCard task={active} today={today} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}
