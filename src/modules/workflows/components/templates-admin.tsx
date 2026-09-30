'use client';

import { GitBranch, Plus, Workflow } from 'lucide-react';
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
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { RowActions } from '@/modules/data/components/row-actions';
import { TypeIcon } from '@/modules/requests/components/badges';
import type { TypeIcon as TypeIconKey } from '@/modules/requests/constants';
import { templateSettingsSchema } from '@/modules/workflows/schemas';
import { createTemplateAction, updateTemplateAction } from '@/modules/workflows/server/actions';
import type { TemplateSummary } from '@/modules/workflows/server/queries';

export type RequestTypeOption = { id: string; name: LocalizedText; icon: TypeIconKey };

type Draft = {
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  requestTypeId: string;
  isActive: boolean;
  isDefault: boolean;
};

function toDraft(t: TemplateSummary | null): Draft {
  return {
    nameAr: t?.name.ar ?? '',
    nameEn: t?.name.en ?? '',
    descriptionAr: t?.description.ar ?? '',
    descriptionEn: t?.description.en ?? '',
    requestTypeId: t?.requestTypeId ?? '',
    isActive: t?.isActive ?? true,
    isDefault: t?.isDefault ?? true,
  };
}

export function TemplateSettingsDialog({
  template,
  requestTypes,
  open,
  onOpenChange,
}: {
  template: TemplateSummary | null;
  requestTypes: RequestTypeOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(template));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useAction(createTemplateAction, { successMessage: t('workflows.created') });
  const update = useAction(updateTemplateAction, { successMessage: t('common.saved') });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = templateSettingsSchema.safeParse({
      name: { ar: draft.nameAr, en: draft.nameEn },
      description: { ar: draft.descriptionAr, en: draft.descriptionEn },
      requestTypeId: draft.requestTypeId || null,
      isActive: draft.isActive,
      isDefault: draft.isDefault,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[i.path.join('.')] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    if (template) {
      const res = await update.run({ templateId: template.id, ...parsed.data });
      if (res.ok) onOpenChange(false);
    } else {
      const res = await create.run(parsed.data);
      if (res.ok) {
        onOpenChange(false);
        router.push(`/admin/workflows/${res.data.templateId}`);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(toDraft(template));
        onOpenChange(o);
      }}
    >
      <DialogContent closeLabel={t('common.close')} size="lg">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col" data-testid="workflow-settings">
          <DialogHeader>
            <DialogTitle>{template ? t('workflows.editSettings') : t('workflows.new')}</DialogTitle>
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
                    data-testid="workflow-name-ar"
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
                    data-testid="workflow-name-en"
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
            <Field label={t('workflows.requestType')} hint={t('workflows.requestTypeHint')} optional>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={draft.requestTypeId}
                  onChange={(e) => set('requestTypeId', e.target.value)}
                  data-testid="workflow-request-type"
                >
                  <option value="">{t('workflows.anyType')}</option>
                  {requestTypes.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {localized(rt.name, locale)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <span>
                <span className="block text-sm font-medium">{t('workflows.isDefault')}</span>
                <span className="block text-xs text-muted-foreground">{t('workflows.isDefaultHint')}</span>
              </span>
              <Switch
                checked={draft.isDefault && Boolean(draft.requestTypeId)}
                disabled={!draft.requestTypeId}
                onCheckedChange={(v) => set('isDefault', v)}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <span>
                <span className="block text-sm font-medium">{t('workflows.isActive')}</span>
                <span className="block text-xs text-muted-foreground">{t('workflows.isActiveHint')}</span>
              </span>
              <Switch checked={draft.isActive} onCheckedChange={(v) => set('isActive', v)} />
            </label>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={create.pending || update.pending} data-testid="workflow-settings-save">
              {template ? t('common.save') : t('workflows.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TemplatesAdmin({
  templates,
  requestTypes,
  canDelete = false,
}: {
  templates: TemplateSummary[];
  requestTypes: RequestTypeOption[];
  canDelete?: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('workflows.listHint')}</p>
        <Button onClick={() => setOpen(true)} data-testid="new-workflow">
          <Plus />
          {t('workflows.new')}
        </Button>
      </div>
      {templates.length === 0 ? (
        <Card>
          <EmptyState icon={Workflow} title={t('workflows.emptyTitle')} description={t('workflows.emptyBody')} />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="workflows-list">
          {templates.map((tpl) => (
            <li key={tpl.id} className="relative min-w-0">
              <Link
                href={`/admin/workflows/${tpl.id}`}
                className="group block h-full rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                data-testid="workflow-card"
              >
                <Card className="flex h-full flex-col gap-3 p-4 transition-shadow group-hover:shadow-md">
                  <div className="flex items-start gap-3">
                    {tpl.requestTypeIcon ? <TypeIcon icon={tpl.requestTypeIcon} /> : <TypeIcon icon="clipboard-list" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{localized(tpl.name, locale)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {tpl.requestTypeName ? localized(tpl.requestTypeName, locale) : t('workflows.anyType')}
                      </p>
                    </div>
                  </div>
                  {localized(tpl.description, locale) ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{localized(tpl.description, locale)}</p>
                  ) : null}
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <Badge tone="outline">
                      <GitBranch />
                      {t('workflows.stepCount', { count: tpl.stepCount })}
                    </Badge>
                    <Badge tone="outline">{t('workflows.totalDays', { count: tpl.totalDays })}</Badge>
                    {tpl.isDefault ? <Badge tone="brand">{t('workflows.default')}</Badge> : null}
                    <Badge tone={tpl.isActive ? 'success' : 'neutral'} dot>
                      {tpl.isActive ? t('workflows.active') : t('workflows.inactive')}
                    </Badge>
                  </div>
                  <p className="text-xs text-subtle-foreground">{t('workflows.updated', { when: f.relative(tpl.updatedAt) })}</p>
                </Card>
              </Link>
              <div className="absolute end-2 top-2">
                <RowActions
                  label={localized(tpl.name, locale)}
                  onEdit={() => router.push(`/admin/workflows/${tpl.id}`)}
                  del={canDelete ? { type: 'workflow_template', id: tpl.id } : undefined}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <TemplateSettingsDialog template={null} requestTypes={requestTypes} open={open} onOpenChange={setOpen} />
    </div>
  );
}
