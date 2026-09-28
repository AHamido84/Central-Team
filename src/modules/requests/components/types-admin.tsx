'use client';

import { FileSliders, Plus } from 'lucide-react';
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
import { Badge, Card, NativeSelect, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import { packageItemTypes } from '@/modules/clients/constants';
import { TypeIcon, typeIconMap } from '@/modules/requests/components/badges';
import { requestPriorities, typeCategories, typeIcons } from '@/modules/requests/constants';
import { typeSettingsSchema, type TypeSettingsInput } from '@/modules/requests/schemas';
import { createRequestTypeAction, updateRequestTypeAction } from '@/modules/requests/server/actions';
import type { RequestTypeItem } from '@/modules/requests/server/queries';

export function ActiveBadge({ active }: { active: boolean }) {
  const t = useTranslations('requests.types');
  return (
    <Badge tone={active ? 'success' : 'neutral'} dot data-testid="type-active" data-active={active}>
      {active ? t('active') : t('inactive')}
    </Badge>
  );
}

type Draft = {
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  icon: TypeSettingsInput['icon'];
  category: TypeSettingsInput['category'];
  defaultPriority: TypeSettingsInput['defaultPriority'];
  slaDays: string;
  packageItemType: string;
  isActive: boolean;
};

function toDraft(type: RequestTypeItem | null): Draft {
  return {
    nameAr: type?.name.ar ?? '',
    nameEn: type?.name.en ?? '',
    descriptionAr: type?.description.ar ?? '',
    descriptionEn: type?.description.en ?? '',
    icon: type?.icon ?? 'clipboard-list',
    category: type?.category ?? 'other',
    defaultPriority: type?.defaultPriority ?? 'normal',
    slaDays: type ? (type.slaDays?.toString() ?? '') : '5',
    packageItemType: type?.packageItemType ?? '',
    isActive: type?.isActive ?? false,
  };
}

/** Create / edit a request type's settings (names, icon, category, default priority, SLA, package item, active). */
export function TypeSettingsDialog({
  type,
  open,
  onOpenChange,
}: {
  type: RequestTypeItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(type));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useAction(createRequestTypeAction, { successMessage: t('requests.types.created') });
  const update = useAction(updateRequestTypeAction, { successMessage: t('common.saved') });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = typeSettingsSchema.safeParse({
      name: { ar: draft.nameAr, en: draft.nameEn },
      description: { ar: draft.descriptionAr, en: draft.descriptionEn },
      icon: draft.icon,
      category: draft.category,
      defaultPriority: draft.defaultPriority,
      slaDays: draft.slaDays.trim() === '' ? null : Number(draft.slaDays),
      packageItemType: draft.packageItemType || null,
      isActive: draft.isActive,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[i.path.join('.')] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    if (type) {
      const res = await update.run({ typeId: type.id, ...parsed.data });
      if (res.ok) onOpenChange(false);
    } else {
      const res = await create.run(parsed.data);
      if (res.ok) {
        onOpenChange(false);
        router.push(`/admin/request-types/${res.data.typeId}`);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(toDraft(type));
        onOpenChange(o);
      }}
    >
      <DialogContent closeLabel={t('common.close')} size="lg">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col" data-testid="type-settings">
          <DialogHeader>
            <DialogTitle>{type ? t('requests.types.editSettings') : t('requests.types.new')}</DialogTitle>
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
                    data-testid="type-name-ar"
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
                    data-testid="type-name-en"
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
              <legend className="mb-2 text-sm font-medium">{t('requests.types.icon')}</legend>
              <div className="flex flex-wrap gap-2">
                {typeIcons.map((icon) => {
                  const Icon = typeIconMap[icon];
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
              <Field label={t('requests.types.category')}>
                {(p) => (
                  <NativeSelect {...p} value={draft.category} onChange={(e) => set('category', e.target.value as Draft['category'])}>
                    {typeCategories.map((c) => (
                      <option key={c} value={c}>
                        {t(`requests.categories.${c}`)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('requests.types.defaultPriority')}>
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
              <Field label={t('requests.types.slaDays')} hint={t('requests.types.slaHint')} error={errors.slaDays} optional>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    dir="ltr"
                    min={1}
                    max={90}
                    value={draft.slaDays}
                    onChange={(e) => set('slaDays', e.target.value)}
                    data-testid="type-sla"
                  />
                )}
              </Field>
              <Field label={t('requests.types.packageItem')} hint={t('requests.types.packageItemHint')}>
                {(p) => (
                  <NativeSelect
                    {...p}
                    value={draft.packageItemType}
                    onChange={(e) => set('packageItemType', e.target.value)}
                    data-testid="type-package-item"
                  >
                    <option value="">{t('requests.types.notCounted')}</option>
                    {packageItemTypes.map((c) => (
                      <option key={c} value={c}>
                        {t(`clients.itemTypes.${c}`)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <span>
                <span className="block text-sm font-medium">{t('requests.types.activeLabel')}</span>
                <span className="block text-xs text-subtle-foreground">{t('requests.types.activeHint')}</span>
              </span>
              <Switch checked={draft.isActive} onCheckedChange={(v) => set('isActive', v)} data-testid="type-active-switch" />
            </label>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={create.pending || update.pending} data-testid="type-settings-save">
              {type ? t('common.save') : t('requests.types.createAndEdit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Request types list for the agency: active state, SLA, package item, questions and usage per type. */
export function TypesAdmin({ types }: { types: RequestTypeItem[] }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const [creating, setCreating] = useState(false);
  const newButton = (
    <Button onClick={() => setCreating(true)} data-testid="new-type">
      <Plus />
      {t('requests.types.new')}
    </Button>
  );
  return (
    <>
      <div className="mb-4 flex justify-end">{newButton}</div>
      {types.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileSliders}
            title={t('requests.types.emptyTitle')}
            description={t('requests.types.emptyBody')}
            action={newButton}
          />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="types-list">
          {types.map((type) => (
            <li key={type.id}>
              <Link
                href={`/admin/request-types/${type.id}`}
                className="group block h-full rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                data-testid="type-card"
              >
                <Card
                  className={cn('flex h-full flex-col gap-3 p-4 transition-shadow group-hover:shadow-md', !type.isActive && 'opacity-75')}
                >
                  <div className="flex items-start gap-3">
                    <TypeIcon icon={type.icon} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{localized(type.name, locale)}</p>
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {localized(type.description, locale) || t(`requests.categories.${type.category}`)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-1.5 text-xs">
                    <ActiveBadge active={type.isActive} />
                    {type.slaDays ? <Badge tone="outline">{t('requests.types.slaShort', { days: type.slaDays })}</Badge> : null}
                    {type.packageItemType ? <Badge tone="brand">{t(`clients.itemTypes.${type.packageItemType}`)}</Badge> : null}
                    <span className="ms-auto text-subtle-foreground">
                      {t('requests.types.summary', { fields: type.fields.length, requests: type.requestCount })}
                    </span>
                  </div>
                  <p className="text-xs text-subtle-foreground">
                    {t('requests.types.updated', { when: f.relative(type.updatedAt), version: type.schemaVersion })}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <TypeSettingsDialog type={null} open={creating} onOpenChange={setCreating} />
    </>
  );
}
