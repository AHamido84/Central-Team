'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  AlarmClock,
  ArrowRightLeft,
  Ban,
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  Eye,
  Flag,
  ListTodo,
  Lock,
  MessageCircleQuestion,
  PackageCheck,
  PencilLine,
  PlayCircle,
  RotateCcw,
  Search,
  Send,
  Tags,
  UserRound,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { FileTypeIcon } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Avatar, Badge, Card, NativeSelect, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { publicAssetUrl } from '@/lib/storage';
import { ensureRealtimeAuth, getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { cn } from '@/lib/utils/cn';
import { FilePreviewDialog } from '@/modules/files/components/file-preview';
import type { FileItem } from '@/modules/files/server/queries';
import {
  canTransition,
  reasonRequired,
  requestPriorities,
  requestTransitions,
  slaState,
  slaTone,
  trackerIndex,
  trackerSteps,
  triageOnlyTargets,
  type RequestPriority,
  type RequestStatus,
} from '@/modules/requests/constants';
import { changeRequestStatusAction, triageRequestsAction } from '@/modules/requests/server/actions';
import type { RequestDetail, RequestListItem, TimelineItem } from '@/modules/requests/server/queries';

/** Refreshes server data when this request changes elsewhere (status, assignee — realtime, RLS-filtered). */
export function RequestLiveRefresh({ requestId }: { requestId: string }) {
  const router = useRouter();
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    void ensureRealtimeAuth().then((supabase) => {
      if (cancelled) return;
      channel = supabase
        .channel(`request:${requestId}:${crypto.randomUUID()}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'requests', filter: `id=eq.${requestId}` }, () =>
          router.refresh(),
        )
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) void getSupabaseBrowserClient().removeChannel(channel);
    };
  }, [requestId, router]);
  return null;
}

export function RequestAttachments({ files }: { files: FileItem[] }) {
  const t = useTranslations('requests');
  const f = useFormat();
  const [preview, setPreview] = useState<FileItem | null>(null);
  if (!files.length) return <p className="text-sm text-subtle-foreground">{t('noAttachments')}</p>;
  return (
    <>
      <ul className="grid gap-2 sm:grid-cols-2">
        {files.map((file) => (
          <li key={file.id}>
            <button
              type="button"
              onClick={() => setPreview(file)}
              className="flex w-full items-center gap-3 rounded-lg border border-border p-2 text-start transition-colors hover:bg-surface-muted"
              data-testid="request-attachment-item"
            >
              {file.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
                <img src={file.thumbUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" />
              ) : (
                <FileTypeIcon kind={file.kind} />
              )}
              <span className="min-w-0">
                <bdi className="block truncate text-sm font-medium">{file.name}</bdi>
                <span className="block text-xs text-subtle-foreground">{f.bytes(file.sizeBytes)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <FilePreviewDialog file={preview} onOpenChange={(o) => !o && setPreview(null)} />
    </>
  );
}

const actionIcon: Record<string, typeof PlayCircle> = {
  under_review: Search,
  needs_info: MessageCircleQuestion,
  accepted: CheckCircle2,
  rejected: XCircle,
  in_progress: PlayCircle,
  in_review: Eye,
  delivered: PackageCheck,
  closed: CheckCheck,
  cancelled: Ban,
  reopen: RotateCcw,
};

type ActionKey = Exclude<RequestStatus, 'draft'> | 'reopen' | 'withdraw';

export function actionKey(from: RequestStatus, to: RequestStatus): ActionKey {
  if ((from === 'rejected' && to === 'under_review') || (from === 'delivered' && to === 'in_progress')) return 'reopen';
  if (from === 'needs_info' && to === 'under_review') return 'withdraw';
  return to as Exclude<RequestStatus, 'draft'>;
}

/** Status change with a (required or optional) reason/message dialog. */
export function StatusActionButtons({
  request,
  side,
  allowed,
  size = 'sm',
}: {
  request: Pick<RequestListItem, 'id' | 'status'>;
  side: 'agency' | 'client';
  allowed: RequestStatus[];
  size?: 'sm' | 'md';
}) {
  const t = useTranslations('requests');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const [target, setTarget] = useState<RequestStatus | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);
  const change = useAction(changeRequestStatusAction, { successMessage: t('statusUpdated') });
  if (!allowed.length) return null;
  const needsReason = target ? reasonRequired.includes(target) : false;
  const confirm = async () => {
    if (!target) return;
    if (needsReason && reason.trim().length < 3) {
      setError(true);
      return;
    }
    const res = await change.run({ requestId: request.id, status: target, reason: reason.trim() || undefined });
    if (res.ok) {
      setTarget(null);
      setReason('');
      setError(false);
    }
  };
  const key = target ? actionKey(request.status, target) : null;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {allowed.map((to) => {
          const k = actionKey(request.status, to);
          const Icon = actionIcon[k] ?? ArrowRightLeft;
          const primary = to === 'accepted' || to === 'delivered' || to === 'in_progress' || (side === 'client' && to === 'closed');
          const danger = to === 'rejected' || to === 'cancelled';
          return (
            <Button
              key={to}
              size={size}
              variant={primary ? 'primary' : danger ? 'outline' : 'outline'}
              className={cn(danger && 'text-danger')}
              onClick={() => setTarget(to)}
              data-testid={`status-action-${to}`}
            >
              <Icon />
              {t(`actions.${k}`)}
            </Button>
          );
        })}
      </div>
      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent closeLabel={tc('close')}>
          <DialogHeader>
            <DialogTitle>{key ? t(`actions.${key}`) : null}</DialogTitle>
            <DialogDescription>
              {!key
                ? null
                : side === 'agency'
                  ? t(`actionHints.agency.${key}`)
                  : t(`actionHints.client.${key as 'closed' | 'cancelled' | 'submitted' | 'under_review'}`)}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field
              label={needsReason ? (target === 'needs_info' ? t('reason.question') : t('reason.rejection')) : t('reason.note')}
              hint={needsReason ? t('reason.visibleToClient') : t('reason.noteHint')}
              error={error ? 'reason_required' : undefined}
              required={needsReason}
              optional={!needsReason}
            >
              {(p) => (
                <Textarea
                  {...p}
                  dir="auto"
                  rows={4}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setError(false);
                  }}
                  placeholder={target === 'needs_info' ? t('reason.questionPlaceholder') : undefined}
                  data-testid="status-reason"
                />
              )}
            </Field>
            {error ? <span className="sr-only">{tv('reason_required')}</span> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              {tc('cancel')}
            </Button>
            <Button
              variant={target === 'rejected' || target === 'cancelled' ? 'destructive' : 'primary'}
              onClick={() => void confirm()}
              loading={change.pending}
              data-testid="status-confirm"
            >
              {reason.trim() ? <Send /> : null}
              {key ? t(`actions.${key}`) : tc('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Which transitions the current agency user may make (triage vs. assignee). */
export function agencyAllowed(status: RequestStatus, canTriage: boolean, isAssignee: boolean): RequestStatus[] {
  return requestTransitions.agency[status].filter((to) => canTriage || (isAssignee && !triageOnlyTargets.includes(to)));
}

/** Agency controls: lifecycle, priority, due date, assignee, extra/billable, and (Phase 3) convert to tasks. */
export function TriagePanel({
  request,
  people,
  canTriage,
  isAssignee,
  tasksEnabled,
}: {
  request: RequestDetail;
  people: { id: string; name: string; avatarPath: string | null }[];
  canTriage: boolean;
  isAssignee: boolean;
  tasksEnabled: boolean;
}) {
  const t = useTranslations('requests');
  const triage = useAction(triageRequestsAction, { successMessage: t('saved') });
  const allowed = agencyAllowed(request.status, canTriage, isAssignee);
  const run = (patch: Omit<Parameters<typeof triage.run>[0], 'requestIds'>) => void triage.run({ requestIds: [request.id], ...patch });
  return (
    <Card className="grid gap-4 p-4" data-testid="triage-panel">
      {allowed.length ? (
        <div className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">{t('moveTo')}</p>
          <StatusActionButtons request={request} side="agency" allowed={allowed} />
        </div>
      ) : null}
      <div className="grid gap-3">
        <Field label={t('assignee')}>
          {(p) => (
            <NativeSelect
              {...p}
              value={request.assignee?.id ?? ''}
              disabled={!canTriage || triage.pending}
              onChange={(e) => run({ assigneeId: e.target.value || null })}
              data-testid="request-assignee-select"
            >
              <option value="">{t('unassigned')}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('priority')}>
            {(p) => (
              <NativeSelect
                {...p}
                value={request.priority}
                disabled={!canTriage || triage.pending}
                onChange={(e) => run({ priority: e.target.value as RequestPriority })}
                data-testid="request-priority-select"
              >
                {requestPriorities.map((p2) => (
                  <option key={p2} value={p2}>
                    {t(`priorities.${p2}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('dueDate')}>
            {(p) => (
              <Input
                {...p}
                type="date"
                dir="ltr"
                defaultValue={request.dueDate ?? ''}
                key={request.dueDate ?? 'none'}
                disabled={!canTriage || triage.pending || !request.dueDate}
                onBlur={(e) => e.target.value && e.target.value !== request.dueDate && run({ dueDate: e.target.value })}
                data-testid="request-due-date"
              />
            )}
          </Field>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <span>
            <span className="block text-sm font-medium">{t('flags.extra')}</span>
            <span className="block text-xs text-subtle-foreground">{t('flags.extraHint')}</span>
          </span>
          <Switch
            checked={request.isExtra}
            disabled={!canTriage || triage.pending}
            onCheckedChange={(v) => run({ isExtra: v })}
            data-testid="request-extra-switch"
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <span>
            <span className="block text-sm font-medium">{t('flags.billable')}</span>
            <span className="block text-xs text-subtle-foreground">{t('flags.billableHint')}</span>
          </span>
          <Switch
            checked={request.isBillable}
            disabled={!canTriage || triage.pending}
            onCheckedChange={(v) => run({ isBillable: v })}
            data-testid="request-billable-switch"
          />
        </label>
      </div>
      {/* Phase 3: turning an accepted request into tasks. Hidden until `module.tasks` ships. */}
      {tasksEnabled && (request.status === 'accepted' || request.status === 'in_progress') ? (
        <Button asChild variant="soft">
          <Link href={`/tasks/new?request=${request.id}`} data-testid="convert-to-tasks">
            <ListTodo />
            {t('convertToTasks')}
          </Link>
        </Button>
      ) : null}
    </Card>
  );
}

/** Client controls: cancel (early statuses), confirm delivery (close), edit & resubmit when the agency asked for info. */
export function ClientRequestActions({ request, canEdit }: { request: Pick<RequestListItem, 'id' | 'status'>; canEdit: boolean }) {
  const t = useTranslations('requests');
  if (!canEdit) return null;
  const allowed = requestTransitions.client[request.status].filter((to) => to !== 'under_review' && to !== 'submitted');
  return (
    <div className="flex flex-wrap items-center gap-2">
      {request.status === 'needs_info' ? (
        <Button asChild size="sm">
          <Link href={`/portal/requests/${request.id}/edit`} data-testid="edit-brief">
            <PencilLine />
            {t('needsInfo.update')}
          </Link>
        </Button>
      ) : null}
      {request.status === 'draft' ? (
        <Button asChild size="sm">
          <Link href={`/portal/requests/${request.id}/edit`} data-testid="continue-draft">
            <PencilLine />
            {t('continueDraft')}
          </Link>
        </Button>
      ) : null}
      <StatusActionButtons request={request} side="client" allowed={allowed.filter((to) => canTransition('client', request.status, to))} />
    </div>
  );
}

export function SlaCard({ request }: { request: RequestListItem }) {
  const t = useTranslations('requests');
  const f = useFormat();
  const state = slaState(request);
  if (!request.dueDate) return <p className="text-sm text-subtle-foreground">{t('sla.noTarget')}</p>;
  return (
    <div className="grid gap-3" data-testid="sla-card">
      {state !== 'none' ? (
        <Badge tone={slaTone[state]} className="w-fit">
          <AlarmClock />
          {t(`sla.states.${state}`)}
        </Badge>
      ) : null}
      <dl className="grid gap-2 text-sm">
        <div className="flex items-start justify-between gap-3">
          <dt className="text-muted-foreground">{t('dueDate')}</dt>
          <dd className="text-end">{f.date(`${request.dueDate}T12:00:00`, 'long')}</dd>
        </div>
        {request.submittedAt ? (
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">{t('submittedAt')}</dt>
            <dd className="text-end">{f.dateTime(request.submittedAt)}</dd>
          </div>
        ) : null}
        {request.deliveredAt ? (
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">{t('deliveredAt')}</dt>
            <dd className="text-end">{f.dateTime(request.deliveredAt)}</dd>
          </div>
        ) : null}
      </dl>
      <p className="text-xs text-subtle-foreground">{t('sla.workingDays')}</p>
    </div>
  );
}

const eventIcon: Record<string, typeof Flag> = {
  assigned: UserRound,
  priority_changed: Flag,
  due_date_changed: CalendarClock,
  flags_changed: Tags,
  brief_updated: PencilLine,
};

export function RequestTimeline({ items }: { items: TimelineItem[] }) {
  const t = useTranslations('requests');
  const f = useFormat();
  const actorOf = (x: TimelineItem) =>
    x.actorSide === 'system' && !x.actorName ? t('timeline.system') : (x.actorName ?? t('timeline.someone'));
  return (
    <ol
      className="relative grid gap-4 before:absolute before:inset-y-1 before:start-3.5 before:w-px before:bg-border"
      data-testid="request-timeline"
    >
      {items.map((x) => {
        const Icon = x.kind === 'status' ? (x.to === 'submitted' ? Send : ArrowRightLeft) : (eventIcon[x.type] ?? Flag);
        const actor = actorOf(x);
        let text: string;
        if (x.kind === 'status') {
          text =
            x.to === 'submitted'
              ? t('timeline.submitted', { actor })
              : t('timeline.statusChanged', { actor, status: t(`statuses.${x.to}`) });
        } else {
          switch (x.type) {
            case 'assigned':
              text = x.toName ? t('timeline.assigned', { actor, name: x.toName }) : t('timeline.unassigned', { actor });
              break;
            case 'priority_changed':
              text = t('timeline.priorityChanged', { actor, priority: t(`priorities.${(x.toValue ?? 'normal') as RequestPriority}`) });
              break;
            case 'due_date_changed':
              text = t('timeline.dueDateChanged', { actor, date: x.toValue ? f.date(`${x.toValue}T12:00:00`, 'long') : '—' });
              break;
            case 'flags_changed':
              text = t('timeline.flagsChanged', {
                actor,
                extra: String(x.toValue?.includes('extra:true')),
                billable: String(x.toValue?.includes('billable:true')),
              });
              break;
            case 'brief_updated':
              text = t('timeline.briefUpdated', { actor });
              break;
          }
        }
        const internal = x.kind === 'event' && x.visibility === 'internal';
        return (
          <li key={x.id} className="relative flex gap-3" data-testid="timeline-item" data-internal={internal || undefined}>
            <span className="z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground">
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 pt-0.5 text-sm">
              <p>
                {text}
                {internal ? (
                  <Badge tone="warning" className="ms-2 align-middle">
                    <Lock />
                    {t('internal')}
                  </Badge>
                ) : null}
              </p>
              {x.kind === 'status' && x.reason ? (
                <p
                  dir="auto"
                  className="mt-1 rounded-md bg-surface-muted px-2.5 py-1.5 text-sm whitespace-pre-wrap text-muted-foreground"
                  data-testid="timeline-reason"
                >
                  {x.reason}
                </p>
              ) : null}
              <p className="text-xs text-subtle-foreground">{f.dateTime(x.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Portal status tracker: the happy path, with needs-info / rejected / cancelled called out. */
export function StatusTracker({ status }: { status: RequestStatus }) {
  const t = useTranslations('requests');
  const current = trackerIndex(status);
  const offRamp = status === 'rejected' || status === 'cancelled';
  return (
    <div data-testid="status-tracker">
      <ol className="grid grid-cols-6 gap-1.5 sm:gap-2">
        {trackerSteps.map((step, i) => {
          const reached = !offRamp && current >= i;
          const active = !offRamp && current === i;
          return (
            <li key={step} className="grid gap-2">
              <span
                className={cn(
                  'h-1.5 rounded-full',
                  reached ? (status === 'needs_info' && active ? 'bg-danger' : 'bg-primary') : 'bg-surface-muted',
                )}
              />
              <span
                className={cn(
                  'hidden text-xs sm:block',
                  active ? 'font-semibold text-foreground' : reached ? 'text-muted-foreground' : 'text-subtle-foreground',
                )}
              >
                {t(`tracker.${step}`)}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-sm font-medium sm:hidden">{t(`statuses.${status}`)}</p>
      {offRamp ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <XCircle className="size-4" aria-hidden />
          {t(`tracker.${status as 'rejected' | 'cancelled'}`)}
        </p>
      ) : null}
    </div>
  );
}

export function PersonLine({ person, fallback }: { person: { name: string; avatarPath: string | null } | null; fallback: string }) {
  return person ? (
    <span className="flex items-center gap-2">
      <Avatar name={person.name} src={publicAssetUrl(person.avatarPath)} size="xs" />
      <span className="truncate">{person.name}</span>
    </span>
  ) : (
    <span className="text-subtle-foreground">{fallback}</span>
  );
}
