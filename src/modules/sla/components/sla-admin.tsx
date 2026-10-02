'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarOff, Clock, Pencil, Plus, ShieldCheck, Timer, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { EmptyState, SectionTitle } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Card, NativeSelect, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { requestPriorities } from '@/modules/requests/constants';
import { addBusinessHours, minuteToTime } from '@/modules/sla/calendar';
import {
  deleteHolidayAction,
  deletePolicyAction,
  saveBusinessHoursAction,
  saveHolidayAction,
  savePolicyAction,
} from '@/modules/sla/server/actions';
import type { SlaAdminData, SlaPolicyItem } from '@/modules/sla/server/queries';

const intText = (min: number, max: number, optional = false) =>
  z
    .string()
    .trim()
    .refine((v) => (optional && v === '') || (/^\d+$/.test(v) && Number(v) >= min && Number(v) <= max), {
      message: 'invalid_number',
    });

const policyForm = z
  .object({
    nameAr: z.string().trim().max(80, { message: 'too_long' }),
    nameEn: z.string().trim().max(80, { message: 'too_long' }),
    clientId: z.string(),
    requestTypeId: z.string(),
    priority: z.string(),
    responseHours: intText(1, 240),
    resolutionDays: intText(1, 90, true),
    pauseOnClient: z.boolean(),
    atRiskPercent: intText(50, 95),
    escalateTo: z.string(),
    isActive: z.boolean(),
  })
  .refine((v) => v.nameAr || v.nameEn, { message: 'required_one_language', path: ['nameAr'] });
type PolicyForm = z.infer<typeof policyForm>;

