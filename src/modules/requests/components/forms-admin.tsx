'use client';

import { Archive, ArchiveRestore, FileSliders, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Card, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import { FormIcon, formIconComponent } from '@/modules/requests/components/badges';
import { formCategories, formIcons, requestPriorities, type FormStatus } from '@/modules/requests/constants';
import { formSettingsSchema, type FormSettingsInput } from '@/modules/requests/schemas';
import { createFormAction, setFormArchivedAction, updateFormSettingsAction } from '@/modules/requests/server/actions';
import type { FormSummary } from '@/modules/requests/server/queries';

const formStatusTone = { draft: 'neutral', published: 'success', archived: 'warning' } as const satisfies Record<FormStatus, string>;

export function FormStatusBadge({ status }: { status: FormStatus }) {
  const t = useTranslations('requests');
  return (
    <Badge tone={formStatusTone[status]} dot data-testid="form-status">
      {t(`formStatuses.${status}`)}
    </Badge>
  );
}

type Draft = {
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  icon: FormSettingsInput['icon'];
  category: FormSettingsInput['category'];
  defaultPriority: FormSettingsInput['defaultPriority'];
  responseSlaHours: string;
  resolutionSlaHours: string;
};

function toDraft(form: FormSummary | null): Draft {
  return {
    nameAr: form?.name.ar ?? '',
    nameEn: form?.name.en ?? '',
    descriptionAr: form?.description.ar ?? '',
    descriptionEn: form?.description.en ?? '',
    icon: form?.icon ?? 'clipboard-list',
    category: form?.category ?? 'other',
    defaultPriority: form?.defaultPriority ?? 'normal',
    responseSlaHours: form ? (form.responseSlaHours?.toString() ?? '') : '24',
    resolutionSlaHours: form ? (form.resolutionSlaHours?.toString() ?? '') : '72',
  };
}

/** Create / edit a form's settings (names, icon, category, default priority, SLA targets). */
export function FormSettingsDialog({
  form,
  open,
  onOpenChange,
}: {
  form: FormSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(form));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useAction(createFormAction, { successMessage: t('requests.forms.created') });
  const update = useAction(updateFormSettingsAction, { successMessage: t('common.saved') });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const hours = (v: string) => (v.trim() === '' ? null : Number(v));
    const parsed = formSettingsSchema.safeParse({
      name: { ar: draft.nameAr, en: draft.nameEn },
      description: { ar: draft.descriptionAr, en: draft.descriptionEn },
      icon: draft.icon,
      category: draft.category,
      defaultPriority: draft.defaultPriority,
      responseSlaHours: hours(draft.responseSlaHours),
      resolutionSlaHours: hours(draft.resolutionSlaHours),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[i.path.join('.')] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    if (form) {
      const res = await update.run({ formId: form.id, ...parsed.data });
      if (res.ok) onOpenChange(false);
    } else {
      const res = await create.run(parsed.data);
      if (res.ok) {
        onOpenChange(false);
        router.push(`/admin/request-forms/${res.data.formId}`);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(toDraft(form));
        onOpenChange(o);
      }}
    >
      <DialogContent closeLabel={t('common.close')} size="lg">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col" data-testid="form-settings">
          <DialogHeader>
            <DialogTitle>{form ? t('requests.forms.editSettings') : t('requests.forms.new')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('admin.nameAr')} error={errors['name.ar']}>
                {(p) => (
                  <Input
                    {...p}
                    dir="rtl"
                    lang="ar"
                    value={draft.nameAr}
                    onChange={(e) => set('nameAr', e.target.value)}
                    data-testid="form-name-ar"
                  />
                )}
              </Field>
              <Field label={t('admin.nameEn')} error={errors['name.en']}>
                {(p) => (
                  <Input
                    {...p}
                    dir="ltr"
                    lang="en"
                    value={draft.nameEn}
                    onChange={(e) => set('nameEn', e.target.value)}
                    data-testid="form-name-en"
                  />
                )}
              </Field>
              <Field label={t('admin.descriptionAr')} optional>
                {(p) => (
                  <Input {...p} dir="rtl" lang="ar" value={draft.descriptionAr} onChange={(e) => set('descriptionAr', e.target.value)} />
                )}
              </Field>
              <Field label={t('admin.descriptionEn')} optional>
                {(p) => (
                  <Input {...p} dir="ltr" lang="en" value={draft.descriptionEn} onChange={(e) => set('descriptionEn', e.target.value)} />
                )}
              </Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t('requests.forms.icon')}</legend>
              <div className="flex flex-wrap gap-2">
                {formIcons.map((icon) => {
                  const Icon = formIconComponent(icon);
                  return (
                    <button
                      key={icon}
                      type="button"
                      aria-pressed={draft.icon === icon}
                      aria-label={t(`requests.icons.${icon}`)}
                      onClick={() => set('icon', icon)}
                      className={cn(
                        'flex size-10 items-center justify-center rounded-lg border transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        draft.icon === icon
                          ? 'border-primary bg-primary-soft text-primary-soft-foreground'
                          : 'border-border hover:bg-surface-muted',
                      )}
                    >
                      <Icon className="size-5" aria-hidden />
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('requests.forms.category')}>
                {(p) => (
                  <NativeSelect {...p} value={draft.category} onChange={(e) => set('category', e.target.value as Draft['category'])}>
                    {formCategories.map((c) => (
                      <option key={c} value={c}>
                        {t(`requests.categories.${c}`)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('requests.forms.defaultPriority')}>
                {(p) => (
                  <NativeSelect
                    {...p}
                    value={draft.defaultPriority}
                    onChange={(e) => set('defaultPriority', e.target.value as Draft['defaultPriority'])}
                  >
                    {requestPriorities.map((c) => (
                      <option key={c} value={c}>
                        {t(`requests.priorities.${c}`)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('requests.forms.responseSla')} hint={t('requests.forms.slaHint')} error={errors.responseSlaHours} optional>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    dir="ltr"
                    min={1}
                    max={720}
                    value={draft.responseSlaHours}
                    onChange={(e) => set('responseSlaHours', e.target.value)}
                  />
                )}
              </Field>
              <Field
                label={t('requests.forms.resolutionSla')}
                hint={t('requests.forms.slaHint')}
                error={errors.resolutionSlaHours}
                optional
              >
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    dir="ltr"
                    min={1}
                    max={2160}
                    value={draft.resolutionSlaHours}
                    onChange={(e) => set('resolutionSlaHours', e.target.value)}
                  />
                )}
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={create.pending || update.pending} data-testid="form-settings-save">
              {form ? t('common.save') : t('requests.forms.createAndEdit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ArchiveFormButton({ form }: { form: Pick<FormSummary, 'id' | 'status'> }) {
  const t = useTranslations('requests.forms');
  const archive = useAction(setFormArchivedAction, { successMessage: form.status === 'archived' ? t('restored') : t('archivedToast') });
  const archived = form.status === 'archived';
  return (
    <Button
      variant="outline"
      size="sm"
      loading={archive.pending}
      onClick={() => void archive.run({ formId: form.id, archived: !archived })}
    >
      {archived ? <ArchiveRestore /> : <Archive />}
      {archived ? t('restore') : t('archive')}
    </Button>
  );
}

/** Request forms list for the agency: status, version, questions and usage per form. */
export function FormsAdmin({ forms }: { forms: FormSummary[] }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const [creating, setCreating] = useState(false);
  const newButton = (
    <Button onClick={() => setCreating(true)} data-testid="new-form">
      <Plus />
      {t('requests.forms.new')}
    </Button>
  );
  return (
    <>
      <div className="mb-4 flex justify-end">{newButton}</div>
      {forms.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileSliders}
            title={t('requests.forms.emptyTitle')}
            description={t('requests.forms.emptyBody')}
            action={newButton}
          />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="forms-list">
          {forms.map((form) => (
            <li key={form.id}>
              <Link href={`/admin/request-forms/${form.id}`} className="group block h-full" data-testid="form-card">
                <Card
                  className={cn(
                    'flex h-full flex-col gap-3 p-4 transition-shadow group-hover:shadow-md',
                    form.status === 'archived' && 'opacity-70',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <FormIcon icon={form.icon} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{localized(form.name, locale)}</p>
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {localized(form.description, locale) || t(`requests.categories.${form.category}`)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-1.5 text-xs">
                    <FormStatusBadge status={form.status} />
                    {form.currentVersion ? (
                      <Badge tone="outline">{t('requests.forms.versionN', { version: form.currentVersion })}</Badge>
                    ) : null}
                    {form.hasDraft && form.currentVersion ? <Badge tone="info">{t('requests.forms.unpublishedChanges')}</Badge> : null}
                    <span className="ms-auto text-subtle-foreground">
                      {t('requests.forms.summary', { fields: form.fieldCount, requests: form.requestCount })}
                    </span>
                  </div>
                  <p className="text-xs text-subtle-foreground">{t('requests.forms.updated', { when: f.relative(form.updatedAt) })}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <FormSettingsDialog form={null} open={creating} onOpenChange={setCreating} />
    </>
  );
}
