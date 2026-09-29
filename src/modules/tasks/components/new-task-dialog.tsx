'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import type { StatusOption } from '@/modules/tasks/components/badges';
import { PeoplePicker, type PersonOption } from '@/modules/tasks/components/people-picker';
import { taskPriorities, type TaskPriority } from '@/modules/tasks/constants';
import { createTaskSchema } from '@/modules/tasks/schemas';
import { createTaskAction } from '@/modules/tasks/server/actions';

export type NewTaskDefaults = { statusId?: string; clientId?: string; dueDate?: string; parentId?: string; requestId?: string };

export function NewTaskDialog({
  open,
  onOpenChange,
  defaults,
  clients,
  statuses,
  people,
  me,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults: NewTaskDefaults;
  clients: { id: string; name: LocalizedText }[];
  statuses: StatusOption[];
  people: PersonOption[];
  me: string;
  onCreated: (taskId: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [statusId, setStatusId] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [dueDate, setDueDate] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useAction(createTaskAction, { successMessage: t('tasks.created') });

  const reset = () => {
    setTitle('');
    setClientId(defaults.clientId ?? '');
    setStatusId(defaults.statusId ?? '');
    setPriority('normal');
    setDueDate(defaults.dueDate ?? '');
    setAssignees([me]);
    setErrors({});
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = createTaskSchema.safeParse({
      clientId,
      title,
      statusId: statusId || undefined,
      priority,
      dueDate: dueDate || null,
      assigneeIds: assignees,
      parentId: defaults.parentId,
      requestId: defaults.requestId,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message === 'Invalid UUID' ? 'required' : i.message;
      setErrors(next);
      return;
    }
    const res = await create.run(parsed.data);
    if (res.ok) {
      onOpenChange(false);
      onCreated(res.data.taskId);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent closeLabel={t('common.close')}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col" data-testid="new-task-form">
          <DialogHeader>
            <DialogTitle>{defaults.parentId ? t('tasks.newSubtask') : t('tasks.new')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label={t('tasks.fields.title')} error={errors.title} required>
              {(p) => (
                <Input {...p} dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus data-testid="new-task-title" />
              )}
            </Field>
            {!defaults.parentId ? (
              <Field label={t('tasks.fields.client')} error={errors.clientId} required>
                {(p) => (
                  <NativeSelect {...p} value={clientId} onChange={(e) => setClientId(e.target.value)} data-testid="new-task-client">
                    <option value="">{t('tasks.chooseClient')}</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {localized(c.name, locale)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('tasks.fields.status')}>
                {(p) => (
                  <NativeSelect {...p} value={statusId} onChange={(e) => setStatusId(e.target.value)}>
                    <option value="">{t('tasks.defaultStatus')}</option>
                    {statuses.map((s) => (
                      <option key={s.id} value={s.id}>
                        {localized(s.name, locale)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('tasks.fields.priority')}>
                {(p) => (
                  <NativeSelect {...p} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                    {taskPriorities.map((x) => (
                      <option key={x} value={x}>
                        {t(`requests.priorities.${x}`)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('tasks.fields.dueDate')} optional>
                {(p) => <Input {...p} type="date" dir="ltr" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
              </Field>
              <Field label={t('tasks.fields.assignees')} optional>
                {() => <PeoplePicker people={people} value={assignees} onChange={setAssignees} label={t('tasks.fields.assignees')} />}
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={create.pending} data-testid="new-task-submit">
              {t('tasks.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