function PolicyDialog({
  policy,
  options,
  open,
  onOpenChange,
}: {
  policy: SlaPolicyItem | null;
  options: SlaAdminData['options'];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const form = useForm<PolicyForm>({
    resolver: zodResolver(policyForm),
    values: {
      nameAr: policy?.name.ar ?? '',
      nameEn: policy?.name.en ?? '',
      clientId: policy?.clientId ?? '',
      requestTypeId: policy?.requestTypeId ?? '',
      priority: policy?.priority ?? '',
      responseHours: String(policy?.responseHours ?? 8),
      resolutionDays: policy?.resolutionDays != null ? String(policy.resolutionDays) : '',
      pauseOnClient: policy?.pauseOnClient ?? true,
      atRiskPercent: String(policy?.atRiskPercent ?? 75),
      escalateTo: policy?.escalateTo ?? '',
      isActive: policy?.isActive ?? true,
    },
  });
  const save = useAction(savePolicyAction, { successMessage: t('common.saved') });
  const errors = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    const res = await save.run({
      policyId: policy?.id,
      name: { ar: v.nameAr, en: v.nameEn },
      clientId: v.clientId || null,
      requestTypeId: v.requestTypeId || null,
      priority: (v.priority || null) as SlaPolicyItem['priority'],
      responseHours: Number(v.responseHours),
      resolutionDays: v.resolutionDays === '' ? null : Number(v.resolutionDays),
      pauseOnClient: v.pauseOnClient,
      atRiskPercent: Number(v.atRiskPercent),
      escalateTo: v.escalateTo || null,
      isActive: v.isActive,
    });
    if (res.ok) onOpenChange(false);
  });
  const toggle = (name: 'pauseOnClient' | 'isActive', label: string, hint?: string) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <label className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">{label}</span>
            {hint ? <span className="text-xs text-subtle-foreground">{hint}</span> : null}
          </span>
          <Switch checked={field.value} onCheckedChange={field.onChange} data-testid={`policy-${name}`} />
        </label>
      )}
    />
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} size="lg">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col" data-testid="policy-form">
          <DialogHeader>
            <DialogTitle>{policy ? t('sla.admin.editPolicy') : t('sla.admin.newPolicy')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('admin.nameAr')} error={errors.nameAr?.message}>
                {(p) => <Input {...p} dir="rtl" lang="ar" {...form.register('nameAr')} data-testid="policy-name-ar" />}
              </Field>
              <Field label={t('admin.nameEn')} error={errors.nameEn?.message}>
                {(p) => <Input {...p} dir="ltr" lang="en" {...form.register('nameEn')} data-testid="policy-name-en" />}
              </Field>
            </div>
            <fieldset className="grid gap-4">
              <legend className="mb-1 text-sm font-medium">{t('sla.admin.appliesTo')}</legend>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('sla.admin.client')}>
                  {(p) => (
                    <NativeSelect {...p} {...form.register('clientId')} data-testid="policy-client">
                      <option value="">{t('sla.admin.anyClient')}</option>
                      {options.clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {localized(c.name, locale)}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field label={t('sla.admin.requestType')}>
                  {(p) => (
                    <NativeSelect {...p} {...form.register('requestTypeId')} data-testid="policy-type">
                      <option value="">{t('sla.admin.anyType')}</option>
                      {options.requestTypes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {localized(c.name, locale)}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field label={t('sla.admin.priority')}>
                  {(p) => (
                    <NativeSelect {...p} {...form.register('priority')} data-testid="policy-priority">
                      <option value="">{t('sla.admin.anyPriority')}</option>
                      {requestPriorities.map((x) => (
                        <option key={x} value={x}>
                          {t(`requests.priorities.${x}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('sla.admin.responseHours')} error={errors.responseHours?.message}>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    dir="ltr"
                    min={1}
                    max={240}
                    {...form.register('responseHours')}
                    data-testid="policy-response"
                  />
                )}
              </Field>
              <Field
                label={t('sla.admin.resolutionDays')}
                hint={t('sla.admin.resolutionHint')}
                error={errors.resolutionDays?.message}
                optional
              >
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    dir="ltr"
                    min={1}
                    max={90}
                    {...form.register('resolutionDays')}
                    data-testid="policy-resolution"
                  />
                )}
              </Field>
              <Field label={t('sla.admin.atRiskPercent')} error={errors.atRiskPercent?.message}>
                {(p) => <Input {...p} type="number" dir="ltr" min={50} max={95} step={5} {...form.register('atRiskPercent')} />}
              </Field>
            </div>
            <Field label={t('sla.admin.escalateTo')} hint={t('sla.admin.escalateHint')}>
              {(p) => (
                <NativeSelect {...p} {...form.register('escalateTo')} data-testid="policy-escalate">
                  <option value="">{t('sla.admin.nobody')}</option>
                  {options.people.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {toggle('pauseOnClient', t('sla.admin.pauseOnClient'), t('sla.admin.pauseHint'))}
              {toggle('isActive', t('sla.admin.active'))}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting} data-testid="policy-save">
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PolicyCard({ policy, onEdit }: { policy: SlaPolicyItem; onEdit: () => void }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const remove = useAction(deletePolicyAction, { successMessage: t('common.deleted') });
  const criteria = [
    policy.clientName ? localized(policy.clientName, locale) : null,
    policy.requestTypeName ? localized(policy.requestTypeName, locale) : null,
    policy.priority ? t(`requests.priorities.${policy.priority}`) : null,
  ].filter(Boolean) as string[];
  const name = localized(policy.name, locale);
  return (
    <Card className="flex flex-col gap-3 p-5" data-testid="policy-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            <bdi>{name}</bdi>
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {criteria.length === 0 ? <Badge tone="brand">{t('sla.admin.default')}</Badge> : null}
            {criteria.map((c) => (
              <Badge key={c} tone="neutral">
                <bdi>{c}</bdi>
              </Badge>
            ))}
            {!policy.isActive ? <Badge tone="warning">{t('sla.admin.inactive')}</Badge> : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={t('sla.admin.editPolicy')} data-testid="policy-edit">
            <Pencil />
          </Button>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon-sm" aria-label={t('sla.admin.deletePolicy')}>
                <Trash2 />
              </Button>
            }
            title={t('sla.admin.deletePolicy')}
            description={t('sla.admin.deleteConfirm', { name })}
            confirmLabel={t('common.delete')}
            cancelLabel={t('common.cancel')}
            destructive
            onConfirm={() => remove.run({ policyId: policy.id })}
          />
        </div>
      </div>
      <ul className="grid gap-1.5 text-sm text-muted-foreground">
        <li className="flex items-center gap-2">
          <Timer className="size-4 shrink-0" aria-hidden />
          {t('sla.admin.responseHoursShort', { count: policy.responseHours })}
        </li>
        <li className="flex items-center gap-2">
          <Clock className="size-4 shrink-0" aria-hidden />
          {policy.resolutionDays != null
            ? t('sla.admin.resolutionDaysShort', { count: policy.resolutionDays })
            : t('sla.admin.resolutionFromType')}
        </li>
        <li className="flex items-center gap-2">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          {[
            t('sla.admin.atRiskShort', { percent: policy.atRiskPercent }),
            policy.pauseOnClient ? t('sla.admin.pauses') : null,
            policy.escalateName ? t('sla.admin.escalatesTo', { name: policy.escalateName }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </li>
      </ul>
      <p className="mt-auto text-xs text-subtle-foreground">{t('sla.admin.usage', { count: policy.usage })}</p>
    </Card>
  );
}

const hoursForm = z
  .object({
    start: z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/, { message: 'invalid_time' }),
    end: z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/, { message: 'invalid_time' }),
  })
  .refine((v) => v.start < v.end, { message: 'time_order', path: ['end'] });

function BusinessHoursCard({ hours, holidays }: { hours: SlaAdminData['businessHours']; holidays: SlaAdminData['holidays'] }) {
  const t = useTranslations();
  const f = useFormat();
  const form = useForm<z.infer<typeof hoursForm>>({
    resolver: zodResolver(hoursForm),
    values: { start: minuteToTime(hours.start), end: minuteToTime(hours.end) },
  });
  const save = useAction(saveBusinessHoursAction, { successMessage: t('common.saved') });
  const submit = form.handleSubmit((v) => save.run(v));
  // A worked example with the saved calendar: Thursday afternoon, 4 business hours.
  const example = useMemo(() => {
    const cal = { timeZone: hours.timeZone, startMinute: hours.start, endMinute: hours.end, holidays: holidays.map((h) => h.date) };
    const now = new Date();
    const thursday = new Date(now);
    thursday.setUTCDate(now.getUTCDate() + ((4 - now.getUTCDay() + 7) % 7 || 7));
    thursday.setUTCHours(12, 0, 0, 0); // 15:00 in Riyadh
    return { from: thursday, due: addBusinessHours(thursday, 4, cal) };
  }, [hours, holidays]);
  return (
    <Card className="p-5">
      <form onSubmit={submit} noValidate className="grid gap-4" data-testid="business-hours-form">
        <p className="font-medium">{t('sla.admin.businessHours')}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sla.admin.opensAt')} error={form.formState.errors.start?.message}>
            {(p) => <Input {...p} type="time" dir="ltr" {...form.register('start')} data-testid="hours-start" />}
          </Field>
          <Field label={t('sla.admin.closesAt')} error={form.formState.errors.end?.message}>
            {(p) => <Input {...p} type="time" dir="ltr" {...form.register('end')} data-testid="hours-end" />}
          </Field>
        </div>
        <p className="text-xs text-subtle-foreground">{t('sla.admin.timeZone', { zone: hours.timeZone })}</p>
        {example.due ? (
          <p className="rounded-lg bg-surface-muted p-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t('sla.admin.preview')}: </span>
            {t('sla.admin.previewLine', { when: f.dateTime(example.from), hours: 4, due: f.dateTime(example.due) })}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" variant="outline" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
            {t('sla.admin.saveHours')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

const holidayForm = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' }),
    nameAr: z.string().trim().max(80, { message: 'too_long' }),
    nameEn: z.string().trim().max(80, { message: 'too_long' }),
  })
  .refine((v) => v.nameAr || v.nameEn, { message: 'required_one_language', path: ['nameAr'] });

function HolidaysCard({ holidays }: { holidays: SlaAdminData['holidays'] }) {
  const t = useTranslations();
  const f = useFormat();
  const locale = useLocale() as Locale;
  const form = useForm<z.infer<typeof holidayForm>>({
    resolver: zodResolver(holidayForm),
    defaultValues: { date: '', nameAr: '', nameEn: '' },
  });
  const save = useAction(saveHolidayAction, { successMessage: t('common.saved') });
  const remove = useAction(deleteHolidayAction);
  const submit = form.handleSubmit(async (v) => {
    const res = await save.run({ date: v.date, name: { ar: v.nameAr, en: v.nameEn } });
    if (res.ok) form.reset({ date: '', nameAr: '', nameEn: '' });
  });
  const errors = form.formState.errors;
  return (
    <Card className="grid gap-4 p-5">
      <p className="font-medium">{t('sla.admin.holidays')}</p>
      {holidays.length === 0 ? (
        <EmptyState compact icon={CalendarOff} title={t('sla.admin.noHolidays')} description={t('sla.admin.noHolidaysBody')} />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border" data-testid="holidays-list">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-3 py-2">
              <span className="tabular w-28 shrink-0 text-sm">{f.date(`${h.date}T12:00:00`)}</span>
              <span className="min-w-0 flex-1 truncate text-sm">
                <bdi>{localized(h.name, locale)}</bdi>
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('sla.admin.removeHoliday')}
                onClick={() => remove.run({ holidayId: h.id })}
                disabled={remove.pending}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={submit}
        noValidate
        className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        data-testid="holiday-form"
      >
        <Field label={t('sla.admin.holidayDate')} error={errors.date?.message}>
          {(p) => <Input {...p} type="date" dir="ltr" {...form.register('date')} data-testid="holiday-date" />}
        </Field>
        <Field label={t('admin.nameAr')} error={errors.nameAr?.message}>
          {(p) => <Input {...p} dir="rtl" lang="ar" {...form.register('nameAr')} data-testid="holiday-name-ar" />}
        </Field>
        <Field label={t('admin.nameEn')}>{(p) => <Input {...p} dir="ltr" lang="en" {...form.register('nameEn')} />}</Field>
        <Button type="submit" variant="outline" loading={form.formState.isSubmitting} data-testid="holiday-add">
          <Plus />
          {t('sla.admin.addHoliday')}
        </Button>
      </form>
    </Card>
  );
}

export function SlaAdmin({ data }: { data: SlaAdminData }) {
  const t = useTranslations();
  const [editing, setEditing] = useState<SlaPolicyItem | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-8">
      <section>
        <SectionTitle
          title={t('sla.admin.policies')}
          action={
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
              data-testid="policy-new"
            >
              <Plus />
              {t('sla.admin.newPolicy')}
            </Button>
          }
        />
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">{t('sla.admin.policiesHint')}</p>
        {data.policies.length === 0 ? (
          <Card>
            <EmptyState icon={Timer} title={t('sla.admin.empty')} description={t('sla.admin.emptyBody')} />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.policies.map((p) => (
              <PolicyCard
                key={p.id}
                policy={p}
                onEdit={() => {
                  setEditing(p);
                  setOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </section>
      <section>
        <SectionTitle title={t('sla.admin.calendar')} />
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">{t('sla.admin.calendarHint')}</p>
        <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <BusinessHoursCard hours={data.businessHours} holidays={data.holidays} />
          <HolidaysCard holidays={data.holidays} />
        </div>
      </section>
      <PolicyDialog policy={editing} options={data.options} open={open} onOpenChange={setOpen} />
    </div>
  );
}
