'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { SectionTitle } from '@/components/patterns';
import { AvatarGroup, Card } from '@/components/ui/primitives';
import { publicAssetUrl } from '@/lib/storage';
import { DeliverableCard } from '@/modules/deliverables/components/deliverables-list';
import type { DeliverableSummary } from '@/modules/deliverables/server/queries';
import { DueDate, TaskRef, TaskStatusBadge, type StatusOption } from '@/modules/tasks/components/badges';
import type { TaskListItem } from '@/modules/tasks/server/queries';
import { RequestProgress } from '@/modules/workflows/components/request-progress';
import type { ProgressStep } from '@/modules/workflows/server/queries';

/** The request's production: workflow stages, its tasks and its deliverables (agency view). */
export function RequestWork({
  steps,
  tasks,
  deliverables,
  statuses,
  today,
}: {
  steps: ProgressStep[];
  tasks: TaskListItem[];
  deliverables: DeliverableSummary[];
  statuses: StatusOption[];
  today: string;
}) {
  const t = useTranslations();
  if (!tasks.length && !deliverables.length) return null;
  return (
    <section data-testid="request-work">
      <SectionTitle title={t('tasks.requestWork.title')} />
      <Card className="grid gap-5 p-4 md:grid-cols-[16rem_minmax(0,1fr)]">
        <RequestProgress steps={steps} />
        <div className="grid min-w-0 content-start gap-4">
          <ul className="grid gap-1" data-testid="request-tasks">
            {tasks
              .filter((x) => !x.parentId)
              .map((task) => (
                <li key={task.id}>
                  <Link href={`/tasks?task=${task.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-muted">
                    <TaskRef number={task.number} />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <bdi>{task.title}</bdi>
                    </span>
                    <DueDate date={task.dueDate} done={task.statusCategory === 'done'} today={today} className="hidden sm:inline-flex" />
                    <TaskStatusBadge status={statuses.find((s) => s.id === task.statusId)} />
                    {task.assignees.length ? (
                      <AvatarGroup
                        people={task.assignees.map((a) => ({ id: a.id, name: a.name, src: publicAssetUrl(a.avatarPath) }))}
                        size="xs"
                        max={2}
                      />
                    ) : null}
                  </Link>
                </li>
              ))}
          </ul>
          {deliverables.length ? (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {deliverables.map((d) => (
                <li key={d.id} className="min-w-0">
                  <DeliverableCard d={d} side="agency" href={`/deliverables/${d.id}`} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Card>
    </section>
  );
}
