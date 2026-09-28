'use client';

import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckSquare,
  ChevronDown,
  CircleDot,
  Hash,
  Link2,
  ListChecks,
  Plus,
  Save,
  Settings2,
  Trash2,
  Type,
  UploadCloud,
  X,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { EmptyState, SectionTitle } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Badge, Card, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import { FormIcon } from '@/modules/requests/components/badges';
import { DynamicFields } from '@/modules/requests/components/dynamic-form';
import { ArchiveFormButton, FormSettingsDialog, FormStatusBadge } from '@/modules/requests/components/forms-admin';
import {
  defaultAnswers,
  fieldTypes,
  MAX_FIELDS,
  newFieldId,
  normalizeFields,
  optionFieldTypes,
  requestFormFieldsSchema,
  type FieldType,
  type RequestFormField,
} from '@/modules/requests/form-schema';
import { discardFormDraftAction, publishFormAction, saveFormDraftAction } from '@/modules/requests/server/actions';
import type { FormForBuilder } from '@/modules/requests/server/queries';

const typeIcon: Record<FieldType, typeof Type> = {
  short_text: Type,
  long_text: AlignLeft,
  number: Hash,
  date: Calendar,
  single_select: CircleDot,
  multi_select: ListChecks,
  checkbox: CheckSquare,
  url: Link2,
};

function blankField(type: FieldType, existing: string[]): RequestFormField {
  const base: RequestFormField = { id: newFieldId(existing), type, label: { ar: '', en: '' }, help: { ar: '', en: '' }, required: false };
  if (optionFieldTypes.includes(type)) {
    base.options = [
      { value: 'option_1', label: { ar: 'الخيار 1', en: 'Option 1' } },
      { value: 'option_2', label: { ar: 'الخيار 2', en: 'Option 2' } },
    ];
  }
  return base;
}

function FieldEditor({
  field,
  index,
  count,
  error,
  onChange,
  onMove,
  onRemove,
}: {
  field: RequestFormField;
  index: number;
  count: number;
  error?: string;
  onChange: (field: RequestFormField) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(!field.label.ar && !field.label.en);
  const Icon = typeIcon[field.type];
  const set = (patch: Partial<RequestFormField>) => onChange({ ...field, ...patch });
  const options = field.options ?? [];
  const setOption = (i: number, patch: Partial<{ ar: string; en: string }>) =>
    set({ options: options.map((o, j) => (j === i ? { ...o, label: { ...o.label, ...patch } as { ar: string; en: string } } : o)) });
  const title = localized(field.label, locale) || t('requests.builder.untitled');

  return (
    <Card className={cn('overflow-hidden', error && 'border-danger/50')} data-testid="builder-field">
      <div className="flex items-center gap-2 p-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
        <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="block truncate text-sm font-medium">
            {title}
            {field.required ? (
              <span className="ms-0.5 text-danger" aria-hidden>
                *
              </span>
            ) : null}
          </span>
          <span className="block text-xs text-subtle-foreground">{t(`requests.fieldTypes.${field.type}`)}</span>
        </button>
        <Button variant="ghost" size="icon-sm" onClick={() => onMove(-1)} disabled={index === 0} aria-label={t('requests.builder.moveUp')}>
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onMove(1)}
          disabled={index === count - 1}
          aria-label={t('requests.builder.moveDown')}
        >
          <ArrowDown />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={t('requests.builder.removeField')}>
          <Trash2 />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen((o) => !o)} aria-label={t('requests.builder.editField')}>
          <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
      </div>
      {error ? <p className="px-3 pb-2 text-xs font-medium text-danger">{error}</p> : null}
      {open ? (
        <div className="grid gap-4 border-t border-border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('requests.builder.labelAr')}>
              {(p) => (
                <Input
                  {...p}
                  dir="rtl"
                  lang="ar"
                  value={field.label.ar ?? ''}
                  onChange={(e) => set({ label: { ...field.label, ar: e.target.value } })}
                  data-testid="builder-label-ar"
                />
              )}
            </Field>
            <Field label={t('requests.builder.labelEn')}>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  lang="en"
                  value={field.label.en ?? ''}
                  onChange={(e) => set({ label: { ...field.label, en: e.target.value } })}
                  data-testid="builder-label-en"
                />
              )}
            </Field>
            <Field label={t('requests.builder.helpAr')} optional>
              {(p) => (
                <Input
                  {...p}
                  dir="rtl"
                  lang="ar"
                  value={field.help?.ar ?? ''}
                  onChange={(e) => set({ help: { en: field.help?.en ?? '', ar: e.target.value } })}
                />
              )}
            </Field>
            <Field label={t('requests.builder.helpEn')} optional>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  lang="en"
                  value={field.help?.en ?? ''}
                  onChange={(e) => set({ help: { ar: field.help?.ar ?? '', en: e.target.value } })}
                />
              )}
            </Field>
          </div>
          {field.type === 'number' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('requests.builder.min')} optional>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    dir="ltr"
                    value={field.min ?? ''}
                    onChange={(e) => set({ min: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                )}
              </Field>
              <Field label={t('requests.builder.max')} optional>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    dir="ltr"
                    value={field.max ?? ''}
                    onChange={(e) => set({ max: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                )}
              </Field>
            </div>
          ) : null}
          {optionFieldTypes.includes(field.type) ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t('requests.builder.options')}</legend>
              {options.map((o, i) => (
                <div key={o.value} className="flex items-center gap-2">
                  <Input
                    dir="rtl"
                    lang="ar"
                    aria-label={`${t('requests.builder.optionAr')} ${i + 1}`}
                    placeholder={t('requests.builder.optionAr')}
                    value={o.label.ar ?? ''}
                    onChange={(e) => setOption(i, { ar: e.target.value })}
                  />
                  <Input
                    dir="ltr"
                    lang="en"
                    aria-label={`${t('requests.builder.optionEn')} ${i + 1}`}
                    placeholder={t('requests.builder.optionEn')}
                    value={o.label.en ?? ''}
                    onChange={(e) => setOption(i, { en: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => set({ options: options.filter((_, j) => j !== i) })}
                    disabled={options.length <= 2}
                    aria-label={t('requests.builder.removeOption')}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="justify-self-start"
                onClick={() => {
                  let n = options.length + 1;
                  while (options.some((o) => o.value === `option_${n}`)) n++;
                  set({ options: [...options, { value: `option_${n}`, label: { ar: '', en: '' } }] });
                }}
                disabled={options.length >= 30}
              >
                <Plus />
                {t('requests.builder.addOption')}
              </Button>
            </fieldset>
          ) : null}
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <span className="text-sm font-medium">{t('requests.builder.required')}</span>
            <Switch checked={field.required} onCheckedChange={(v) => set({ required: v })} data-testid="builder-required" />
          </label>
        </div>
      ) : null}
    </Card>
  );
}

