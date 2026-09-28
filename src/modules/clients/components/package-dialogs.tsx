'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ClipboardPlus, PackagePlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { packageItemTypes } from '@/modules/clients/constants';
import { assignClientPackageAction, recordPackageUsageAction } from '@/modules/clients/server/actions';

const monthBounds = () => {
  const now = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: iso(new Date(now.getFullYear(), now.getMonth(), 1)), end: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
};

const assignSchema = z
  .object({
    packageId: z.string().min(1, { message: 'required' }),
    periodStart: z.string().min(1, { message: 'invalid_date' }),
    periodEnd: z.string().min(1, { message: 'invalid_date' }),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { message: 'period_end_before_start', path: ['periodEnd'] });

export function AssignPackageDialog({
  clientId,
  packages,
}: {
  clientId: string;
  packages: { id: string; name: LocalizedText; isActive: boolean }[];
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(false);
  const bounds = monthBounds();
  const form = useForm<z.infer<typeof assignSchema>>({
    resolver: zodResolver(assignSchema),
    defaultValues: { packageId: '', periodStart: bounds.start, periodEnd: bounds.end },
  });
  const assign = useAction(assignClientPackageAction, { successMessage: t('clients.packageAssigned') });
  const submit = form.handleSubmit(async (v) => {
    const res = await assign.run({ clientId, ...v });
    if (res.ok) setOpen(false);
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PackagePlus />
        {t('clients.assignPackage')}
      </Button>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{t('clients.assignPackage')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label={t('clients.package')} error={form.formState.errors.packageId?.message} required>
              {(p) => (
                <NativeSelect {...p} {...form.register('packageId')}>
                  <option value="">{t('clients.choosePackage')}</option>
                  {packages
                    .filter((pkg) => pkg.isActive)
                    .map((pkg) => (
                      <option key={pkg.id} value={pkg.id}>
                        {localized(pkg.name, locale)}
                      </option>
                    ))}
                </NativeSelect>
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('clients.periodStart')} error={form.formState.errors.periodStart?.message}>
                {(p) => <Input {...p} type="date" dir="ltr" {...form.register('periodStart')} />}
              </Field>
              <Field label={t('clients.periodEnd')} error={form.formState.errors.periodEnd?.message}>
                {(p) => <Input {...p} type="date" dir="ltr" {...form.register('periodEnd')} />}
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {t('clients.assign')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const usageSchema = z.object({
  itemType: z.enum(packageItemTypes),
  quantity: z.coerce
    .number<string>()
    .int()
    .refine((n) => n !== 0 && Math.abs(n) <= 100, { message: 'positive_number' }),
  note: z.string().max(200),
});

export function RecordUsageDialog({
  clientId,
  clientPackageId,
  itemTypes,
}: {
  clientId: string;
  clientPackageId: string;
  itemTypes: string[];
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const form = useForm<z.input<typeof usageSchema>, unknown, z.output<typeof usageSchema>>({
    resolver: zodResolver(usageSchema),
    defaultValues: { itemType: (itemTypes[0] ?? 'post') as (typeof packageItemTypes)[number], quantity: '1', note: '' },
  });
  const record = useAction(recordPackageUsageAction, { successMessage: t('clients.usageRecorded') });
  const submit = form.handleSubmit(async (v) => {
    const res = await record.run({ clientId, clientPackageId, itemType: v.itemType, quantity: v.quantity, note: v.note || undefined });
    if (res.ok) {
      form.reset();
      setOpen(false);
    }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <ClipboardPlus />
        {t('clients.recordUsage')}
      </Button>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{t('clients.recordUsage')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <p className="text-sm text-muted-foreground">{t('clients.recordUsageHint')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('clients.itemType')}>
                {(p) => (
                  <NativeSelect {...p} {...form.register('itemType')}>
                    {itemTypes.map((type) => (
                      <option key={type} value={type}>
                        {t(`clients.itemTypes.${type as (typeof packageItemTypes)[number]}`)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('clients.quantity')} error={form.formState.errors.quantity?.message} hint={t('clients.quantityHint')}>
                {(p) => <Input {...p} type="number" dir="ltr" step={1} {...form.register('quantity')} />}
              </Field>
            </div>
            <Field label={t('clients.usageNote')} optional>
              {(p) => <Input {...p} {...form.register('note')} />}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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
