'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Columns2,
  Eye,
  EyeOff,
  History,
  Lock,
  MessageSquare,
  RotateCcw,
  Send,
  Trash2,
  Upload as UploadIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';

import { DirIcon, FileTypeIcon } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Textarea } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Avatar, Badge, Card, NativeSelect, Progress, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { acceptAttribute, publicAssetUrl } from '@/lib/storage';
import { ensureRealtimeAuth, getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { cn } from '@/lib/utils/cn';
import { DeleteButton } from '@/modules/data/components/delete-button';
import { RowActions } from '@/modules/data/components/row-actions';
import { ClientDeliverableBadge, DeliverableStatusBadge, VersionStatusBadge } from '@/modules/deliverables/components/badges';
import { EditDeliverableButton } from '@/modules/deliverables/components/deliverable-edit';
import { useVersionUpload } from '@/modules/deliverables/components/use-version-upload';
import { DocumentViewer, formatTime, ImageViewer, VideoViewer, type Pending } from '@/modules/deliverables/components/viewer';
import {
  addAnnotationAction,
  createVersionAction,
  decideVersionAction,
  loadDeliverableAction,
  removeVersionFileAction,
  replyAnnotationAction,
  resolveAnnotationAction,
  submitVersionAction,
  updateVersionNotesAction,
} from '@/modules/deliverables/server/actions';
import type { AnnotationItem, DeliverableDetail, VersionItem } from '@/modules/deliverables/server/queries';
import { FormattedText } from '@/modules/requests/components/brief-fields';
import { TaskRef } from '@/modules/tasks/components/badges';

type Side = 'agency' | 'client';
export type ReviewPerms = { canManage: boolean; canReview: boolean; canApprove: boolean; canDelete?: boolean };
export type RevisionQuota = { allowed: number; used: number; hasPackage: boolean } | null;

function useDeliverable(initial: DeliverableDetail) {
  const queryClient = useQueryClient();
  const key = useMemo(() => ['deliverable', initial.id] as const, [initial.id]);
  const query = useQuery({
    queryKey: key,
    initialData: initial,
    queryFn: async () => {
      const res = await loadDeliverableAction({ deliverableId: initial.id });
      if (!res.ok) throw new Error(res.error.code);
      return res.data;
    },
  });
  // Live: new versions, decisions and comments from the other side (RLS decides what each user receives).
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void queryClient.invalidateQueries({ queryKey: key }), 300);
    };
    void ensureRealtimeAuth().then((supabase) => {
      if (cancelled) return;
      const filter = `deliverable_id=eq.${initial.id}`;
      channel = supabase
        .channel(`deliverable:${initial.id}:${crypto.randomUUID()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'deliverables', filter: `id=eq.${initial.id}` }, refresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'deliverable_versions', filter }, refresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'annotations', filter }, refresh)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'annotation_replies' }, refresh)
        .subscribe();
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (channel) void getSupabaseBrowserClient().removeChannel(channel);
    };
  }, [initial.id, key, queryClient]);
  return { data: query.data, refresh: () => queryClient.invalidateQueries({ queryKey: key }) };
}

function Person({ name, avatarPath, side }: { name: string; avatarPath: string | null; side?: Side }) {
  const t = useTranslations('deliverables');
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar name={name} src={publicAssetUrl(avatarPath)} size="xs" />
      <span className="truncate text-sm font-medium">{name}</span>
      {side === 'agency' ? <Badge tone="outline">{t('agencyBadge')}</Badge> : null}
    </span>
  );
}

function AnnotationCard({
  a,
  n,
  active,
  side,
  canReply,
  onSelect,
  onChanged,
}: {
  a: AnnotationItem;
  n: number;
  active: boolean;
  side: Side;
  canReply: boolean;
  onSelect: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('deliverables');
  const f = useFormat();
  const [reply, setReply] = useState('');
  const send = useAction(replyAnnotationAction, { refresh: false });
  const resolve = useAction(resolveAnnotationAction, { refresh: false });
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);
  const canResolve = side === 'agency' || a.authorSide === 'client';
  return (
    <li
      ref={ref}
      className={cn(
        'grid gap-2 rounded-lg border p-3 transition-colors',
        active ? 'border-primary bg-primary-soft/30' : 'border-border',
        a.resolvedAt && 'opacity-70',
      )}
      data-testid="annotation"
      data-kind={a.kind}
      data-resolved={Boolean(a.resolvedAt)}
    >
      <button type="button" onClick={onSelect} className="flex items-start gap-2 text-start">
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
            a.resolvedAt ? 'bg-surface-muted text-muted-foreground' : 'bg-primary text-primary-foreground',
          )}
        >
          {n}
        </span>
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            {a.author ? (
              <Person name={a.author.name} avatarPath={a.author.avatarPath} side={side === 'client' ? a.authorSide : undefined} />
            ) : null}
            {a.kind === 'timestamp' && a.timeSeconds !== null ? (
              <Badge tone="info">
                <span dir="ltr">{formatTime(a.timeSeconds)}</span>
              </Badge>
            ) : null}
            {a.visibility === 'internal' ? (
              <Badge tone="warning">
                <Lock />
                {t('internal')}
              </Badge>
            ) : null}
            <span className="text-xs text-subtle-foreground">{f.relative(a.createdAt)}</span>
          </span>
          <span className="text-sm whitespace-pre-wrap" dir="auto">
            {a.body}
          </span>
        </span>
      </button>
      {a.replies.length ? (
        <ul className="grid gap-2 border-s-2 border-border ps-3">
          {a.replies.map((r) => (
            <li key={r.id} className="grid gap-0.5">
              {r.author ? (
                <Person name={r.author.name} avatarPath={r.author.avatarPath} side={side === 'client' ? r.authorSide : undefined} />
              ) : null}
              <span className="text-sm whitespace-pre-wrap" dir="auto">
                {r.body}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {canReply ? (
          <form
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!reply.trim()) return;
              if ((await send.run({ annotationId: a.id, body: reply.trim() })).ok) {
                setReply('');
                onChanged();
              }
            }}
          >
            <input
              dir="auto"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={t('reply')}
              aria-label={t('reply')}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            />
            <Button type="submit" size="icon-sm" variant="ghost" disabled={!reply.trim()} aria-label={t('sendReply')}>
              <DirIcon icon={Send} />
            </Button>
          </form>
        ) : null}
        {canResolve ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              if ((await resolve.run({ annotationId: a.id, resolved: !a.resolvedAt })).ok) onChanged();
            }}
            data-testid="annotation-resolve"
          >
            {a.resolvedAt ? <RotateCcw /> : <Check />}
            {a.resolvedAt ? t('reopen') : t('resolve')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function Composer({
  pending,
  side,
  versionSent,
  onCancel,
  onSubmit,
}: {
  pending: Pending;
  side: Side;
  versionSent: boolean;
  onCancel: () => void;
  onSubmit: (body: string, visibility: 'internal' | 'client') => Promise<boolean>;
}) {
  const t = useTranslations('deliverables');
  const [body, setBody] = useState('');
  const [shared, setShared] = useState(versionSent);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    area.current?.focus();
  }, [pending]);
  return (
    <form
      className="grid gap-2 rounded-lg border border-primary/40 bg-primary-soft/20 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) return;
        setBusy(true);
        const ok = await onSubmit(body.trim(), side === 'client' || shared ? 'client' : 'internal');
        setBusy(false);
        if (ok) setBody('');
      }}
      data-testid="annotation-composer"
    >
      <p className="text-xs font-medium text-muted-foreground">
        {pending.kind === 'point'
          ? t('composer.onPoint')
          : pending.kind === 'timestamp'
            ? t('composer.atTime', { time: formatTime(pending.timeSeconds) })
            : t('composer.general')}
      </p>
      <Textarea
        ref={area}
        dir="auto"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('composer.placeholder')}
        aria-label={t('composer.placeholder')}
        data-testid="annotation-input"
      />
      {side === 'agency' ? (
        versionSent ? (
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5">
              {shared ? <Eye className="size-3.5" aria-hidden /> : <EyeOff className="size-3.5" aria-hidden />}
              {shared ? t('composer.visibleToClient') : t('composer.internalOnly')}
            </span>
            <Switch checked={shared} onCheckedChange={setShared} aria-label={t('composer.visibleToClient')} />
          </label>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden />
            {t('composer.internalUntilSent')}
          </p>
        )
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit" size="sm" loading={busy} disabled={!body.trim()} data-testid="annotation-submit">
          {t('composer.add')}
        </Button>
      </div>
    </form>
  );
}

function DecisionDialog({
  open,
  onOpenChange,
  decision,
  stage,
  versionId,
  quota,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  decision: 'approved' | 'changes_requested';
  stage: 'internal' | 'client';
  versionId: string;
  quota: RevisionQuota;
  onDone: () => void;
}) {
  const t = useTranslations('deliverables');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | undefined>();
  const decide = useAction(decideVersionAction, {
    refresh: true,
    successMessage: decision === 'approved' ? t('decision.approvedToast') : t('decision.changesToast'),
  });
  const over = stage === 'client' && decision === 'changes_requested' && quota && quota.used >= quota.allowed;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setComment('');
          setError(undefined);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent closeLabel={t('close')}>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={async (e) => {
            e.preventDefault();
            if (decision === 'changes_requested' && comment.trim().length < 3) {
              setError('comment_required');
              return;
            }
            const res = await decide.run({ versionId, stage, decision, comment: comment.trim() });
            if (res.ok) {
              onOpenChange(false);
              onDone();
            } else if (res.error.code === 'comment_required') setError('comment_required');
          }}
          data-testid="decision-dialog"
        >
          <DialogHeader>
            <DialogTitle>{decision === 'approved' ? t(`decision.approveTitle.${stage}`) : t(`decision.changesTitle.${stage}`)}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              {decision === 'approved' ? t(`decision.approveBody.${stage}`) : t(`decision.changesBody.${stage}`)}
            </p>
            {stage === 'client' && decision === 'changes_requested' && quota?.hasPackage ? (
              <p
                className={cn(
                  'flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
                  over ? 'bg-warning-soft text-warning' : 'bg-surface-muted text-muted-foreground',
                )}
                data-testid="revision-quota"
              >
                {over ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                ) : (
                  <History className="mt-0.5 size-4 shrink-0" aria-hidden />
                )}
                {over
                  ? t('decision.quotaExceeded', { used: quota.used, allowed: quota.allowed })
                  : t('decision.quotaLeft', { left: quota.allowed - quota.used, allowed: quota.allowed })}
              </p>
            ) : null}
            <Field
              label={decision === 'approved' ? t('decision.noteOptional') : t('decision.feedback')}
              error={error}
              required={decision !== 'approved'}
            >
              {(p) => (
                <Textarea
                  {...p}
                  dir="auto"
                  rows={4}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  data-testid="decision-comment"
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              variant={decision === 'approved' ? 'primary' : 'destructive'}
              loading={decide.pending}
              data-testid="decision-confirm"
            >
              {decision === 'approved' ? t('decision.approve') : t('decision.requestChanges')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UploadPanel({ d, version, onChanged }: { d: DeliverableDetail; version: VersionItem | null; onChanged: () => void }) {
  const t = useTranslations('deliverables');
  const f = useFormat();
  const input = useRef<HTMLInputElement>(null);
  const draft = version?.status === 'draft' ? version : null;
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const create = useAction(createVersionAction, { refresh: false });
  const saveNotes = useAction(updateVersionNotesAction, { refresh: false });
  const submit = useAction(submitVersionAction, { refresh: true, successMessage: t('upload.submitted') });
  const removeFile = useAction(removeVersionFileAction, { refresh: false });
  const uploads = useVersionUpload(draft?.id ?? null, onChanged);

  if (!draft) {
    return (
      <Card className="grid gap-3 p-4">
        <p className="text-sm text-muted-foreground">{d.status === 'approved' ? t('upload.approvedHint') : t('upload.newVersionHint')}</p>
        <Button
          variant="soft"
          loading={create.pending}
          onClick={async () => {
            if ((await create.run({ deliverableId: d.id })).ok) onChanged();
          }}
          data-testid="new-version"
        >
          <UploadIcon />
          {t('upload.newVersion', { n: d.versionCount + 1 })}
        </Button>
      </Card>
    );
  }
  const isCopy = d.type === 'copy';
  return (
    <Card className="grid gap-3 p-4" data-testid="upload-panel">
      <div className="flex items-center gap-2">
        <h3 className="me-auto text-sm font-semibold">{t('upload.title', { n: draft.number })}</h3>
        <VersionStatusBadge status="draft" />
      </div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void uploads.upload(e.dataTransfer.files);
        }}
        className="grid place-items-center gap-1 rounded-lg border-2 border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        data-testid="upload-dropzone"
      >
        <UploadIcon className="size-5" aria-hidden />
        {t('upload.drop')}
        <span className="text-xs text-subtle-foreground">{t('upload.limits')}</span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={acceptAttribute}
        className="sr-only"
        onChange={(e) => e.target.files && void uploads.upload(e.target.files).then(() => input.current && (input.current.value = ''))}
        data-testid="version-file-input"
      />
      {uploads.items.length ? (
        <ul className="grid gap-2">
          {uploads.items.map((u) => (
            <li key={u.key} className="grid gap-1 text-xs" data-testid="upload-item" data-status={u.status}>
              <span className="flex items-center gap-2">
                <bdi className="min-w-0 flex-1 truncate font-medium">{u.name}</bdi>
                <span className={cn(u.status === 'error' ? 'text-danger' : 'text-muted-foreground')}>
                  {u.status === 'error'
                    ? u.error
                    : u.status === 'done'
                      ? t('upload.done')
                      : `${t(`upload.states.${u.status}`)} · ${f.percent(u.progress)}`}
                </span>
              </span>
              {u.status !== 'done' && u.status !== 'error' ? <Progress value={u.progress * 100} aria-label={u.name} /> : null}
              {u.resumed ? <span className="text-subtle-foreground">{t('upload.resumed')}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {draft.files.length ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {draft.files.map((file) => (
            <li key={file.id} className="flex items-center gap-2 rounded-lg border border-border p-2" data-testid="draft-file">
              {file.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img src={file.thumbUrl} alt="" className="size-10 rounded object-cover" />
              ) : (
                <FileTypeIcon kind={file.kind} className="size-10" />
              )}
              <span className="min-w-0 flex-1">
                <bdi className="block truncate text-xs font-medium">{file.name}</bdi>
                <span className="text-[0.6875rem] text-subtle-foreground">{f.bytes(file.sizeBytes)}</span>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('upload.remove')}
                onClick={async () => {
                  if ((await removeFile.run({ versionId: draft.id, fileId: file.id })).ok) onChanged();
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Field label={isCopy ? t('upload.copyText') : t('upload.notes')} optional={!isCopy}>
        {(p) => (
          <Textarea
            {...p}
            dir="auto"
            rows={isCopy ? 6 : 2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== draft.notes && void saveNotes.run({ versionId: draft.id, notes }).then(() => onChanged())}
            data-testid="version-notes"
          />
        )}
      </Field>
      <Button
        onClick={async () => {
          if (notes !== draft.notes) await saveNotes.run({ versionId: draft.id, notes });
          if ((await submit.run({ versionId: draft.id })).ok) onChanged();
        }}
        loading={submit.pending}
        disabled={uploads.busy || (!draft.files.length && !(isCopy && notes.trim()))}
        data-testid="submit-version"
      >
        <DirIcon icon={Send} />
        {d.requiresInternalReview
          ? t('upload.submitInternal')
          : d.requiresClientApproval
            ? t('upload.submitClient')
            : t('upload.submitApprove')}
      </Button>
    </Card>
  );
}

function CompareDialog({ open, onOpenChange, versions }: { open: boolean; onOpenChange: (o: boolean) => void; versions: VersionItem[] }) {
  const t = useTranslations('deliverables');
  const withImages = versions.filter((v) => v.files.some((f) => f.kind === 'image' || f.thumbUrl));
  const [a, setA] = useState(withImages[1]?.id ?? withImages[0]?.id ?? '');
  const [b, setB] = useState(withImages[0]?.id ?? '');
  const pick = (id: string) => versions.find((v) => v.id === id);
  const cover = (v?: VersionItem) => v?.files.find((f) => f.kind === 'image')?.url ?? v?.files.find((f) => f.thumbUrl)?.thumbUrl ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('close')} size="xl">
        <DialogHeader>
          <DialogTitle>{t('compare.title')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-4 sm:grid-cols-2" data-testid="compare-view">
          {[
            [a, setA],
            [b, setB],
          ].map(([value, set], i) => {
            const v = pick(value as string);
            const src = cover(v);
            return (
              <div key={i} className="grid content-start gap-2">
                <NativeSelect
                  value={value as string}
                  onChange={(e) => (set as (x: string) => void)(e.target.value)}
                  aria-label={t('compare.pick')}
                >
                  {withImages.map((x) => (
                    <option key={x.id} value={x.id}>
                      {t('versionN', { n: x.number })}
                    </option>
                  ))}
                </NativeSelect>
                <div className="grid min-h-40 place-items-center rounded-xl bg-surface-muted/60 p-2">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                    <img src={src} alt={t('versionN', { n: v?.number ?? 0 })} className="max-h-[60dvh] w-auto rounded-md" />
                  ) : (
                    <p className="text-sm text-subtle-foreground">{t('compare.noImage')}</p>
                  )}
                </div>
                {v ? <VersionStatusBadge status={v.status} /> : null}
              </div>
            );
          })}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Review screen for one deliverable, shared by the agency (internal review, uploads) and the portal (client approval).
 * Mobile-first: viewer first, then comments / versions tabs, with the decision buttons in a sticky bar.
 */
export function DeliverableReview({
  initial,
  side,
  perms,
  quota,
  backHref,
}: {
  initial: DeliverableDetail;
  side: Side;
  perms: ReviewPerms;
  quota: RevisionQuota;
  backHref?: string;
}) {
  const t = useTranslations('deliverables');
  const tw = useTranslations('workflows');
  const locale = useLocale() as Locale;
  const f = useFormat();
  const { data: d, refresh } = useDeliverable(initial);
  // Follow the newest version as new ones arrive, unless the viewer picked a version while this one was newest.
  const newest = d.versions[0]?.id ?? null;
  const [picked, setPicked] = useState<{ id: string; newest: string | null } | null>(null);
  const versionId = picked && picked.newest === newest ? picked.id : newest;
  const setVersionId = (id: string) => setPicked({ id, newest });
  const version = d.versions.find((v) => v.id === versionId) ?? d.versions[0] ?? null;
  const [fileIndex, setFileIndex] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [decision, setDecision] = useState<'approved' | 'changes_requested' | null>(null);
  const [compare, setCompare] = useState(false);
  const addAnnotation = useAction(addAnnotationAction, { refresh: false });

  const file = version?.files[Math.min(fileIndex, Math.max(0, (version?.files.length ?? 1) - 1))] ?? null;
  const versionAnnotations = d.annotations.filter((a) => a.versionId === version?.id);
  const numbering = useMemo(() => new Map(versionAnnotations.map((a, i) => [a.id, i + 1])), [versionAnnotations]);
  const shown = versionAnnotations.filter((a) => showResolved || !a.resolvedAt);
  const isCurrent = version?.id === d.current?.id || (side === 'client' && version?.id === d.versions[0]?.id);
  const stage: 'internal' | 'client' | null =
    version && isCurrent && version.status === 'internal_review' && side === 'agency' && perms.canReview
      ? 'internal'
      : version && isCurrent && version.status === 'client_review' && side === 'client' && perms.canApprove
        ? 'client'
        : null;
  const canAnnotate = Boolean(version && version.status !== 'superseded' && (side === 'agency' || version.status === 'client_review'));
  const versionSent = Boolean(version?.sentToClientAt);

  const submitAnnotation = async (body: string, visibility: 'internal' | 'client') => {
    if (!version || !pending) return false;
    const res = await addAnnotation.run({
      versionId: version.id,
      fileId: pending.kind === 'general' ? null : pending.fileId,
      kind: pending.kind,
      x: pending.kind === 'point' ? pending.x : null,
      y: pending.kind === 'point' ? pending.y : null,
      timeSeconds: pending.kind === 'timestamp' ? pending.timeSeconds : null,
      body,
      visibility,
    });
    if (res.ok) {
      setPending(null);
      setActiveId(res.data.annotationId);
      await refresh();
    }
    return res.ok;
  };

  const header = (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-subtle-foreground">
          <span>{tw(`deliverableTypes.${d.type}`)}</span>
          {side === 'agency' ? (
            <>
              <span>· {localized(d.clientName, locale)}</span>
              {d.requestId ? (
                <Link href={`/requests/${d.requestId}`} className="hover:underline">
                  · <bdi dir="ltr">{d.requestReference}</bdi>
                </Link>
              ) : null}
              {d.taskId && d.taskNumber ? (
                <Link href={`/tasks?task=${d.taskId}`} className="inline-flex items-center gap-1 hover:underline">
                  · <TaskRef number={d.taskNumber} />
                </Link>
              ) : null}
            </>
          ) : d.requestId ? (
            <Link href={`/portal/requests/${d.requestId}`} className="hover:underline">
              · <bdi dir="ltr">{d.requestReference}</bdi>
            </Link>
          ) : null}
        </div>
        <h1 className="mt-1 text-xl font-semibold" data-testid="deliverable-title">
          <bdi>{d.title}</bdi>
        </h1>
      </div>
      <div className="flex items-center gap-2">
        {side === 'agency' ? <DeliverableStatusBadge status={d.status} /> : <ClientDeliverableBadge status={d.status} />}
        {side === 'agency' && perms.canManage ? <EditDeliverableButton d={d} onSaved={() => void refresh()} /> : null}
        {side === 'agency' && perms.canDelete ? (
          <DeleteButton type="deliverable" id={d.id} redirectTo="/deliverables" iconOnly testId="deliverable-delete" />
        ) : null}
      </div>
    </div>
  );

  const versionPicker = d.versions.length ? (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect
        value={version?.id ?? ''}
        onChange={(e) => {
          setVersionId(e.target.value);
          setFileIndex(0);
          setPending(null);
        }}
        aria-label={t('versionPicker')}
        className="h-8 w-auto"
        data-testid="version-select"
      >
        {d.versions.map((v) => (
          <option key={v.id} value={v.id}>
            {t('versionN', { n: v.number })} · {t(`versionStatuses.${v.status}`)}
          </option>
        ))}
      </NativeSelect>
      {version ? <VersionStatusBadge status={version.status} /> : null}
      {d.versions.filter((v) => v.files.some((x) => x.kind === 'image')).length > 1 ? (
        <Button variant="ghost" size="sm" onClick={() => setCompare(true)} data-testid="compare-button">
          <Columns2 />
          {t('compare.button')}
        </Button>
      ) : null}
    </div>
  ) : null;

  const viewer = !version ? (
    <Card className="grid place-items-center gap-2 p-10 text-center">
      <UploadIcon className="size-6 text-subtle-foreground" aria-hidden />
      <p className="font-medium">{t('noVersions')}</p>
      <p className="text-sm text-muted-foreground">{side === 'agency' ? t('noVersionsAgency') : t('noVersionsClient')}</p>
    </Card>
  ) : (
    <div className="grid gap-3" data-testid="viewer">
      {version.files.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={t('files')}>
          {version.files.map((x, i) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={i === fileIndex}
              onClick={() => (setFileIndex(i), setPending(null))}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-lg border p-1.5 pe-3 text-xs',
                i === fileIndex ? 'border-primary bg-primary-soft/40' : 'border-border',
              )}
            >
              {x.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img src={x.thumbUrl} alt="" className="size-8 rounded object-cover" />
              ) : (
                <FileTypeIcon kind={x.kind} className="size-8" />
              )}
              <bdi className="max-w-32 truncate">{x.name}</bdi>
            </button>
          ))}
        </div>
      ) : null}
      {file?.kind === 'image' ? (
        <ImageViewer
          file={file}
          annotations={versionAnnotations}
          numbering={numbering}
          activeId={activeId}
          pending={pending}
          canAnnotate={canAnnotate}
          onPin={(x, y) => setPending({ kind: 'point', fileId: file.id, x, y })}
          onSelect={setActiveId}
        />
      ) : file?.kind === 'video' ? (
        <VideoViewer
          file={file}
          annotations={versionAnnotations}
          numbering={numbering}
          activeId={activeId}
          pending={pending}
          canAnnotate={canAnnotate}
          onTime={(s) => setPending({ kind: 'timestamp', fileId: file.id, timeSeconds: Math.round(s * 10) / 10 })}
          onSelect={setActiveId}
        />
      ) : file ? (
        <DocumentViewer file={file} />
      ) : null}
      {version.notes ? (
        <Card className={cn('p-4', d.type === 'copy' && !file && 'p-5 text-base')} data-testid="version-notes-view">
          {d.type === 'copy' && !file ? (
            <p className="mb-2 text-xs font-medium text-muted-foreground">{t('copyText')}</p>
          ) : (
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t('notes')}</p>
          )}
          <div dir="auto" className="text-sm">
            <FormattedText text={version.notes} />
          </div>
        </Card>
      ) : null}
    </div>
  );

  const comments = (
    <div className="grid gap-3" data-testid="annotations">
      {pending ? (
        <Composer
          key={JSON.stringify(pending)}
          pending={pending}
          side={side}
          versionSent={versionSent}
          onCancel={() => setPending(null)}
          onSubmit={submitAnnotation}
        />
      ) : canAnnotate ? (
        <Button
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => setPending({ kind: 'general' })}
          data-testid="add-general-comment"
        >
          <MessageSquare />
          {t('addComment')}
        </Button>
      ) : null}
      {canAnnotate && file && (file.kind === 'image' || file.kind === 'video') && !pending ? (
        <p className="text-xs text-subtle-foreground">{file.kind === 'image' ? t('hintImage') : t('hintVideo')}</p>
      ) : null}
      {versionAnnotations.some((a) => a.resolvedAt) ? (
        <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          {t('showResolved', { count: versionAnnotations.filter((a) => a.resolvedAt).length })}
          <Switch checked={showResolved} onCheckedChange={setShowResolved} />
        </label>
      ) : null}
      {shown.length === 0 && !pending ? <p className="text-sm text-subtle-foreground">{t('noComments')}</p> : null}
      <ul className="grid gap-2">
        {shown.map((a) => (
          <AnnotationCard
            key={a.id}
            a={a}
            n={numbering.get(a.id) ?? 0}
            active={a.id === activeId}
            side={side}
            canReply={side === 'agency' || a.visibility === 'client'}
            onSelect={() => {
              setActiveId(a.id);
              if (a.fileId) setFileIndex(Math.max(0, version?.files.findIndex((x) => x.id === a.fileId) ?? 0));
            }}
            onChanged={() => void refresh()}
          />
        ))}
      </ul>
    </div>
  );

  const history = (
    <ol className="grid gap-3" data-testid="version-history">
      {d.versions.map((v) => {
        const decisions = d.approvals.filter((a) => a.versionId === v.id);
        return (
          <li key={v.id} className={cn('grid gap-1.5 rounded-lg border p-3', v.id === version?.id ? 'border-primary' : 'border-border')}>
            <button type="button" className="flex items-center gap-2 text-start" onClick={() => (setVersionId(v.id), setFileIndex(0))}>
              <span className="font-semibold">{t('versionN', { n: v.number })}</span>
              <VersionStatusBadge status={v.status} />
              <span className="ms-auto text-xs text-subtle-foreground">{f.date(v.createdAt, 'medium')}</span>
            </button>
            {side === 'agency' && perms.canDelete ? (
              <div className="flex justify-end">
                <RowActions
                  label={t('edit.deleteVersion', { n: v.number })}
                  del={{ type: 'deliverable_version', id: v.id }}
                  onDeleted={() => void refresh()}
                  testId="version-actions"
                />
              </div>
            ) : null}
            {v.uploadedBy && side === 'agency' ? (
              <span className="text-xs text-muted-foreground">{t('uploadedBy', { name: v.uploadedBy.name })}</span>
            ) : null}
            {decisions.map((a) => (
              <p key={a.id} className="flex items-start gap-1.5 text-xs">
                {a.decision === 'approved' ? (
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                ) : (
                  <RotateCcw className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                )}
                <span>
                  <span className="font-medium">{t(`decisionLabels.${a.stage}.${a.decision}`, { name: a.reviewer?.name ?? '' })}</span>
                  {a.comment ? (
                    <span className="block text-muted-foreground" dir="auto">
                      {a.comment}
                    </span>
                  ) : null}
                </span>
              </p>
            ))}
          </li>
        );
      })}
    </ol>
  );

  const decisionBar = stage ? (
    <div
      className={cn(
        'sticky z-20 -mx-(--gutter) flex gap-2 border-t border-border bg-surface/95 px-(--gutter) py-3 backdrop-blur lg:static lg:mx-0 lg:rounded-xl lg:border lg:p-3',
        // The portal has a bottom tab bar on phones; sit just above it.
        side === 'client' ? 'bottom-[calc(4rem+env(safe-area-inset-bottom))]' : 'bottom-0',
      )}
      data-testid="decision-bar"
    >
      <Button variant="outline" className="flex-1" onClick={() => setDecision('changes_requested')} data-testid="request-changes">
        <RotateCcw />
        {t('decision.requestChanges')}
      </Button>
      <Button className="flex-1" onClick={() => setDecision('approved')} data-testid="approve">
        <CheckCircle2 />
        {t('decision.approve')}
      </Button>
    </div>
  ) : side === 'client' && version?.status === 'client_review' && !perms.canApprove ? (
    <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-muted-foreground">{t('decision.noRight')}</p>
  ) : null;

  return (
    <div className="grid gap-5" data-testid="deliverable-review" data-status={d.status}>
      {backHref ? (
        <Link href={backHref} className="inline-flex w-fit items-center gap-1 text-sm text-link hover:underline">
          <DirIcon icon={ArrowUpRight} className="size-4 rotate-[-135deg] rtl:rotate-[135deg]" />
          {t('back')}
        </Link>
      ) : null}
      {header}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid min-w-0 content-start gap-3">
          {versionPicker}
          {viewer}
        </div>
        <aside className="grid min-w-0 content-start gap-4">
          {decisionBar}
          {side === 'agency' && perms.canManage ? (
            <UploadPanel key={d.versions[0]?.id ?? 'none'} d={d} version={d.versions[0] ?? null} onChanged={() => void refresh()} />
          ) : null}
          <Tabs defaultValue="comments">
            <TabsList className="w-full">
              <TabsTrigger value="comments" className="flex-1" data-testid="tab-comments">
                {t('tabs.comments')}
                <Badge tone="neutral">{f.number(versionAnnotations.filter((a) => !a.resolvedAt).length)}</Badge>
              </TabsTrigger>
              <TabsTrigger value="versions" className="flex-1" data-testid="tab-versions">
                {t('tabs.versions')}
                <Badge tone="neutral">{f.number(d.versions.length)}</Badge>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="comments" className="pt-3">
              {comments}
            </TabsContent>
            <TabsContent value="versions" className="pt-3">
              {history}
            </TabsContent>
          </Tabs>
          {side === 'agency' && d.revisionRounds ? (
            <p className="text-xs text-muted-foreground" data-testid="revision-rounds">
              {t('revisionRounds', { count: d.revisionRounds })}
            </p>
          ) : null}
        </aside>
      </div>
      {version && decision && stage ? (
        <DecisionDialog
          open={Boolean(decision)}
          onOpenChange={(o) => !o && setDecision(null)}
          decision={decision}
          stage={stage}
          versionId={version.id}
          quota={quota}
          onDone={() => void refresh()}
        />
      ) : null}
      <CompareDialog open={compare} onOpenChange={setCompare} versions={d.versions} />
    </div>
  );
}