/** Form builder: settings, ordered questions (AR/EN), live preview, save draft, publish as a new version. */
export function FormBuilder({ data }: { data: FormForBuilder }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const [fields, setFields] = useState<RequestFormField[]>(data.fields);
  const [dirty, setDirty] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>(() => defaultAnswers(data.fields));
  const save = useAction(saveFormDraftAction, { successMessage: t('requests.builder.draftSaved'), onSuccess: () => setDirty(false) });
  const publish = useAction(publishFormAction, { successMessage: t('requests.builder.published'), onSuccess: () => setDirty(false) });
  const discard = useAction(discardFormDraftAction, { successMessage: t('requests.builder.discarded') });

  const validation = useMemo(() => requestFormFieldsSchema.safeParse(normalizeFields(fields)), [fields]);
  const fieldErrors = useMemo(() => {
    const out: Record<number, string> = {};
    if (!validation.success) {
      for (const issue of validation.error.issues) {
        const idx = typeof issue.path[0] === 'number' ? issue.path[0] : -1;
        if (idx >= 0 && out[idx] === undefined) {
          const key = `validation.${issue.message}` as Parameters<typeof t>[0];
          out[idx] = t.has(key) ? t(key) : issue.message;
        }
      }
    }
    return out;
  }, [validation, t]);

  const update = (next: RequestFormField[]) => {
    setFields(next);
    setDirty(true);
  };
  const add = (type: FieldType) =>
    update([
      ...fields,
      blankField(
        type,
        fields.map((x) => x.id),
      ),
    ]);
  const move = (i: number, delta: -1 | 1) => {
    const next = [...fields];
    const [item] = next.splice(i, 1);
    next.splice(i + delta, 0, item!);
    update(next);
  };

  const canSave = validation.success;
  const hasDraft = Boolean(data.draftVersionId) || dirty;
  const nextVersion = (data.versions[0]?.version ?? 0) + (data.draftVersionId ? 0 : 1);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-6">
        <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
          <FormIcon icon={data.form.icon} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <FormStatusBadge status={data.form.status} />
              {data.form.currentVersion ? (
                <Badge tone="outline">{t('requests.forms.versionN', { version: data.form.currentVersion })}</Badge>
              ) : null}
              {hasDraft ? <Badge tone="info">{t('requests.builder.draftOf', { version: nextVersion })}</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(`requests.categories.${data.form.category}`)} · {t(`requests.priorities.${data.form.defaultPriority}`)} ·{' '}
              {data.form.responseSlaHours
                ? t('requests.forms.slaShort', { hours: data.form.responseSlaHours })
                : t('requests.sla.noTargets')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} data-testid="edit-form-settings">
              <Settings2 />
              {t('requests.forms.editSettings')}
            </Button>
            <ArchiveFormButton form={data.form} />
          </div>
        </Card>

        <section>
          <SectionTitle
            title={t('requests.builder.questions', { count: fields.length })}
            action={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="soft" disabled={fields.length >= MAX_FIELDS} data-testid="add-field">
                    <Plus />
                    {t('requests.builder.addField')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {fieldTypes.map((type) => {
                    const Icon = typeIcon[type];
                    return (
                      <DropdownMenuItem key={type} onSelect={() => add(type)} data-testid={`add-field-${type}`}>
                        <Icon />
                        {t(`requests.fieldTypes.${type}`)}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
          {fields.length === 0 ? (
            <Card>
              <EmptyState
                compact
                icon={ListChecks}
                title={t('requests.builder.noFields')}
                description={t('requests.builder.noFieldsBody')}
              />
            </Card>
          ) : (
            <div className="grid gap-2">
              {fields.map((field, i) => (
                <FieldEditor
                  key={field.id}
                  field={field}
                  index={i}
                  count={fields.length}
                  error={fieldErrors[i]}
                  onChange={(next) => update(fields.map((x, j) => (j === i ? next : x)))}
                  onMove={(d) => move(i, d)}
                  onRemove={() => update(fields.filter((_, j) => j !== i))}
                />
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-subtle-foreground">{t('requests.builder.titleNote')}</p>
        </section>

        <div className="sticky bottom-0 z-10 -mx-(--gutter) flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-(--gutter) py-3 backdrop-blur">
          <p className="me-auto text-sm text-muted-foreground">
            {dirty
              ? t('requests.builder.unsaved')
              : data.draftVersionId
                ? t('requests.builder.draftPending')
                : t('requests.builder.upToDate')}
          </p>
          {data.draftVersionId && data.form.currentVersion && !dirty ? (
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm">
                  {t('requests.builder.discard')}
                </Button>
              }
              title={t('requests.builder.discardTitle')}
              description={t('requests.builder.discardBody')}
              confirmLabel={t('requests.builder.discard')}
              cancelLabel={t('common.cancel')}
              destructive
              onConfirm={() => discard.run({ formId: data.form.id })}
            />
          ) : null}
          <Button
            variant="outline"
            onClick={() => void save.run({ formId: data.form.id, fields: normalizeFields(fields) })}
            disabled={!canSave || !dirty}
            loading={save.pending}
            data-testid="save-draft"
          >
            <Save />
            {t('requests.builder.saveDraft')}
          </Button>
          <ConfirmDialog
            trigger={
              <Button disabled={!canSave || fields.length === 0 || (!hasDraft && data.form.status !== 'draft')} data-testid="publish-form">
                <UploadCloud />
                {t('requests.builder.publish', { version: nextVersion })}
              </Button>
            }
            title={t('requests.builder.publishTitle', { version: nextVersion })}
            description={t('requests.builder.publishBody')}
            confirmLabel={t('requests.builder.publishConfirm')}
            cancelLabel={t('common.cancel')}
            onConfirm={() => publish.run({ formId: data.form.id, fields: normalizeFields(fields) })}
          />
        </div>
      </div>

      <aside className="space-y-6">
        <section>
          <SectionTitle title={t('requests.builder.preview')} />
          <Card className="grid gap-5 p-5" data-testid="builder-preview">
            <div className="flex items-center gap-3">
              <FormIcon icon={data.form.icon} size="sm" />
              <p className="font-semibold">{localized(data.form.name, locale)}</p>
            </div>
            <Field label={t('requests.fields.title')} required>
              {(p) => <Input {...p} disabled placeholder={t('requests.fields.titleHint')} />}
            </Field>
            {fields.length ? (
              <DynamicFields
                idPrefix="preview"
                fields={fields}
                values={previewValues}
                onChange={(id, value) => setPreviewValues((v) => ({ ...v, [id]: value }))}
              />
            ) : (
              <p className="text-sm text-subtle-foreground">{t('requests.builder.noFields')}</p>
            )}
          </Card>
        </section>
        <section>
          <SectionTitle title={t('requests.builder.versions')} />
          <Card className="divide-y divide-border" data-testid="form-versions">
            {data.versions.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="font-medium">{t('requests.forms.versionN', { version: v.version })}</span>
                <span className="text-end text-xs text-subtle-foreground">
                  {v.publishedAt
                    ? t('requests.builder.publishedBy', { when: f.date(v.publishedAt), name: v.publishedByName ?? '—' })
                    : t('requests.builder.draft')}
                </span>
              </div>
            ))}
          </Card>
        </section>
      </aside>
      <FormSettingsDialog form={data.form} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
