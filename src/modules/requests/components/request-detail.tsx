'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  AlarmClock,
  ArrowRightLeft,
  Ban,
  CheckCircle2,
  CircleDot,
  Flag,
  Lock,
  MessageCircleQuestion,
  PlayCircle,
  RotateCcw,
  Search,
  Send,
  UserRound,
  XCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { FileTypeIcon } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Textarea } from '@/components/ui/input';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import { Avatar, Badge, Card, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { publicAssetUrl } from '@/lib/storage';
import { ensureRealtimeAuth, getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { cn } from '@/lib/utils/cn';
import { FilePreviewDialog } from '@/modules/files/components/file-preview';
import type { FileItem } from '@/modules/files/server/queries';

import {
  agencyTransitions,
  clientCancellable,
  requestPriorities,
  slaState,
  slaTone,
  trackerSteps,
  type RequestPriority,
  type RequestStatus,
} from '@/modules/requests/constants';
import { changeRequestStatusAction, triageRequestsAction } from '@/modules/requests/server/actions';
import type { RequestDetail, RequestEventItem } from '@/modules/requests/server/queries';

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

const statusActionIcon: Record<RequestStatus, typeof PlayCircle> = {
  submitted: CircleDot,
  in_review: Search,
  in_progress: PlayCircle,
  waiting_client: MessageCircleQuestion,
  completed: CheckCircle2,
  declined: XCircle,
  cancelled: Ban,
};

function actionKey(from: RequestStatus, to: RequestStatus) {
  if ((from === 'completed' || from === 'declined' || from === 'cancelled') && (to === 'in_progress' || to === 'in_review'))
    return 'reopen';
  return to;
}

/** Agency controls: lifecycle actions (with an optional message to the client), priority and assignee. */
export function TriagePanel({
  request,
  people,
  canTriage,
  canUpdate,
}: {
  request: RequestDetail;
  people: { id: string; name: string; avatarPath: string | null }[];
  canTriage: boolean;
  canUpdate: boolean;
}) {
  const t = useTranslations('requests');
  const tc = useTranslations('common');
  const [target, setTarget] = useState<RequestStatus | null>(null);
  const [message, setMessage] = useState('');
  const change = useAction(changeRequestStatusAction, { successMessage: t('statusUpdated') });
  const triage = useAction(triageRequestsAction, { successMessage: t('saved') });
  const next = agencyTransitions[request.status];

  const confirm = async () => {
    if (!target) return;
    const res = await change.run({ requestId: request.id, status: target, message: message.trim() || undefined });
    if (res.ok) {
      setTarget(null);
      setMessage('');
    }
  };

  return (
    <Card className="grid gap-4 p-4" data-testid="triage-panel">
      {canUpdate && next.length ? (
        <div className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">{t('moveTo')}</p>
          <div className="flex flex-wrap gap-2">
            {next.map((to) => {
              const Icon = actionKey(request.status, to) === 'reopen' ? RotateCcw : statusActionIcon[to];
              return (
                <Button
                  key={to}
                  size="sm"
                  variant={to === 'completed' || to === 'in_progress' ? 'primary' : 'outline'}
                  onClick={() => setTarget(to)}
                  data-testid={`status-action-${to}`}
                >
                  <Icon />
                  {t(`actions.${actionKey(request.status, to)}`)}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="grid gap-3">
        <Field label={t('priority')}>
          {(p) => (
            <NativeSelect
              {...p}
              value={request.priority}
              disabled={!canTriage || triage.pending}
              onChange={(e) => void triage.run({ requestIds: [request.id], priority: e.target.value as RequestPriority })}
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
        <Field label={t('assignee')}>
          {(p) => (
            <NativeSelect
              {...p}
              value={request.assignee?.id ?? ''}
              disabled={!canTriage || triage.pending}
              onChange={(e) => void triage.run({ requestIds: [request.id], assigneeId: e.target.value || null })}
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
      </div>

      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent closeLabel={tc('close')}>
          <DialogHeader>
            <DialogTitle>{target ? t(`actions.${actionKey(request.status, target)}`) : null}</DialogTitle>
            <DialogDescription>{target ? t(`actionHints.${target}`) : null}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={t('messageToClient')} hint={t('messageToClientHint')} optional>
              {(p) => (
                <Textarea
                  {...p}
                  dir="auto"
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={target === 'waiting_client' ? t('waitingPlaceholder') : undefined}
                  data-testid="status-message"
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              {tc('cancel')}
            </Button>
            <Button onClick={() => void confirm()} loading={change.pending} data-testid="status-confirm">
              {message.trim() ? <Send /> : null}
              {message.trim() ? t('confirmAndSend') : tc('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Client control: cancel while the request hasn't started (or is waiting on them). */
export function CancelRequestButton({ request }: { request: { id: string; status: RequestStatus } }) {
  const t = useTranslations('requests');
  const tc = useTranslations('common');
  const cancel = useAction(changeRequestStatusAction, { successMessage: t('cancelledToast') });
  if (!clientCancellable.includes(request.status)) return null;
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm" data-testid="cancel-request">
          <Ban />
          {t('cancelRequest')}
        </Button>
      }
      title={t('cancelTitle')}
      description={t('cancelBody')}
      confirmLabel={t('cancelRequest')}
      cancelLabel={tc('back')}
      destructive
      onConfirm={() => cancel.run({ requestId: request.id, status: 'cancelled' })}
    />
  );
}

export function SlaCard({ request }: { request: RequestDetail }) {
  const t = useTranslations('requests');
  const f = useFormat();
  const sla = slaState(request);
  const rows = [
    { key: 'response', due: request.responseDueAt, done: request.firstResponseAt },
    { key: 'resolution', due: request.resolutionDueAt, done: request.resolvedAt },
  ] as const;
  if (!request.responseDueAt && !request.resolutionDueAt) {
    return <p className="text-sm text-subtle-foreground">{t('sla.noTargets')}</p>;
  }
  return (
    <div className="grid gap-3" data-testid="sla-card">
      {sla.state !== 'none' ? (
        <Badge tone={slaTone[sla.state]} className="w-fit">
          <AlarmClock />
          {t(`sla.states.${sla.state}`)}
        </Badge>
      ) : null}
      <dl className="grid gap-2 text-sm">
        {rows.map((r) =>
          r.due ? (
            <div key={r.key} className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">{t(`sla.${r.key}`)}</dt>
              <dd className="text-end">
                <span className="block">{f.dateTime(r.due)}</span>
                <span
                  className={cn('block text-xs', r.done ? (r.done <= r.due ? 'text-success' : 'text-danger') : 'text-subtle-foreground')}
                >
                  {r.done ? t('sla.doneAt', { when: f.dateTime(r.done) }) : f.relative(r.due)}
                </span>
              </dd>
            </div>
          ) : null,
        )}
      </dl>
      <p className="text-xs text-subtle-foreground">{t('sla.workingDays')}</p>
    </div>
  );
}

const eventIcon: Record<RequestEventItem['type'], typeof Flag> = {
  submitted: Send,
  status_changed: ArrowRightLeft,
  assigned: UserRound,
  priority_changed: Flag,
};

export function RequestTimeline({ events }: { events: RequestEventItem[] }) {
  const t = useTranslations('requests');
  const f = useFormat();
  const describe = (e: RequestEventItem) => {
    const actor = e.actorSide === 'system' && !e.actorName ? t('timeline.system') : (e.actorName ?? t('timeline.someone'));
    switch (e.type) {
      case 'submitted':
        return t('timeline.submitted', { actor });
      case 'status_changed':
        return t('timeline.statusChanged', { actor, status: t(`statuses.${(e.toValue ?? 'submitted') as RequestStatus}`) });
      case 'assigned':
        return e.toName ? t('timeline.assigned', { actor, name: e.toName }) : t('timeline.unassigned', { actor });
      case 'priority_changed':
        return t('timeline.priorityChanged', { actor, priority: t(`priorities.${(e.toValue ?? 'normal') as RequestPriority}`) });
    }
  };
  return (
    <ol
      className="relative grid gap-4 before:absolute before:inset-y-1 before:start-3.5 before:w-px before:bg-border"
      data-testid="request-timeline"
    >
      {events.map((e) => {
        const Icon = eventIcon[e.type];
        return (
          <li
            key={e.id}
            className="relative flex gap-3"
            data-testid="timeline-item"
            data-internal={e.visibility === 'internal' || undefined}
          >
            <span className="z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground">
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 pt-0.5 text-sm">
              <p>
                {describe(e)}
                {e.visibility === 'internal' ? (
                  <Badge tone="warning" className="ms-2 align-middle">
                    <Lock />
                    {t('internal')}
                  </Badge>
                ) : null}
              </p>
              <p className="text-xs text-subtle-foreground">{f.dateTime(e.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Portal status tracker: the happy path, with off-ramps (waiting on you, declined, cancelled) called out. */
export function StatusTracker({ status }: { status: RequestStatus }) {
  const t = useTranslations('requests');
  const stepIndex = (s: RequestStatus) => (s === 'waiting_client' ? 2 : (trackerSteps as readonly RequestStatus[]).indexOf(s));
  const current = stepIndex(status);
  const offRamp = status === 'declined' || status === 'cancelled';
  return (
    <div data-testid="status-tracker">
      <ol className="grid grid-cols-4 gap-2">
        {trackerSteps.map((step, i) => {
          const reached = !offRamp && current >= i;
          const active = !offRamp && current === i;
          return (
            <li key={step} className="grid gap-2">
              <span className={cn('h-1.5 rounded-full', reached ? 'bg-primary' : 'bg-surface-muted')} />
              <span
                className={cn(
                  'text-xs',
                  active ? 'font-semibold text-foreground' : reached ? 'text-muted-foreground' : 'text-subtle-foreground',
                )}
              >
                {t(`tracker.${step}`)}
              </span>
            </li>
          );
        })}
      </ol>
      {offRamp ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <XCircle className="size-4" aria-hidden />
          {t(`tracker.${status as 'declined' | 'cancelled'}`)}
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
