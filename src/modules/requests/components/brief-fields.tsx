'use client';

import { ExternalLink, Loader2, Paperclip, Plus, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useRef, useState, type ReactNode } from 'react';

import { FileTypeIcon } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { Badge, Checkbox, NativeSelect } from '@/components/ui/primitives';
import { localized, type Locale } from '@/lib/i18n/localized';
import { acceptAttribute } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { FilePreviewDialog } from '@/modules/files/components/file-preview';
import { useUpload } from '@/modules/files/components/use-upload';
import type { FileItem } from '@/modules/files/server/queries';
import { aspectRatios, platforms } from '@/modules/requests/constants';
import { DEFAULT_MAX_ITEMS, isEmptyAnswer, isFieldVisible, type Dimensions, type RequestFormField } from '@/modules/requests/form-schema';

export type KnownFile = { id: string; name: string; mimeType: string; sizeBytes: number };

function kindOf(mime: string) {
  if (mime.startsWith('image/')) return 'image' as const;
  if (mime.startsWith('video/')) return 'video' as const;
  if (mime === 'application/pdf') return 'pdf' as const;
  return 'document' as const;
}

function Required() {
  return (
    <span className="ms-0.5 text-danger" aria-hidden>
      *
    </span>
  );
}

function ErrorText({ error }: { error?: string }) {
  const t = useTranslations();
  if (!error) return null;
  const key = `validation.${error}` as Parameters<typeof t>[0];
  return (
    <p role="alert" className="text-xs font-medium text-danger">
      {t.has(key) ? t(key) : error}
    </p>
  );
}

function Chips({
  options,
  value,
  onChange,
  disabled,
  testId,
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" data-testid={testId}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              on
                ? 'border-primary bg-primary-soft font-medium text-primary-soft-foreground'
                : 'border-border bg-surface text-muted-foreground hover:bg-surface-muted',
            )}
            data-value={o.value}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A labelled group for inputs that aren't a single control (chips, lists, files). */
function Group({
  field,
  label,
  help,
  error,
  children,
}: {
  field: RequestFormField;
  label: string;
  help: string;
  error?: string;
  children: ReactNode;
}) {
  const t = useTranslations('common');
  return (
    <fieldset className="grid gap-1.5" aria-invalid={error ? true : undefined}>
      <legend className="mb-1.5 flex w-full items-center justify-between gap-2 text-sm font-medium">
        <span>
          {label}
          {field.required ? <Required /> : null}
        </span>
        {!field.required ? <span className="text-xs font-normal text-subtle-foreground">{t('optional')}</span> : null}
      </legend>
      {children}
      {help && !error ? <p className="text-xs text-subtle-foreground">{help}</p> : null}
      <ErrorText error={error} />
    </fieldset>
  );
}

