'use client';

import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckSquare,
  ChevronDown,
  CircleDot,
  Eye,
  GripVertical,
  Hash,
  Link2,
  ListChecks,
  Paintbrush,
  Paperclip,
  Plus,
  Ratio,
  Save,
  Settings2,
  Share2,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState, type DragEvent } from 'react';

import { EmptyState, SectionTitle } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Badge, Card, NativeSelect, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import { TypeIcon } from '@/modules/requests/components/badges';
import { BriefFields } from '@/modules/requests/components/brief-fields';
import { ActiveBadge, TypeSettingsDialog } from '@/modules/requests/components/types-admin';
import { platforms } from '@/modules/requests/constants';
import {
  conditionSourceTypes,
  defaultBrief,
  fieldTypes,
  formSchemaSchema,
  MAX_FIELDS,
  newFieldId,
  normalizeFields,
  optionFieldTypes,
  type FieldType,
  type RequestFormField,
} from '@/modules/requests/form-schema';
import { saveRequestTypeFormAction } from '@/modules/requests/server/actions';
import type { RequestTypeItem } from '@/modules/requests/server/queries';

export const fieldTypeIcon: Record<FieldType, typeof Type> = {
  short_text: Type,
  long_text: AlignLeft,
  number: Hash,
  single_select: CircleDot,
  multi_select: ListChecks,
  date: Calendar,
  file: Paperclip,
  links: Link2,
  platforms: Share2,
  dimensions: Ratio,
  color: Paintbrush,
  checkbox: CheckSquare,
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

function ConditionEditor({
  field,
  earlier,
  onChange,
}: {
  field: RequestFormField;
  earlier: RequestFormField[];
  onChange: (f: RequestFormField) => void;
}) {
  const t = useTranslations('requests.builder');
  const tr = useTranslations('requests');
  const locale = useLocale() as Locale;
  const sources = earlier.filter((f) => conditionSourceTypes.includes(f.type));
  const source = sources.find((s) => s.id === field.showIf?.field);
  const valueOptions = !source
    ? []
    : source.type === 'checkbox'
      ? [
          { value: 'true', label: tr('answerYes') },
          { value: 'false', label: tr('answerNo') },
        ]
      : source.type === 'platforms'
        ? platforms.map((p) => ({ value: p, label: tr(`platforms.${p}`) }))
        : (source.options ?? []).map((o) => ({ value: o.value, label: localized(o.label, locale) || o.value }));
  if (!sources.length) return <p className="text-xs text-subtle-foreground">{t('noConditionSources')}</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label={t('showIf')} optional>
        {(p) => (
          <NativeSelect
            {...p}
            value={field.showIf?.field ?? ''}
            onChange={(e) => {
              const next = sources.find((s) => s.id === e.target.value);
              if (!next) return onChange({ ...field, showIf: null });
              const first = next.type === 'checkbox' ? true : next.type === 'platforms' ? platforms[0] : (next.options?.[0]?.value ?? '');
              onChange({ ...field, showIf: { field: next.id, equals: first } });
            }}
            data-testid="builder-condition-field"
          >
            <option value="">{t('always')}</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {localized(s.label, locale) || t('untitled')}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      {source ? (
        <Field label={t('equals')}>
          {(p) => (
            <NativeSelect
              {...p}
              value={String(field.showIf?.equals ?? '')}
              onChange={(e) =>
                onChange({
                  ...field,
                  showIf: { field: source.id, equals: source.type === 'checkbox' ? e.target.value === 'true' : e.target.value },
                })
              }
              data-testid="builder-condition-value"
            >
              {valueOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      ) : null}
    </div>
  );
}

function FieldEditor({
  field,
  index,
  count,
  earlier,
  error,
  onChange,
  onMove,
  onRemove,
  drag,
}: {
  field: RequestFormField;
  index: number;
  count: number;
  earlier: RequestFormField[];
  error?: string;
  onChange: (field: RequestFormField) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  drag: {
    onDragStart: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
    onDragEnd: () => void;
    over: boolean;
  };
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(!field.label.ar && !field.label.en);
  const Icon = fieldTypeIcon[field.type];
  const set = (patch: Partial<RequestFormField>) => onChange({ ...field, ...patch });
  const options = field.options ?? [];
  const setOption = (i: number, patch: Partial<{ ar: string; en: string }>) =>
    set({ options: options.map((o, j) => (j === i ? { ...o, label: { ...o.label, ...patch } } : o)) });
  const title = localized(field.label, locale) || t('requests.builder.untitled');
  const source = field.showIf ? earlier.find((f) => f.id === field.showIf!.field) : null;

  return (
    <Card
      className={cn('overflow-hidden transition-shadow', error && 'border-danger/50', drag.over && 'ring-2 ring-primary')}
      onDragOver={drag.onDragOver}
      onDrop={drag.onDrop}
      data-testid="builder-field"
      data-field-id={field.id}
    >
      <div className="flex items-center gap-1.5 p-2 sm:gap-2 sm:p-3">
        <span
          draggable
          onDragStart={drag.onDragStart}
          onDragEnd={drag.onDragEnd}
          className="hidden cursor-grab touch-none text-subtle-foreground active:cursor-grabbing sm:block"
          aria-hidden
          data-testid="builder-drag-handle"
        >
          <GripVertical className="size-4" />
        </span>
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
          <span className="flex items-center gap-1.5 truncate text-xs text-subtle-foreground">
            {t(`requests.fieldTypes.${field.type}`)}
            {source ? (
              <Badge tone="info" className="max-w-40 truncate">
                <Eye />
                {localized(source.label, locale) || t('requests.builder.untitled')}
              </Badge>
            ) : null}
          </span>
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
          {field.type === 'file' || field.type === 'links' || field.type === 'color' ? (
            <Field label={t('requests.builder.maxItems')} optional>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  dir="ltr"
                  min={1}
                  max={20}
                  className="max-w-32"
                  value={field.maxItems ?? ''}
                  onChange={(e) => set({ maxItems: e.target.value === '' ? null : Number(e.target.value) })}
                />
              )}
            </Field>
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
          <ConditionEditor field={field} earlier={earlier} onChange={onChange} />
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <span className="text-sm font-medium">{t('requests.builder.required')}</span>
            <Switch checked={field.required} onCheckedChange={(v) => set({ required: v })} data-testid="builder-required" />
          </label>
        </div>
      ) : null}
    </Card>
  );
}

/** Form builder: ordered questions (AR/EN), conditions, drag & drop, live preview. Saving creates a new schema version. */
export function TypeBuilder({ type }: { type: RequestTypeItem }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [fields, setFields] = useState<RequestFormField[]>(type.fields);
  const [dirty, setDirty] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown>>(() => defaultBrief(type.fields));
  const save = useAction(saveRequestTypeFormAction, { successMessage: t('requests.builder.saved'), onSuccess: () => setDirty(false) });

  const validation = useMemo(() => formSchemaSchema.safeParse({ fields: normalizeFields(fields) }), [fields]);
  const fieldErrors = useMemo(() => {
    const out: Record<number, string> = {};
    if (!validation.success) {
      for (const issue of validation.error.issues) {
        const idx = issue.path[0] === 'fields' && typeof issue.path[1] === 'number' ? issue.path[1] : -1;
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
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= fields.length) return;
    const next = [...fields];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    update(next);
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-6">
        <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
          <TypeIcon icon={type.icon} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ActiveBadge active={type.isActive} />
              <Badge tone="outline">{t('requests.types.versionN', { version: type.schemaVersion })}</Badge>
              {dirty ? <Badge tone="info">{t('requests.builder.unsavedBadge')}</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(`requests.categories.${type.category}`)} · {t(`requests.priorities.${type.defaultPriority}`)} ·{' '}
              {type.slaDays ? t('requests.types.slaShort', { days: type.slaDays }) : t('requests.sla.noTarget')}
              {type.packageItemType ? ` · ${t(`clients.itemTypes.${type.packageItemType}`)}` : ''}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} data-testid="edit-type-settings">
            <Settings2 />
            {t('requests.types.editSettings')}
          </Button>
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
                  {fieldTypes.map((ft) => {
                    const Icon = fieldTypeIcon[ft];
                    return (
                      <DropdownMenuItem
                        key={ft}
                        onSelect={() =>
                          update([
                            ...fields,
                            blankField(
                              ft,
                              fields.map((x) => x.id),
                            ),
                          ])
                        }
                        data-testid={`add-field-${ft}`}
                      >
                        <Icon />
                        {t(`requests.fieldTypes.${ft}`)}
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
            <div className="grid gap-2" data-testid="builder-fields">
              {fields.map((field, i) => (
                <FieldEditor
                  key={field.id}
                  field={field}
                  index={i}
                  count={fields.length}
                  earlier={fields.slice(0, i)}
                  error={fieldErrors[i]}
                  onChange={(next) => update(fields.map((x, j) => (j === i ? next : x)))}
                  onMove={(d) => move(i, i + d)}
                  onRemove={() =>
                    update(fields.filter((_, j) => j !== i).map((x) => (x.showIf?.field === field.id ? { ...x, showIf: null } : x)))
                  }
                  drag={{
                    over: dragOver === i && dragFrom !== i,
                    onDragStart: (e) => {
                      setDragFrom(i);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', field.id);
                    },
                    onDragOver: (e) => {
                      if (dragFrom === null) return;
                      e.preventDefault();
                      setDragOver(i);
                    },
                    onDrop: (e) => {
                      e.preventDefault();
                      if (dragFrom !== null) move(dragFrom, i);
                      setDragFrom(null);
                      setDragOver(null);
                    },
                    onDragEnd: () => {
                      setDragFrom(null);
                      setDragOver(null);
                    },
                  }}
                />
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-subtle-foreground">{t('requests.builder.titleNote')}</p>
        </section>

        <div className="sticky bottom-0 z-10 -mx-(--gutter) flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-(--gutter) py-3 backdrop-blur">
          <p className="me-auto text-sm text-muted-foreground">{dirty ? t('requests.builder.unsaved') : t('requests.builder.upToDate')}</p>
          {dirty ? (
            <Button
              variant="ghost"
              onClick={() => {
                setFields(type.fields);
                setDirty(false);
              }}
            >
              {t('requests.builder.discard')}
            </Button>
          ) : null}
          <Button
            onClick={() => void save.run({ typeId: type.id, formSchema: { fields: normalizeFields(fields) } })}
            disabled={!validation.success || !dirty}
            loading={save.pending}
            data-testid="save-form"
          >
            <Save />
            {t('requests.builder.save')}
          </Button>
        </div>
      </div>

      <aside className="space-y-6">
        <section className="xl:sticky xl:top-20">
          <SectionTitle title={t('requests.builder.preview')} />
          <Card className="grid gap-5 p-5" data-testid="builder-preview">
            <div className="flex items-center gap-3">
              <TypeIcon icon={type.icon} size="sm" />
              <p className="font-semibold">{localized(type.name, locale)}</p>
            </div>
            {fields.length ? (
              <BriefFields
                idPrefix="preview"
                fields={fields}
                values={preview}
                onChange={(id, value) => setPreview((v) => ({ ...v, [id]: value }))}
              />
            ) : (
              <p className="text-sm text-subtle-foreground">{t('requests.builder.noFields')}</p>
            )}
            <p className="text-xs text-subtle-foreground">{t('requests.builder.previewNote')}</p>
          </Card>
        </section>
      </aside>
      <TypeSettingsDialog type={type} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
