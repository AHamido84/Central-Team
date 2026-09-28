'use client';

import { Loader2, Paperclip, SendHorizontal, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { DirIcon, FileTypeIcon } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { acceptAttribute } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { useUpload } from '@/modules/files/components/use-upload';
import { FormIcon } from '@/modules/requests/components/badges';
import { DynamicFields } from '@/modules/requests/components/dynamic-form';
import { formatRequestNumber } from '@/modules/requests/constants';
import { buildAnswersSchema, defaultAnswers } from '@/modules/requests/form-schema';
import { requestTitleSchema } from '@/modules/requests/schemas';
import { submitRequestAction } from '@/modules/requests/server/actions';
import type { PublishedForm } from '@/modules/requests/server/queries';

const MAX_ATTACHMENTS = 10;

function kindOf(mime: string) {
  if (mime.startsWith('image/')) return 'image' as const;
  if (mime.startsWith('video/')) return 'video' as const;
  if (mime === 'application/pdf') return 'pdf' as const;
  return 'document' as const;
}

/** Portal submission: title, the form's questions, desired date, urgency and attachments (uploaded with progress). */
export function NewRequestForm({ form, clientId, basePath }: { form: PublishedForm; clientId: string; basePath: string }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => defaultAnswers(form.fields));
  const [desiredDate, setDesiredDate] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const uploads = useUpload();
  const done = uploads.items.filter((u) => u.status === 'done' && u.fileId);
  const submit = useAction(submitRequestAction, { refresh: false });

  const validate = () => {
    const next: Record<string, string | undefined> = {};
    const titleResult = requestTitleSchema.safeParse(title);
    if (!titleResult.success) next.title = titleResult.error.issues[0]?.message;
    const parsed = buildAnswersSchema(form.fields).safeParse(answers);
    if (!parsed.success) for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (uploads.busy) return;
    if (!validate()) {
      toast.error(t('errors.validation'));
      return;
    }
    const res = await submit.run({
      formId: form.id,
      title,
      answers,
      desiredDate,
      urgent,
      attachmentIds: done.map((u) => u.fileId!),
    });
    if (res.ok) {
      toast.success(t('requests.submitted', { number: formatRequestNumber(res.data.number) }));
      router.push(`${basePath}/${res.data.requestId}`);
    } else if (res.error.fieldErrors) {
      const next: Record<string, string | undefined> = {};
      for (const [key, messages] of Object.entries(res.error.fieldErrors)) next[key.replace(/^answers\./, '')] = messages[0];
      setErrors(next);
    }
  };

  const attach = async (list: FileList | null) => {
    if (!list?.length) return;
    const room = MAX_ATTACHMENTS - uploads.items.length;
    await uploads.upload(Array.from(list).slice(0, Math.max(room, 0)), {
      clientId,
      folderId: null,
      threadId: null,
      visibility: 'client',
      forRequest: true,
    });
    if (fileInput.current) fileInput.current.value = '';
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
      data-testid="new-request-form"
    >
      <Card className="grid gap-6 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <FormIcon icon={form.icon} />
          <div className="min-w-0">
            <h2 className="font-semibold">{localized(form.name, locale)}</h2>
            {localized(form.description, locale) ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{localized(form.description, locale)}</p>
            ) : null}
          </div>
        </div>
        <Field label={t('requests.fields.title')} hint={t('requests.fields.titleHint')} error={errors.title} required>
          {(p) => (
            <Input {...p} dir="auto" value={title} maxLength={140} onChange={(e) => setTitle(e.target.value)} data-testid="request-title" />
          )}
        </Field>
        <DynamicFields
          fields={form.fields}
          values={answers}
          errors={errors}
          onChange={(id, value) => {
            setAnswers((a) => ({ ...a, [id]: value }));
            if (errors[id]) setErrors((e) => ({ ...e, [id]: undefined }));
          }}
        />

        <div className="grid gap-2">
          <p className="text-sm font-medium">{t('requests.attachments')}</p>
          <div
            className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-strong p-5 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void attach(e.dataTransfer.files);
            }}
          >
            <Paperclip className="size-5 text-subtle-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">{t('requests.attachHint', { max: MAX_ATTACHMENTS })}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInput.current?.click()}
              disabled={uploads.items.length >= MAX_ATTACHMENTS}
            >
              {t('requests.chooseFiles')}
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={acceptAttribute}
              className="sr-only"
              onChange={(e) => void attach(e.target.files)}
              data-testid="request-attachment-input"
            />
          </div>
          {uploads.items.length ? (
            <ul className="grid gap-2">
              {uploads.items.map((u) => (
                <li
                  key={u.key}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2',
                    u.status === 'error' ? 'border-danger/40 bg-danger-soft/40' : 'border-border',
                  )}
                  data-testid="request-attachment"
                  data-status={u.status}
                >
                  <FileTypeIcon kind={kindOf(u.mimeType)} className="size-8" />
                  <span className="min-w-0 flex-1">
                    <bdi className="block truncate text-sm font-medium">{u.name}</bdi>
                    <span className="block text-xs text-subtle-foreground">
                      {u.status === 'error' ? u.error : u.status === 'uploading' ? f.percent(u.progress) : f.bytes(u.size)}
                    </span>
                  </span>
                  {u.status === 'uploading' ? (
                    <Loader2 className="size-4 animate-spin text-subtle-foreground" aria-hidden />
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => uploads.remove(u.key)}
                      aria-label={t('common.remove')}
                    >
                      <X />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Card>

      <div className="grid content-start gap-4">
        <Card className="grid gap-4 p-5">
          <Field label={t('requests.fields.desiredDate')} hint={t('requests.fields.desiredDateHint')} optional>
            {(p) => <Input {...p} type="date" dir="ltr" min={today} value={desiredDate} onChange={(e) => setDesiredDate(e.target.value)} />}
          </Field>
          <label className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
            <span>
              <span className="block text-sm font-medium">{t('requests.fields.urgent')}</span>
              <span className="block text-xs text-subtle-foreground">{t('requests.fields.urgentHint')}</span>
            </span>
            <Switch checked={urgent} onCheckedChange={setUrgent} data-testid="request-urgent" />
          </label>
          {form.responseSlaHours ? (
            <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
              {t('requests.responseTime', { hours: form.responseSlaHours })}
            </p>
          ) : null}
        </Card>
        <Button type="submit" size="lg" loading={submit.pending} disabled={uploads.busy} data-testid="request-submit">
          {submit.pending ? null : <DirIcon icon={SendHorizontal} />}
          {t('requests.submit')}
        </Button>
      </div>
    </form>
  );
}