function FileField({
  field,
  value,
  onChange,
  clientId,
  known,
  onKnown,
  disabled,
}: {
  field: RequestFormField;
  value: string[];
  onChange: (v: string[]) => void;
  clientId: string;
  known: Record<string, KnownFile>;
  onKnown: (files: KnownFile[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('requests');
  const f = useFormat();
  const input = useRef<HTMLInputElement>(null);
  const uploads = useUpload();
  const max = field.maxItems ?? DEFAULT_MAX_ITEMS.file;
  const pending = uploads.items.filter((u) => u.status !== 'done');
  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    const room = Math.max(max - value.length, 0);
    const chosen = Array.from(list).slice(0, room);
    const ids = await uploads.upload(chosen, { clientId, folderId: null, threadId: null, visibility: 'client', forRequest: true });
    onKnown(
      ids.map((id, i) => ({
        id,
        name: chosen[i]?.name ?? '',
        mimeType: chosen[i]?.type || 'application/octet-stream',
        sizeBytes: chosen[i]?.size ?? 0,
      })),
    );
    onChange([...value, ...ids]);
    uploads.clear();
    if (input.current) input.current.value = '';
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => input.current?.click()}
          disabled={disabled || value.length >= max}
          data-testid={`brief-${field.id}-upload`}
        >
          <Paperclip />
          {t('chooseFiles')}
        </Button>
        <span className="text-xs text-subtle-foreground">{t('filesLeft', { count: Math.max(max - value.length, 0) })}</span>
        <input
          ref={input}
          type="file"
          multiple
          accept={acceptAttribute}
          className="sr-only"
          onChange={(e) => void pick(e.target.files)}
          data-testid={`brief-${field.id}-input`}
        />
      </div>
      {value.length || pending.length ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {value.map((id) => {
            const file = known[id];
            return (
              <li
                key={id}
                className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5"
                data-testid="brief-file"
                data-status="done"
              >
                <FileTypeIcon kind={kindOf(file?.mimeType ?? '')} className="size-8" />
                <span className="min-w-0 flex-1">
                  <bdi className="block truncate text-sm font-medium">{file?.name ?? t('attachedFile')}</bdi>
                  {file ? <span className="block text-xs text-subtle-foreground">{f.bytes(file.sizeBytes)}</span> : null}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled}
                  onClick={() => onChange(value.filter((v) => v !== id))}
                  aria-label={t('removeFile')}
                >
                  <X />
                </Button>
              </li>
            );
          })}
          {pending.map((u) => (
            <li
              key={u.key}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-2 py-1.5',
                u.status === 'error' ? 'border-danger/40' : 'border-border',
              )}
              data-testid="brief-file"
              data-status={u.status}
            >
              {u.status === 'uploading' ? (
                <Loader2 className="size-4 animate-spin text-subtle-foreground" aria-hidden />
              ) : (
                <X className="size-4 text-danger" aria-hidden />
              )}
              <bdi className="min-w-0 flex-1 truncate text-sm">{u.name}</bdi>
              <span className="text-xs text-subtle-foreground">{u.status === 'error' ? u.error : f.percent(u.progress)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ListField({
  value,
  onChange,
  max,
  disabled,
  kind,
  testId,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  max: number;
  disabled?: boolean;
  kind: 'link' | 'color';
  testId: string;
}) {
  const t = useTranslations('requests');
  const [draft, setDraft] = useState(kind === 'color' ? '#4f46e5' : '');
  const add = () => {
    const v = draft.trim();
    if (!v || value.includes(v) || value.length >= max) return;
    onChange([...value, v]);
    if (kind === 'link') setDraft('');
  };
  return (
    <div className="grid gap-2" data-testid={testId}>
      {value.length ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((v) => (
            <li key={v} className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-sm">
              {kind === 'color' ? (
                <span className="size-4 rounded-sm border border-border" style={{ backgroundColor: v }} aria-hidden />
              ) : null}
              <bdi dir="ltr" className="truncate">
                {v}
              </bdi>
              <button type="button" disabled={disabled} onClick={() => onChange(value.filter((x) => x !== v))} aria-label={t('removeItem')}>
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {value.length < max ? (
        <div className="flex gap-2">
          {kind === 'color' ? (
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(draft) ? draft : '#000000'}
              onChange={(e) => setDraft(e.target.value)}
              className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-surface"
              aria-label={t('pickColor')}
              disabled={disabled}
            />
          ) : null}
          <Input
            dir="ltr"
            value={draft}
            placeholder={kind === 'color' ? '#RRGGBB' : 'https://'}
            inputMode={kind === 'link' ? 'url' : 'text'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            disabled={disabled}
            aria-label={kind === 'color' ? t('pickColor') : t('addLink')}
            data-testid={`${testId}-input`}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={add}
            disabled={disabled}
            aria-label={kind === 'color' ? t('addColor') : t('addLink')}
            data-testid={`${testId}-add`}
          >
            <Plus />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DimensionsField({
  value,
  onChange,
  disabled,
  testId,
}: {
  value: Dimensions | null;
  onChange: (v: Dimensions | null) => void;
  disabled?: boolean;
  testId: string;
}) {
  const t = useTranslations('requests');
  return (
    <div className="grid gap-2" data-testid={testId}>
      <div className="flex flex-wrap gap-2">
        {aspectRatios.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={value?.ratio === r}
            disabled={disabled}
            onClick={() => onChange(value?.ratio === r ? null : { ratio: r, width: value?.width ?? null, height: value?.height ?? null })}
            className={cn(
              'tabular rounded-md border px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              value?.ratio === r
                ? 'border-primary bg-primary-soft font-medium text-primary-soft-foreground'
                : 'border-border text-muted-foreground hover:bg-surface-muted',
            )}
          >
            <span dir="ltr">{r === 'custom' ? t('customSize') : r}</span>
          </button>
        ))}
      </div>
      {value?.ratio === 'custom' ? (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            dir="ltr"
            min={16}
            max={20000}
            value={value.width ?? ''}
            onChange={(e) => onChange({ ...value, width: e.target.value === '' ? null : Number(e.target.value) })}
            aria-label={t('width')}
            placeholder={t('width')}
            disabled={disabled}
          />
          <span aria-hidden>{'×'}</span>
          <Input
            type="number"
            dir="ltr"
            min={16}
            max={20000}
            value={value.height ?? ''}
            onChange={(e) => onChange({ ...value, height: e.target.value === '' ? null : Number(e.target.value) })}
            aria-label={t('height')}
            placeholder={t('height')}
            disabled={disabled}
          />
          <span className="text-xs text-subtle-foreground">{t('px')}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders a brief form as controlled inputs, applying conditional visibility live. Error keys come from
 * `validateBrief` (the same validator the server runs), keyed by field id.
 */
export function BriefFields({
  fields,
  values,
  errors,
  onChange,
  clientId,
  known = {},
  onKnown = () => undefined,
  disabled,
  idPrefix = 'brief',
}: {
  fields: RequestFormField[];
  values: Record<string, unknown>;
  errors?: Record<string, string | undefined>;
  onChange: (id: string, value: unknown) => void;
  /** Needed for file fields (uploads go to the client's storage); omitted in the builder preview. */
  clientId?: string;
  known?: Record<string, KnownFile>;
  onKnown?: (files: KnownFile[]) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations('requests');
  return (
    <div className="grid gap-5">
      {fields.map((field) => {
        if (!isFieldVisible(field, values)) return null;
        const label = localized(field.label, locale) || t('builder.untitled');
        const help = field.help ? localized(field.help, locale) : '';
        const value = values[field.id];
        const error = errors?.[field.id];
        const testId = `brief-${field.id}`;
        const list = Array.isArray(value) ? (value as string[]) : [];
        switch (field.type) {
          case 'checkbox':
            return (
              <div key={field.id} className="grid gap-1.5">
                <label className="flex items-start gap-3 rounded-lg border border-border p-3">
                  <Checkbox
                    checked={Boolean(value)}
                    onCheckedChange={(v) => onChange(field.id, v === true)}
                    disabled={disabled}
                    aria-invalid={error ? true : undefined}
                    className="mt-0.5"
                    data-testid={testId}
                  />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">
                      {label}
                      {field.required ? <Required /> : null}
                    </span>
                    {help ? <span className="text-xs text-subtle-foreground">{help}</span> : null}
                  </span>
                </label>
                <ErrorText error={error} />
              </div>
            );
          case 'multi_select':
          case 'platforms':
            return (
              <Group key={field.id} field={field} label={label} help={help} error={error}>
                <Chips
                  testId={testId}
                  value={list}
                  disabled={disabled}
                  onChange={(v) => onChange(field.id, v)}
                  options={
                    field.type === 'platforms'
                      ? platforms.map((p) => ({ value: p, label: t(`platforms.${p}`) }))
                      : (field.options ?? []).map((o) => ({ value: o.value, label: localized(o.label, locale) }))
                  }
                />
              </Group>
            );
          case 'file':
            return (
              <Group key={field.id} field={field} label={label} help={help} error={error}>
                {clientId ? (
                  <FileField
                    field={field}
                    value={list}
                    onChange={(v) => onChange(field.id, v)}
                    clientId={clientId}
                    known={known}
                    onKnown={onKnown}
                    disabled={disabled}
                  />
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled className="justify-self-start">
                    <Paperclip />
                    {t('chooseFiles')}
                  </Button>
                )}
              </Group>
            );
          case 'links':
            return (
              <Group key={field.id} field={field} label={label} help={help} error={error}>
                <ListField
                  kind="link"
                  testId={testId}
                  value={list}
                  onChange={(v) => onChange(field.id, v)}
                  max={field.maxItems ?? DEFAULT_MAX_ITEMS.links}
                  disabled={disabled}
                />
              </Group>
            );
          case 'color':
            return (
              <Group key={field.id} field={field} label={label} help={help} error={error}>
                <ListField
                  kind="color"
                  testId={testId}
                  value={list}
                  onChange={(v) => onChange(field.id, v)}
                  max={field.maxItems ?? DEFAULT_MAX_ITEMS.color}
                  disabled={disabled}
                />
              </Group>
            );
          case 'dimensions':
            return (
              <Group key={field.id} field={field} label={label} help={help} error={error}>
                <DimensionsField
                  testId={testId}
                  value={(value as Dimensions | null) ?? null}
                  onChange={(v) => onChange(field.id, v)}
                  disabled={disabled}
                />
              </Group>
            );
          default:
            return (
              <Field
                key={field.id}
                id={`${idPrefix}-${field.id}`}
                label={label}
                hint={help || (field.type === 'long_text' ? t('formattingHint') : undefined)}
                error={error}
                required={field.required}
                optional={!field.required}
              >
                {(p) => {
                  switch (field.type) {
                    case 'long_text':
                      return (
                        <Textarea
                          {...p}
                          dir="auto"
                          rows={4}
                          value={String(value ?? '')}
                          maxLength={field.maxLength ?? 5000}
                          onChange={(e) => onChange(field.id, e.target.value)}
                          disabled={disabled}
                          data-testid={testId}
                        />
                      );
                    case 'number':
                      return (
                        <Input
                          {...p}
                          type="number"
                          dir="ltr"
                          inputMode="decimal"
                          min={field.min ?? undefined}
                          max={field.max ?? undefined}
                          value={value === null || value === undefined ? '' : String(value)}
                          onChange={(e) => onChange(field.id, e.target.value)}
                          disabled={disabled}
                          data-testid={testId}
                        />
                      );
                    case 'date':
                      return (
                        <Input
                          {...p}
                          type="date"
                          dir="ltr"
                          value={String(value ?? '')}
                          onChange={(e) => onChange(field.id, e.target.value)}
                          disabled={disabled}
                          data-testid={testId}
                        />
                      );
                    case 'single_select':
                      return (
                        <NativeSelect
                          {...p}
                          value={String(value ?? '')}
                          onChange={(e) => onChange(field.id, e.target.value)}
                          disabled={disabled}
                          data-testid={testId}
                        >
                          <option value="">{t('choose')}</option>
                          {(field.options ?? []).map((o) => (
                            <option key={o.value} value={o.value}>
                              {localized(o.label, locale)}
                            </option>
                          ))}
                        </NativeSelect>
                      );
                    default:
                      return (
                        <Input
                          {...p}
                          dir="auto"
                          value={String(value ?? '')}
                          maxLength={field.maxLength ?? 200}
                          onChange={(e) => onChange(field.id, e.target.value)}
                          disabled={disabled}
                          data-testid={testId}
                        />
                      );
                  }
                }}
              </Field>
            );
        }
      })}
    </div>
  );
}

/** Light formatting for long text: `**bold**` and lines starting with "- " become a list. Rendered as text nodes only. */
export function FormattedText({ text }: { text: string }) {
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const line of text.split('\n')) {
    const isItem = /^\s*[-•]\s+/.test(line);
    const last = blocks.at(-1);
    if (last && last.list === isItem) last.lines.push(isItem ? line.replace(/^\s*[-•]\s+/, '') : line);
    else blocks.push({ list: isItem, lines: [isItem ? line.replace(/^\s*[-•]\s+/, '') : line] });
  }
  const inline = (s: string) =>
    s
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        /^\*\*[^*]+\*\*$/.test(part) ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
      );
  return (
    <div dir="auto" className="grid gap-2 text-start break-words">
      {blocks.map((b, i) =>
        b.list ? (
          <ul key={i} className="list-disc ps-5">
            {b.lines.map((l, j) => (
              <li key={j}>{inline(l)}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {inline(b.lines.join('\n'))}
          </p>
        ),
      )}
    </div>
  );
}

/** Read view of a brief, rendered against the form snapshot it was written with. */
export function BriefView({
  fields,
  brief,
  files = [],
}: {
  fields: RequestFormField[];
  brief: Record<string, unknown>;
  files?: (FileItem & { fieldId: string | null })[];
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations('requests');
  const f = useFormat();
  const [preview, setPreview] = useState<FileItem | null>(null);
  const optionLabel = (field: RequestFormField, value: string) =>
    field.type === 'platforms'
      ? t(`platforms.${value as (typeof platforms)[number]}`)
      : localized(field.options?.find((o) => o.value === value)?.label, locale) || value;

  return (
    <>
      <dl className="divide-y divide-border" data-testid="request-brief">
        {fields
          .filter((field) => isFieldVisible(field, brief))
          .map((field) => {
            const value = brief[field.id];
            let content: ReactNode;
            if (field.type === 'checkbox') {
              content = value ? t('answerYes') : t('answerNo');
            } else if (isEmptyAnswer(value)) {
              content = <span className="text-subtle-foreground">{t('notAnswered')}</span>;
            } else {
              switch (field.type) {
                case 'number':
                  content = <span className="tabular">{f.number(Number(value))}</span>;
                  break;
                case 'date':
                  content = f.date(`${String(value)}T12:00:00`, 'long');
                  break;
                case 'single_select':
                  content = optionLabel(field, String(value));
                  break;
                case 'multi_select':
                case 'platforms':
                  content = (
                    <span className="flex flex-wrap gap-1.5">
                      {(value as string[]).map((v) => (
                        <Badge key={v} tone="brand">
                          {optionLabel(field, v)}
                        </Badge>
                      ))}
                    </span>
                  );
                  break;
                case 'links':
                  content = (
                    <ul className="grid gap-1">
                      {(value as string[]).map((u) => (
                        <li key={u}>
                          <a
                            href={u}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="inline-flex max-w-full items-center gap-1 text-link underline-offset-2 hover:underline"
                          >
                            <bdi dir="ltr" className="truncate">
                              {u}
                            </bdi>
                            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                          </a>
                        </li>
                      ))}
                    </ul>
                  );
                  break;
                case 'color':
                  content = (
                    <span className="flex flex-wrap gap-2">
                      {(value as string[]).map((c) => (
                        <span key={c} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5">
                          <span className="size-4 rounded-sm border border-border" style={{ backgroundColor: c }} aria-hidden />
                          <bdi dir="ltr" className="tabular text-xs">
                            {c}
                          </bdi>
                        </span>
                      ))}
                    </span>
                  );
                  break;
                case 'dimensions': {
                  const d = value as Dimensions;
                  content = (
                    <bdi dir="ltr" className="tabular">
                      {d.ratio === 'custom' ? `${d.width} × ${d.height} ${t('px')}` : d.ratio}
                    </bdi>
                  );
                  break;
                }
                case 'file': {
                  const ids = value as string[];
                  const own = files.filter((x) => ids.includes(x.id));
                  content = own.length ? (
                    <span className="flex flex-wrap gap-2">
                      {own.map((file) => (
                        <button
                          key={file.id}
                          type="button"
                          onClick={() => setPreview(file)}
                          className="flex max-w-60 items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-start hover:bg-surface-muted"
                          data-testid="brief-file-view"
                        >
                          <FileTypeIcon kind={file.kind} className="size-7" />
                          <bdi className="truncate text-xs font-medium">{file.name}</bdi>
                        </button>
                      ))}
                    </span>
                  ) : (
                    <span className="text-subtle-foreground">{t('notAnswered')}</span>
                  );
                  break;
                }
                case 'long_text':
                  content = <FormattedText text={String(value)} />;
                  break;
                default:
                  content = (
                    <p dir="auto" className="text-start break-words">
                      {String(value)}
                    </p>
                  );
              }
            }
            return (
              <div key={field.id} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[12rem_1fr] sm:gap-4">
                <dt className="text-sm text-muted-foreground">{localized(field.label, locale)}</dt>
                <dd className="min-w-0 text-sm">{content}</dd>
              </div>
            );
          })}
      </dl>
      <FilePreviewDialog file={preview} onOpenChange={(o) => !o && setPreview(null)} />
    </>
  );
}
