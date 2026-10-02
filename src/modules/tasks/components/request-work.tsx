'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { SectionTitle } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { AvatarGroup, Badge, Card, Checkbox, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { RowActions } from '@/modules/data/components/row-actions';
import { DeliverableCard } from '@/modules/deliverables/components/deliverables-list';
import type { DeliverableSummary } from '@/modules/deliverables/server/queries';
import { DueDate, TaskRef, TaskStatusBadge, type StatusOption } from '@/modules/tasks/components/badges';
import { taskPriorities, type TaskPriority } from '@/modules/tasks/constants';
import type { TaskListItem } from '@/modules/tasks/server/queries';
import { RequestProgress } from '@/modules/workflows/components/request-progress';
import { addRequestTaskAction } from '@/modules/workflows/server/actions';
import type { ProgressStep } from '@/modules/workflows/server/queries';

type Option = { id: string; name: string };

/**
 * The request's production: workflow stages, its tasks and its deliverables (agency view). Tasks can be added after
 * conversion (outside the workflow), opened for editing and deleted, per permission (FR1.3).
 */
export function RequestWork({
  requestId,
  steps,
  tasks,
  deliverables,
  statuses,
  today,
  canCreate = false,
  canDelete = false,
  people = [],
  departments = [],
}: {
  requestId?: string;
  steps: ProgressStep[];
  tasks: TaskListItem[];
  deliverables: DeliverableSummary[];
  statuses: StatusOption[];
  today: string;
  canCreate?: boolean;
  canDelete?: boolean;
  people?: Option[];
  departments?: { id: string; name: LocalizedText }[];
}) {
  const t = useTranslations();
  const [adding, setAdding] = useState(false);
  if (!tasks.length && !deliverables.length) return null;
  const top = tasks.filter((x) => !x.parentId);
  return (
    <section data-testid="request-work">
      <SectionTitle
        title={t('tasks.requestWork.title')}
        action={
          canCreate && requestId ? (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)} data-testid="request-add-task">
              <Plus />
              {t('tasks.requestWork.addTask')}
            </Button>
          ) : null
        }
      />
      <Card className="grid min-w-0 gap-5 p-4">
        <RequestProgress steps={steps} />
        <div className="grid min-w-0 content-start gap-4">
          <ul className="grid gap-1" data-testid="request-tasks">
            {top.map((task) => (
              <li key={task.id} className="flex min-w-0 items-center gap-1" data-testid="request-task">
                <Link
                  href={`/tasks?task=${task.id}`}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-muted"
                >
                  <TaskRef number={task.number} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <bdi>{task.title}</bdi>
                  </span>
                  {!task.fromWorkflow ? (
                    <Badge tone="warning" className="hidden sm:inline-flex" data-testid="outside-workflow">
                      {t('tasks.requestWork.outsideWorkflow')}
                    </Badge>
                  ) : null}
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
                {canDelete ? <RowActions label={task.title} del={{ type: 'task', id: task.id }} testId="request-task-actions" /> : null}
              </li>
            ))}
          </ul>
          {deliverables.length ? (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {deliverables.map((d) => (
                <li key={d.id} className="min-w-0">
                  <DeliverableCard d={d} side="agency" href={`/deliverables/${d.id}`} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Card>
      {canCreate && requestId ? (
        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogContent closeLabel={t('common.close')} size="lg">
            {adding ? (
              <AddTaskForm requestId={requestId} tasks={top} people={people} departments={departments} onDone={() => setAdding(false)} />
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}

function AddTaskForm({
  requestId,
  tasks,
  people,
  departments,
  onDone,
}: {
  requestId: string;
  tasks: TaskListItem[];
  people: Option[];
  departments: { id: string; name: LocalizedText }[];
  onDone: () => void;
}) {
  const t = useTranslations('tasks.requestWork');
  const tr = useTranslations('requests');
  const tc = useTranslations('common');
  const locale = useLocale() as Locale;
  const open = tasks.filter((x) => x.statusCategory !== 'done');
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [durationDays, setDuration] = useState(1);
  const [dependsOn, setDependsOn] = useState<string[]>(open.length ? [open[open.length - 1]!.id] : []);
  const [startDate, setStart] = useState('');
  const [dueDate, setDue] = useState('');
  const add = useAction(addRequestTaskAction, { successMessage: t('added') });
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await add.run({
          requestId,
          title: title.trim(),
          assigneeId: assigneeId || null,
          reviewerId: reviewerId || null,
          departmentId: departmentId || null,
          priority,
          durationDays,
          dependsOn,
          startDate: startDate || null,
          dueDate: dueDate || null,
        });
        if (res.ok) onDone();
      }}
      data-testid="request-add-task-form"
    >
      <DialogHeader>
        <DialogTitle>{t('addTitle')}</DialogTitle>
        <DialogDescription>{t('datesHint')}</DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-4 sm:grid-cols-2">
        <Field label={t('title_')} required className="sm:col-span-2">
          {(p) => (
            <Input
              {...p}
              value={title}
              maxLength={200}
              dir="auto"
              onChange={(e) => setTitle(e.target.value)}
              data-testid="add-task-title"
            />
          )}
        </Field>
        <Field label={t('assignee')}>
          {(p) => (
            <NativeSelect {...p} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} data-testid="add-task-assignee">
              <option value="">{t('nobody')}</option>
              {people.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label={t('reviewer')}>
          {(p) => (
            <NativeSelect {...p} value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
              <option value="">{t('nobody')}</option>
              {people.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label={t('department')}>
          {(p) => (
            <NativeSelect {...p} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">{t('none')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {localized(d.name, locale)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label={t('priority')}>
          {(p) => (
            <NativeSelect {...p} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              {taskPriorities.map((x) => (
                <option key={x} value={x}>
                  {tr(`priorities.${x}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label={t('duration')}>
          {(p) => (
            <Input
              {...p}
              type="number"
              dir="ltr"
              min={0}
              max={365}
              value={durationDays}
              onChange={(e) => setDuration(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('startDate')} optional>
            {(p) => <Input {...p} type="date" dir="ltr" value={startDate} onChange={(e) => setStart(e.target.value)} />}
          </Field>
          <Field label={t('dueDate')} optional>
            {(p) => (
              <Input {...p} type="date" dir="ltr" value={dueDate} min={startDate || undefined} onChange={(e) => setDue(e.target.value)} />
            )}
          </Field>
        </div>
        {open.length ? (
          <fieldset className="grid gap-1 sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">{t('waitsFor')}</legend>
            <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-border p-2">
              {open.map((x) => (
                <label key={x.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={dependsOn.includes(x.id)}
                    onCheckedChange={(on) => setDependsOn((d) => (on ? [...d, x.id] : d.filter((y) => y !== x.id)))}
                  />
                  <TaskRef number={x.number} />
                  <span className="min-w-0 truncate" dir="auto">
                    {x.title}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={!title.trim()} loading={add.pending} data-testid="add-task-submit">
          {t('add')}
        </Button>
      </DialogFooter>
    </form>
  );
}
