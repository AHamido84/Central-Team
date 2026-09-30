'use client';

import { AlarmClock, CalendarCheck, Inbox, ListChecks, Pause, ScanEye } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { EmptyState, StatCard } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import type { LocalizedText } from '@/lib/i18n/localized';
import { DeliverableCard } from '@/modules/deliverables/components/deliverables-list';
import type { DeliverableSummary } from '@/modules/deliverables/server/queries';
import type { TaskEditContext } from '@/modules/tasks/access';
import { TaskRef, type StatusOption } from '@/modules/tasks/components/badges';
import type { PersonOption } from '@/modules/tasks/components/people-picker';
import { TaskCard } from '@/modules/tasks/components/task-card';
import { TaskDrawer } from '@/modules/tasks/components/task-drawer';
import { useDrawer } from '@/modules/tasks/components/tasks-workspace';
import { useTasks } from '@/modules/tasks/components/use-tasks';
import { myWorkSection, myWorkSections, type MyWorkSection } from '@/modules/tasks/constants';
import { sortTasks } from '@/modules/tasks/filter';
import { stopTimerAction } from '@/modules/tasks/server/actions';
import type { RunningTimer, TaskListItem } from '@/modules/tasks/server/queries';

const sectionIcon: Record<MyWorkSection, typeof Inbox> = {
  overdue: AlarmClock,
  today: CalendarCheck,
  week: ListChecks,
  waiting: ScanEye,
  later: Inbox,
};

export function MyWork({
  initialTasks,
  reviews,
  statuses,
  people,
  departments,
  me,
  today,
  timer,
  perms,
}: {
  initialTasks: TaskListItem[];
  reviews: DeliverableSummary[];
  statuses: StatusOption[];
  people: PersonOption[];
  departments: { id: string; name: LocalizedText }[];
  me: string;
  today: string;
  timer: RunningTimer;
  perms: { canCreate: boolean; canUpdate: boolean; canDelete: boolean; canManageDeliverables: boolean; edit: TaskEditContext };
}) {
  const t = useTranslations('tasks.myWork');
  const f = useFormat();
  const tasks = useTasks(initialTasks);
  const { openTaskId, setOpen, ctx } = useDrawer(tasks, statuses, { me, today, statuses, people, departments, ...perms, timer });
  const stop = useAction(stopTimerAction, { refresh: false });

  const sections = useMemo(() => {
    const out = new Map<MyWorkSection, TaskListItem[]>(myWorkSections.map((s) => [s, []]));
    for (const task of tasks) {
      if (task.parentId && !task.assignees.some((a) => a.id === me)) continue;
      const s = myWorkSection({ ...task, isAssignee: task.assignees.some((a) => a.id === me), isReviewer: task.reviewerId === me }, today);
      if (s) out.get(s)!.push(task);
    }
    for (const [k, v] of out) out.set(k, sortTasks(v, 'due', 'asc'));
    return out;
  }, [tasks, me, today]);
  const order = myWorkSections.flatMap((s) => sections.get(s)!.map((x) => x.id));
  const total = order.length + reviews.length;
  const running = ctx.timer;

  return (
    <div className="grid gap-6" data-testid="my-work">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('stats.open')} value={f.number(order.length - sections.get('waiting')!.length)} icon={ListChecks} />
        <StatCard label={t('stats.dueToday')} value={f.number(sections.get('today')!.length)} icon={CalendarCheck} />
        <StatCard label={t('stats.overdue')} value={f.number(sections.get('overdue')!.length)} icon={AlarmClock} />
        <StatCard label={t('stats.reviews')} value={f.number(sections.get('waiting')!.length + reviews.length)} icon={ScanEye} />
      </div>
      {running ? (
        <Card className="flex flex-wrap items-center gap-3 border-primary/40 p-3" data-testid="running-timer">
          <span className="size-2 animate-pulse rounded-full bg-danger" aria-hidden />
          <span className="text-sm text-muted-foreground">{t('timer')}</span>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-start text-sm font-medium hover:underline"
            onClick={() => setOpen(running.taskId)}
          >
            <TaskRef number={running.taskNumber} />
            <bdi className="truncate">{running.taskTitle}</bdi>
          </button>
          <Button
            size="sm"
            variant="outline"
            loading={stop.pending}
            onClick={async () => {
              if ((await stop.run({})).ok) ctx.onTimerChange(null);
            }}
          >
            <Pause />
            {t('stopTimer')}
          </Button>
        </Card>
      ) : null}
      {total === 0 ? (
        <Card>
          <EmptyState icon={Inbox} title={t('emptyTitle')} description={t('emptyBody')} />
        </Card>
      ) : null}
      {reviews.length ? (
        <section className="grid gap-3" data-testid="review-queue">
          <h2 className="flex items-center gap-2 font-semibold">
            <ScanEye className="size-4 text-info" aria-hidden />
            {t('reviewQueue')}
            <span className="tabular rounded-full bg-surface-muted px-2 text-xs text-muted-foreground">{f.number(reviews.length)}</span>
          </h2>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {reviews.map((d) => (
              <li key={d.id} className="min-w-0">
                <DeliverableCard d={d} side="agency" href={`/deliverables/${d.id}`} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {myWorkSections.map((s) => {
        const list = sections.get(s)!;
        if (!list.length) return null;
        const Icon = sectionIcon[s];
        return (
          <section key={s} className="grid gap-3" data-testid={`my-work-${s}`}>
            <div>
              <h2 className="flex items-center gap-2 font-semibold">
                <Icon className={s === 'overdue' ? 'size-4 text-danger' : 'size-4 text-subtle-foreground'} aria-hidden />
                {t(`sections.${s}`)}
                <span className="tabular rounded-full bg-surface-muted px-2 text-xs text-muted-foreground">{f.number(list.length)}</span>
              </h2>
              <p className="text-xs text-muted-foreground">{t(`sectionHints.${s}`)}</p>
            </div>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((task) => (
                <li key={task.id} className="min-w-0">
                  <TaskCard task={task} today={today} onOpen={setOpen} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <TaskDrawer taskId={openTaskId} onClose={() => setOpen(null)} onOpen={setOpen} order={order} ctx={ctx} />
    </div>
  );
}
