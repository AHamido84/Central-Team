'use client';

import { AlertTriangle, ArrowLeft, ArrowRight, Check, Loader2, Package, Paperclip, Save, SendHorizontal, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { DirIcon, FileTypeIcon } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { Badge, Card } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { acceptAttribute } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { useUpload } from '@/modules/files/components/use-upload';
import { PriorityBadge, TypeIcon } from '@/modules/requests/components/badges';
import { BriefFields, BriefView, type KnownFile } from '@/modules/requests/components/brief-fields';
import { addWorkingDays, clientPriorities, type RequestPriority } from '@/modules/requests/constants';
import { defaultBrief, validateBrief, type RequestFormField } from '@/modules/requests/form-schema';
import { requestTitleSchema } from '@/modules/requests/schemas';
import { resubmitRequestAction, saveRequestDraftAction, submitRequestAction } from '@/modules/requests/server/actions';
import type { Quota, RequestTypeItem } from '@/modules/requests/server/queries';

const MAX_ATTACHMENTS = 20;
const steps = ['type', 'brief', 'attachments', 'schedule', 'review'] as const;
type Step = (typeof steps)[number];

export type WizardInitial = {
  requestId: string;
  typeId: string;
  title: string;
  brief: Record<string, unknown>;
  referenceLinks: string[];
  desiredDate: string | null;
  priority: RequestPriority;
  /** General attachments (not tied to a brief field). */
  attachments: KnownFile[];
  /** Files already referenced by brief file fields. */
  briefFiles: KnownFile[];
  /** Needs info: the form snapshot the request was submitted with (the type may have changed since). */
  fields?: RequestFormField[];
  reason?: string | null;
};

function kindOf(mime: string) {
  if (mime.startsWith('image/')) return 'image' as const;
  if (mime.startsWith('video/')) return 'video' as const;
  if (mime === 'application/pdf') return 'pdf' as const;
  return 'document' as const;
}

/** Remaining package quota for a type; null when the type doesn't count against the package. */
export function remainingFor(type: RequestTypeItem, quotas: Record<string, Quota>) {
  if (!type.packageItemType) return null;
  const q = quotas[type.packageItemType];
  if (!q || !q.hasPackage) return { remaining: 0, allowed: 0, q };
  return { remaining: q.allowed - q.used - q.pending, allowed: q.allowed, q };
}

export function QuotaNote({ type, quotas, compact }: { type: RequestTypeItem; quotas: Record<string, Quota>; compact?: boolean }) {
  const t = useTranslations('requests');
  const f = useFormat();
  const r = remainingFor(type, quotas);
  if (!r) return compact ? null : <p className="text-xs text-subtle-foreground">{t('quota.notCounted')}</p>;
  const item = type.packageItemType!;
  const itemLabel = t(`quota.items.${item}`);
  if (r.remaining <= 0) {
    return (
      <p
        className={cn('flex items-start gap-1.5 text-xs text-warning', !compact && 'rounded-md bg-warning-soft px-3 py-2')}
        data-testid="quota-extra"
      >
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {r.allowed === 0 ? t('quota.notIncluded', { item: itemLabel }) : t('quota.exceeded', { item: itemLabel })}
      </p>
    );
  }
  return (
    <p
      className={cn('flex items-start gap-1.5 text-xs text-muted-foreground', !compact && 'rounded-md bg-surface-muted px-3 py-2')}
      data-testid="quota-ok"
    >
      <Package className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {t('quota.remaining', { count: f.number(r.remaining), total: f.number(r.allowed), item: itemLabel })}
    </p>
  );
}

/**
 * Portal request wizard: type → brief → attachments & references → desired date & priority → review.
 * "Save draft" works on every step after a type is chosen. In Needs-info mode it edits the submitted brief and resubmits.
 */
export function RequestWizard({
  types,
  quotas,
  clientId,
  initial,
  mode = 'new',
}: {
  types: RequestTypeItem[];
  quotas: Record<string, Quota>;
  clientId: string;
  initial?: WizardInitial;
  mode?: 'new' | 'draft' | 'needs_info';
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const router = useRouter();
  const needsInfo = mode === 'needs_info';
  const [step, setStep] = useState<Step>(initial ? 'brief' : 'type');
  const [requestId, setRequestId] = useState<string | undefined>(initial?.requestId);
  const [typeId, setTypeId] = useState<string | null>(initial?.typeId ?? null);
  const type = types.find((x) => x.id === typeId) ?? null;
  const fields = needsInfo && initial?.fields ? initial.fields : (type?.fields ?? []);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [brief, setBrief] = useState<Record<string, unknown>>(() => ({ ...defaultBrief(fields), ...(initial?.brief ?? {}) }));
  const [links, setLinks] = useState<string[]>(initial?.referenceLinks?.length ? initial.referenceLinks : ['']);
  const [desiredDate, setDesiredDate] = useState(initial?.desiredDate ?? '');
  const [priority, setPriority] = useState<RequestPriority>(
    initial?.priority ?? (type && clientPriorities.includes(type.defaultPriority) ? type.defaultPriority : 'normal'),
  );
  const [note, setNote] = useState('');
  const [known, setKnown] = useState<Record<string, KnownFile>>(() =>
    Object.fromEntries([...(initial?.attachments ?? []), ...(initial?.briefFiles ?? [])].map((k) => [k.id, k])),
  );
  const [attachments, setAttachments] = useState<string[]>(initial?.attachments.map((a) => a.id) ?? []);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const uploads = useUpload();
  const saveDraft = useAction(saveRequestDraftAction, { refresh: false });
  const submit = useAction(submitRequestAction, { refresh: false });
  const resubmit = useAction(resubmitRequestAction, { refresh: false });
  const busy = saveDraft.pending || submit.pending || resubmit.pending || uploads.busy;

  const visibleSteps: readonly Step[] = needsInfo ? steps.filter((s) => s !== 'type') : steps;
  const index = visibleSteps.indexOf(step);

  const payload = () => ({
    requestId,
    typeId: typeId!,
    title,
    brief,
    referenceLinks: links.map((l) => l.trim()).filter(Boolean),
    desiredDate,
    priority,
    attachmentIds: attachments,
  });

  const mapServerErrors = (fieldErrors?: Record<string, string[]>) => {
    if (!fieldErrors) return;
    const next: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(fieldErrors)) next[k.replace(/^brief\./, '')] = v[0];
    setErrors(next);
    if (Object.keys(next).some((k) => k !== 'referenceLinks')) setStep('brief');
  };

  const validateStep = (s: Step): boolean => {
    const next: Record<string, string | undefined> = {};
    if (s === 'brief' || s === 'review') {
      const tr = requestTitleSchema.safeParse(title);
      if (!tr.success) next.title = tr.error.issues[0]?.message;
      const br = validateBrief(fields, brief, 'submit');
      if (!br.ok) Object.assign(next, br.errors);
    }
    if (s === 'attachments' || s === 'review') {
      const bad = links
        .map((l) => l.trim())
        .filter(Boolean)
        .some((l) => !/^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(l));
      if (bad) next.referenceLinks = 'invalid_url';
    }
    setErrors(next);
    if (Object.keys(next).length) {
      if (s === 'review') setStep(next.referenceLinks && Object.keys(next).length === 1 ? 'attachments' : 'brief');
      toast.error(t('errors.validation'));
      return false;
    }
    return true;
  };

  const go = (delta: 1 | -1) => {
    if (delta === 1 && step !== 'type' && !validateStep(step)) return;
    const target = visibleSteps[index + delta];
    if (target) setStep(target);
  };

  const onSaveDraft = async () => {
    if (!typeId) return;
    const res = await saveDraft.run(payload());
    if (res.ok) {
      toast.success(t('requests.wizard.draftSaved'));
      if (!requestId) {
        setRequestId(res.data.requestId);
        router.replace(`/portal/requests/${res.data.requestId}/edit`);
      }
    } else mapServerErrors(res.error.fieldErrors);
  };

  const onSubmit = async () => {
    if (!validateStep('review')) return;
    if (needsInfo) {
      const res = await resubmit.run({ ...payload(), requestId: requestId!, note: note.trim() || undefined });
      if (res.ok) {
        toast.success(t('requests.wizard.resubmitted'));
        router.push(`/portal/requests/${res.data.requestId}`);
        router.refresh();
      } else mapServerErrors(res.error.fieldErrors);
      return;
    }
    const res = await submit.run(payload());
    if (res.ok) {
      toast.success(t('requests.submitted', { reference: res.data.reference }));
      router.push(`/portal/requests/${res.data.requestId}`);
      router.refresh();
    } else mapServerErrors(res.error.fieldErrors);
  };

  const pickFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const chosen = Array.from(list).slice(0, Math.max(MAX_ATTACHMENTS - attachments.length, 0));
    const ids = await uploads.upload(chosen, { clientId, folderId: null, threadId: null, visibility: 'client', forRequest: true });
    setKnown((k) => ({
      ...k,
      ...Object.fromEntries(
        ids.map((id, i) => [
          id,
          { id, name: chosen[i]?.name ?? '', mimeType: chosen[i]?.type || 'application/octet-stream', sizeBytes: chosen[i]?.size ?? 0 },
        ]),
      ),
    }));
    setAttachments((a) => [...a, ...ids]);
    uploads.clear();
    if (fileInput.current) fileInput.current.value = '';
  };

  const chooseType = (id: string) => {
    const next = types.find((x) => x.id === id);
    if (!next) return;
    if (id !== typeId) {
      setBrief(defaultBrief(next.fields));
      setPriority(clientPriorities.includes(next.defaultPriority) ? next.defaultPriority : 'normal');
      setErrors({});
    }
    setTypeId(id);
    setStep('brief');
  };

  const today = new Date().toISOString().slice(0, 10);
  const expectedBy = type?.slaDays ? addWorkingDays(today, type.slaDays) : null;
  const reviewFiles = [...attachments, ...Object.values(brief).flatMap((v) => (Array.isArray(v) ? v : []))]
    .map((id) => known[id as string])
    .filter(Boolean) as KnownFile[];

  return (
    <div className="grid grid-cols-1 gap-6" data-testid="request-wizard" data-step={step}>
      {/* Stepper */}
      <ol
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${visibleSteps.length}, minmax(0, 1fr))` }}
        aria-label={t('requests.wizard.progress')}
      >
        {visibleSteps.map((s, i) => {
          const done = i < index;
          const active = i === index;
          return (
            <li key={s} className="grid gap-1.5" aria-current={active ? 'step' : undefined}>
              <span className={cn('h-1.5 rounded-full', done || active ? 'bg-primary' : 'bg-surface-muted')} />
              <span className={cn('hidden truncate text-xs sm:block', active ? 'font-semibold' : 'text-muted-foreground')}>
                {t(`requests.wizard.steps.${s}`)}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-sm font-medium sm:hidden">
        {t('requests.wizard.stepOf', { step: index + 1, total: visibleSteps.length })} · {t(`requests.wizard.steps.${step}`)}
      </p>

      {needsInfo && initial?.reason ? (
        <div className="rounded-xl border border-warning/40 bg-warning-soft p-4" data-testid="needs-info-question">
          <p className="text-sm font-medium">{t('requests.needsInfo.theyAsked')}</p>
          <p dir="auto" className="mt-1 text-sm whitespace-pre-wrap">
            {initial.reason}
          </p>
        </div>
      ) : null}

      {step === 'type' ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="type-picker">
          {types.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => chooseType(x.id)}
                className={cn(
                  'flex h-full w-full items-start gap-3 rounded-xl border bg-surface p-4 text-start shadow-xs transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  typeId === x.id ? 'border-primary ring-1 ring-primary' : 'border-border',
                )}
                aria-pressed={typeId === x.id}
                data-testid="type-option"
              >
                <TypeIcon icon={x.icon} size="lg" />
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="font-semibold">{localized(x.name, locale)}</span>
                  {localized(x.description, locale) ? (
                    <span className="text-sm text-muted-foreground">{localized(x.description, locale)}</span>
                  ) : null}
                  {x.slaDays ? (
                    <span className="text-xs text-subtle-foreground">{t('requests.wizard.typicalTime', { days: x.slaDays })}</span>
                  ) : null}
                  <QuotaNote type={x} quotas={quotas} compact />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {step === 'brief' && type ? (
        <Card className="grid gap-6 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <TypeIcon icon={type.icon} />
            <div className="min-w-0">
              <h2 className="font-semibold">{localized(type.name, locale)}</h2>
              {!needsInfo ? (
                <button type="button" className="text-xs text-link hover:underline" onClick={() => setStep('type')}>
                  {t('requests.wizard.changeType')}
                </button>
              ) : null}
            </div>
          </div>
          <Field label={t('requests.fields.title')} hint={t('requests.fields.titleHint')} error={errors.title} required>
            {(p) => (
              <Input
                {...p}
                dir="auto"
                value={title}
                maxLength={140}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="request-title"
              />
            )}
          </Field>
          <BriefFields
            fields={fields}
            values={brief}
            errors={errors}
            clientId={clientId}
            known={known}
            onKnown={(list) => setKnown((k) => ({ ...k, ...Object.fromEntries(list.map((x) => [x.id, x])) }))}
            onChange={(id, value) => {
              setBrief((b) => ({ ...b, [id]: value }));
              if (errors[id]) setErrors((e) => ({ ...e, [id]: undefined }));
            }}
          />
        </Card>
      ) : null}

      {step === 'attachments' ? (
        <Card className="grid gap-6 p-5 sm:p-6">
          <div className="grid gap-2">
            <p className="text-sm font-medium">{t('requests.attachments')}</p>
            <div
              className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong p-5 text-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void pickFiles(e.dataTransfer.files);
              }}
            >
              <Paperclip className="size-5 text-subtle-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">{t('requests.attachHint', { max: MAX_ATTACHMENTS })}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={attachments.length >= MAX_ATTACHMENTS}
              >
                {t('requests.chooseFiles')}
              </Button>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={acceptAttribute}
                className="sr-only"
                onChange={(e) => void pickFiles(e.target.files)}
                data-testid="request-attachment-input"
              />
            </div>
            {attachments.length || uploads.items.length ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {attachments.map((id) => {
                  const file = known[id];
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                      data-testid="request-attachment"
                      data-status="done"
                    >
                      <FileTypeIcon kind={kindOf(file?.mimeType ?? '')} className="size-8" />
                      <span className="min-w-0 flex-1">
                        <bdi className="block truncate text-sm font-medium">{file?.name}</bdi>
                        <span className="block text-xs text-subtle-foreground">{file ? f.bytes(file.sizeBytes) : null}</span>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setAttachments((a) => a.filter((x) => x !== id))}
                        aria-label={t('common.remove')}
                      >
                        <X />
                      </Button>
                    </li>
                  );
                })}
                {uploads.items
                  .filter((u) => u.status !== 'done')
                  .map((u) => (
                    <li
                      key={u.key}
                      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
                      data-testid="request-attachment"
                      data-status={u.status}
                    >
                      <Loader2 className="size-4 animate-spin text-subtle-foreground" aria-hidden />
                      <bdi className="min-w-0 flex-1 truncate text-sm">{u.name}</bdi>
                      <span className="text-xs text-subtle-foreground">{f.percent(u.progress)}</span>
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
          <div className="grid gap-2">
            <p className="text-sm font-medium">{t('requests.referenceLinks')}</p>
            <p className="text-xs text-subtle-foreground">{t('requests.referenceLinksHint')}</p>
            {links.map((l, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  dir="ltr"
                  inputMode="url"
                  placeholder="https://"
                  value={l}
                  onChange={(e) => setLinks((x) => x.map((v, j) => (j === i ? e.target.value : v)))}
                  aria-label={`${t('requests.referenceLinks')} ${i + 1}`}
                  aria-invalid={errors.referenceLinks ? true : undefined}
                  data-testid="reference-link"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setLinks((x) => (x.length === 1 ? [''] : x.filter((_, j) => j !== i)))}
                  aria-label={t('common.remove')}
                >
                  <X />
                </Button>
              </div>
            ))}
            {links.length < 10 ? (
              <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => setLinks((x) => [...x, ''])}>
                {t('requests.addLink')}
              </Button>
            ) : null}
            {errors.referenceLinks ? (
              <p role="alert" className="text-xs font-medium text-danger">
                {t('validation.invalid_url')}
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {step === 'schedule' && type ? (
        <Card className="grid gap-5 p-5 sm:p-6">
          <Field label={t('requests.fields.desiredDate')} hint={t('requests.fields.desiredDateHint')} optional>
            {(p) => (
              <Input
                {...p}
                type="date"
                dir="ltr"
                min={today}
                value={desiredDate}
                onChange={(e) => setDesiredDate(e.target.value)}
                className="max-w-56"
                data-testid="request-desired-date"
              />
            )}
          </Field>
          {expectedBy ? (
            <p className="text-xs text-subtle-foreground">
              {t('requests.wizard.expectedBy', { date: f.date(`${expectedBy}T12:00:00`, 'long') })}
            </p>
          ) : null}
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('requests.priority')}</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {clientPriorities.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={priority === p}
                  onClick={() => setPriority(p)}
                  className={cn(
                    'rounded-lg border px-4 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    priority === p
                      ? 'border-primary bg-primary-soft font-medium text-primary-soft-foreground'
                      : 'border-border hover:bg-surface-muted',
                  )}
                  data-testid={`priority-${p}`}
                >
                  {t(`requests.priorities.${p}`)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-subtle-foreground">{t('requests.wizard.priorityHint')}</p>
          </fieldset>
        </Card>
      ) : null}

      {step === 'review' && type ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="grid min-w-0 gap-5 p-5 sm:p-6" data-testid="wizard-review">
            <div className="flex items-center gap-3">
              <TypeIcon icon={type.icon} />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{localized(type.name, locale)}</p>
                <p className="truncate font-semibold">
                  <bdi>{title}</bdi>
                </p>
              </div>
            </div>
            <BriefView
              fields={fields}
              brief={validateBrief(fields, brief, 'draft').data}
              files={reviewFiles.map((k) => ({
                ...k,
                kind: kindOf(k.mimeType),
                visibility: 'client',
                folderId: null,
                uploaderName: null,
                uploaderAvatar: null,
                uploaderSide: 'client',
                createdAt: '',
                fieldId: null,
              }))}
            />
            {reviewFiles.length ? (
              <div className="grid gap-2">
                <p className="text-sm text-muted-foreground">{t('requests.attachments')}</p>
                <ul className="flex flex-wrap gap-2">
                  {reviewFiles.map((k) => (
                    <li key={k.id} className="inline-flex max-w-60 items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
                      <FileTypeIcon kind={kindOf(k.mimeType)} className="size-6" />
                      <bdi className="truncate">{k.name}</bdi>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {links.filter((l) => l.trim()).length ? (
              <div className="grid gap-1">
                <p className="text-sm text-muted-foreground">{t('requests.referenceLinks')}</p>
                {links
                  .filter((l) => l.trim())
                  .map((l) => (
                    <bdi key={l} dir="ltr" className="truncate text-sm">
                      {l}
                    </bdi>
                  ))}
              </div>
            ) : null}
          </Card>
          <div className="grid content-start gap-3">
            <Card className="grid gap-3 p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t('requests.priority')}</span>
                <PriorityBadge priority={priority} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t('requests.fields.desiredDate')}</span>
                <span>{desiredDate ? f.date(`${desiredDate}T12:00:00`, 'long') : '—'}</span>
              </div>
              {expectedBy ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t('requests.wizard.expected')}</span>
                  <span>{f.date(`${expectedBy}T12:00:00`, 'long')}</span>
                </div>
              ) : null}
            </Card>
            {!needsInfo ? <QuotaNote type={type} quotas={quotas} /> : null}
            {needsInfo ? (
              <Field label={t('requests.needsInfo.note')} hint={t('requests.needsInfo.noteHint')} optional>
                {(p) => (
                  <Textarea {...p} dir="auto" rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-testid="resubmit-note" />
                )}
              </Field>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Actions */}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-(--gutter) flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-(--gutter) py-3 backdrop-blur lg:bottom-0">
        {index > 0 ? (
          <Button variant="ghost" onClick={() => go(-1)} disabled={busy}>
            <DirIcon icon={ArrowLeft} />
            {t('common.back')}
          </Button>
        ) : null}
        <span className="ms-auto" />
        {!needsInfo && typeId && step !== 'type' ? (
          <Button variant="outline" onClick={() => void onSaveDraft()} loading={saveDraft.pending} disabled={busy} data-testid="save-draft">
            <Save />
            <span className="hidden sm:inline">{t('requests.wizard.saveDraft')}</span>
          </Button>
        ) : null}
        {step === 'review' ? (
          <Button onClick={() => void onSubmit()} loading={submit.pending || resubmit.pending} disabled={busy} data-testid="request-submit">
            {submit.pending || resubmit.pending ? null : <DirIcon icon={SendHorizontal} />}
            {needsInfo ? t('requests.wizard.resubmit') : t('requests.submit')}
          </Button>
        ) : step !== 'type' ? (
          <Button onClick={() => go(1)} disabled={busy} data-testid="wizard-next">
            {t('requests.wizard.next')}
            <DirIcon icon={ArrowRight} />
          </Button>
        ) : typeId ? (
          <Button onClick={() => setStep('brief')} data-testid="wizard-next">
            {t('requests.wizard.next')}
            <DirIcon icon={ArrowRight} />
          </Button>
        ) : null}
      </div>
      {step === 'review' && !needsInfo && type && remainingFor(type, quotas) && remainingFor(type, quotas)!.remaining <= 0 ? (
        <Badge tone="accent" className="w-fit">
          <Check />
          {t('requests.wizard.extraAllowed')}
        </Badge>
      ) : null}
    </div>
  );
}
