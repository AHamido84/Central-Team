'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';

import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Card, NativeSelect, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { packageItemTypes } from '@/modules/clients/constants';
import { savePackageAction } from '@/modules/clients/server/actions';
import type { PackageWithItems } from '@/modules/clients/server/queries';

const schema = z
  .object({
    nameAr: z.string().trim().max(80),
    nameEn: z.string().trim().max(80),
    descriptionAr: z.string().trim().max(200),
    descriptionEn: z.string().trim().max(200),
    price: z.string().trim().refine((v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= 0), { message: 'positive_number' }),
    isActive: z.boolean(),
    items: z
      .array(z.object({ itemType: z.enum(packageItemTypes), quantity: z.string().refine((v) => Number.isInteger(Number(v)) && Number(v) > 0, { message: 'positive_number' }) }))
      .min(1, { message: 'min_one' }),
  })
  .refine((v) => v.nameAr || v.nameEn, { message: 'required_one_language', path: ['nameAr'] });

function PackageDialog({ pkg, open, onOpenChange }: { pkg: PackageWithItems | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    values: {
      nameAr: pkg?.name.ar ?? '',
      nameEn: pkg?.name.en ?? '',
      descriptionAr: pkg?.description.ar ?? '',
      descriptionEn: pkg?.description.en ?? '',
      price: pkg?.priceMinor != null ? String(pkg.priceMinor / 100) : '',
      isActive: pkg?.isActive ?? true,
      items: pkg?.items.map((i) => ({ itemType: i.itemType as (typeof packageItemTypes)[number], quantity: String(i.quantity) })) ?? [
        { itemType: 'post', quantity: '8' },
      ],
    },
  });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const save = useAction(savePackageAction, { successMessage: t('common.saved') });
  const submit = form.handleSubmit(async (v) => {
    const res = await save.run({
      packageId: pkg?.id ?? null,
      name: { ar: v.nameAr, en: v.nameEn },
      description: { ar: v.descriptionAr, en: v.descriptionEn },
      priceSar: v.price === '' ? null : Number(v.price),
      isActive: v.isActive,
      items: v.items.map((i) => ({ itemType: i.itemType, quantity: Number(i.quantity) })),
    });
    if (res.ok) onOpenChange(false);
  });
  const used = form.watch('items').map((i) => i.itemType);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} size="lg">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{pkg ? t('clients.packages.edit') : t('clients.packages.new')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('admin.nameAr')} error={form.formState.errors.nameAr?.message}>
                {(p) => <Input {...p} dir="rtl" lang="ar" {...form.register('nameAr')} />}
              </Field>
              <Field label={t('admin.nameEn')}>{(p) => <Input {...p} dir="ltr" lang="en" {...form.register('nameEn')} />}</Field>
              <Field label={t('admin.descriptionAr')} optional>
                {(p) => <Input {...p} dir="rtl" lang="ar" {...form.register('descriptionAr')} />}
              </Field>
              <Field label={t('admin.descriptionEn')} optional>
                {(p) => <Input {...p} dir="ltr" lang="en" {...form.register('descriptionEn')} />}
              </Field>
              <Field label={t('clients.packages.price')} error={form.formState.errors.price?.message} hint={t('clients.packages.priceHint')} optional>
                {(p) => <Input {...p} type="number" dir="ltr" min={0} step="0.01" {...form.register('price')} />}
              </Field>
              <Controller
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <label className="flex items-center justify-between gap-3 self-end rounded-lg border border-border p-3">
                    <span className="text-sm font-medium">{t('clients.packages.active')}</span>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </label>
                )}
              />
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t('clients.packages.items')}</legend>
              <div className="grid gap-2">
                {items.fields.map((item, i) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <NativeSelect aria-label={t('clients.itemType')} {...form.register(`items.${i}.itemType`)} className="flex-1">
                      {packageItemTypes.map((type) => (
                        <option key={type} value={type} disabled={type !== form.watch(`items.${i}.itemType`) && used.includes(type)}>
                          {t(`clients.itemTypes.${type}`)}
                        </option>
                      ))}
                    </NativeSelect>
                    <Input type="number" dir="ltr" min={1} aria-label={t('clients.quantity')} className="w-24" {...form.register(`items.${i}.quantity`)} />
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => items.remove(i)} aria-label={t('common.remove')} disabled={items.fields.length === 1}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
              {items.fields.length < packageItemTypes.length ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => items.append({ itemType: packageItemTypes.find((x) => !used.includes(x))!, quantity: '1' })}
                >
                  <Plus />
                  {t('clients.packages.addItem')}
                </Button>
              ) : null}
            </fieldset>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PackagesAdmin({ packages }: { packages: PackageWithItems[] }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const [editing, setEditing] = useState<PackageWithItems | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus />
          {t('clients.packages.new')}
        </Button>
      </div>
      {packages.length === 0 ? (
        <Card>
          <EmptyState icon={Package} title={t('clients.packages.empty')} description={t('clients.packages.emptyBody')} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {packages.map((p) => (
            <Card key={p.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-h3 font-semibold">{localized(p.name, locale)}</p>
                  <p className="text-sm text-muted-foreground">{localized(p.description, locale)}</p>
                </div>
                {!p.isActive ? <Badge>{t('common.inactive')}</Badge> : null}
              </div>
              <p className="mt-4 text-h2 font-semibold tabular">
                {p.priceMinor != null ? f.currency(p.priceMinor, p.currency) : '—'}
                <span className="ms-1 text-sm font-normal text-muted-foreground">{t('clients.packages.perMonth')}</span>
              </p>
              <ul className="mt-4 space-y-1.5 text-sm">
                {p.items.map((i) => (
                  <li key={i.itemType} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{t(`clients.itemTypes.${i.itemType as (typeof packageItemTypes)[number]}`)}</span>
                    <span className="font-medium tabular">{f.number(i.quantity)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex items-center justify-between gap-2 pt-5">
                <span className="text-xs text-subtle-foreground">{t('clients.packages.activeClients', { count: p.clientCount })}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing(p);
                    setOpen(true);
                  }}
                >
                  <Pencil />
                  {t('common.edit')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <PackageDialog pkg={editing} open={open} onOpenChange={setOpen} />
    </>
  );
}
