'use client';

import { CheckCircle2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { Card, Checkbox } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { cn } from '@/lib/utils/cn';
import { activityIcon } from '@/modules/crm/components/badges';
import { activityTypes, type ActivityType } from '@/modules/crm/constants';
import { completeActivityAction, deleteActivityAction, saveActivityAction } from '@/modules/crm/server/actions';
import type { ActivityItem } from '@/modules/crm/server/queries';

/** `datetime-local` value (browser time) → ISO with offset. */
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

function Composer({ leadId, dealId }: { leadId?: string | null; dealId?: string | null }) {
  const t = useTranslations('crm.activities');
  const tt = useTranslations('crm.activityTypes');
  const [type, setType] = useState<ActivityType>('call');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [due, setDue] = useState('');
  const save = useAction(saveActivityAction, { successMessage: t('saved') });
  return (
    <form
      className="grid gap-3"
      data-testid="activity-composer"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await save.run({ leadId: leadId ?? null, dealId: dealId ?? null, type, subject, body, dueAt: toIso(due), done: !due });
        if (res.ok) {
          setSubject('');
          setBody('');
          setDue('');
        }
      }}
    >
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t('type')}>
        {activityTypes.map((x) => {
          const Icon = activityIcon[x];
          return (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={type === x}
              onClick={() => setType(x)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                type === x
                  ? 'border-primary bg-primary-soft text-primary-soft-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
              data-testid={`activity-type-${x}`}
            >
              <Icon className="size-3.5" aria-hidden />
              {tt(x)}
            </button>
          );
        })}
      </div>
      <Field label={t('subject')}>
        {(p) => (
          <Input
            {...p}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            required
            data-testid="activity-subject"
          />
        )}
      </Field>
      <Field label={t('body')} optional>
        {(p) => <Textarea {...p} value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={4000} />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field label={t('due')} hint={t('dueHint')} optional>
          {(p) => (
            <Input {...p} type="datetime-local" dir="ltr" value={due} onChange={(e) => setDue(e.target.value)} data-testid="activity-due" />
          )}
        </Field>
        <Button type="submit" loading={save.pending} disabled={!subject.trim()} data-testid="activity-save">
          {t('save')}
        </Button>
      </div>
    </form>
  );
}

export function ActivityList({ items, canWrite, now }: { items: ActivityItem[]; canWrite: boolean; now?: string }) {
  const t = useTranslations('crm');
  const f = useFormat();
  const complete = useAction(completeActivityAction);
  const remove = useAction(deleteActivityAction);
  const [nowMs] = useState(() => (now ? Date.parse(now) : Date.now()));
  if (items.length === 0)
    return <EmptyState compact icon={CheckCircle2} title={t('activities.empty')} description={t('activities.emptyBody')} />;
  return (
    <ol className="grid gap-1" data-testid="activity-list">
      {items.map((a) => {
        const Icon = activityIcon[a.type];
        const overdue = !a.completedAt && a.dueAt !== null && Date.parse(a.dueAt) < nowMs;
        const subject =
          (a.subject.startsWith('resubmitted_') || a.subject === 'whatsapp_sent') && t.has(`systemSubjects.${a.subject}` as never)
            ? t(`systemSubjects.${a.subject}` as never)
            : a.subject;
        return (
          <li
            key={a.id}
            className="flex items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-muted"
            data-testid="activity-item"
            data-done={Boolean(a.completedAt)}
          >
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-muted-foreground">
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm font-medium', a.completedAt && a.dueAt ? 'text-muted-foreground line-through decoration-1' : '')}>
                <bdi>{subject}</bdi>
              </p>
              {a.body ? <p className="mt-0.5 text-sm whitespace-pre-line text-muted-foreground">{a.body}</p> : null}
              <p className="mt-0.5 text-xs text-subtle-foreground">
                {t(`activityTypes.${a.type}`)} ·{' '}
                {a.completedAt
                  ? t('activities.doneAt', { when: f.relative(a.completedAt) })
                  : a.dueAt
                    ? t('activities.scheduledFor', { when: f.dateTime(a.dueAt) })
                    : f.relative(a.createdAt)}
                {a.owner ? ` · ${t('activities.by', { name: a.owner.name })}` : ''}
                {overdue ? <span className="ms-1 font-medium text-danger">· {t('activities.overdue')}</span> : null}
              </p>
            </div>
            {canWrite && a.dueAt ? (
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={Boolean(a.completedAt)}
                  onCheckedChange={(v) => complete.run({ activityId: a.id, done: v === true })}
                  aria-label={a.completedAt ? t('activities.reopen') : t('activities.complete')}
                  data-testid="activity-complete"
                />
              </label>
            ) : null}
            {canWrite ? (
              <Button variant="ghost" size="icon-sm" aria-label={t('activities.deleteActivity')} onClick={() => remove.run({ id: a.id })}>
                <Trash2 />
              </Button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function ActivityPanel({
  items,
  leadId,
  dealId,
  canWrite,
}: {
  items: ActivityItem[];
  leadId?: string | null;
  dealId?: string | null;
  canWrite: boolean;
}) {
  const t = useTranslations('crm.activities');
  return (
    <Card className="grid gap-4 p-4" data-testid="activity-panel">
      <p className="font-medium">{t('title')}</p>
      {canWrite ? <Composer leadId={leadId} dealId={dealId} /> : null}
      <div className="border-t border-border pt-3">
        <ActivityList items={items} canWrite={canWrite} />
      </div>
    </Card>
  );
}
