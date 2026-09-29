'use client';

import { CalendarClock, Pencil, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { useFormat } from '@/components/providers';
import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/overlays';
import { Badge, Card, Checkbox, NativeSelect, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type LocalizedText } from '@/lib/i18n/localized';
import { reportSectionKinds, type ReportCadence, type ReportSectionKind } from '@/modules/campaigns/constants';
import { defaultReportSections } from '@/modules/campaigns/periods';
import { deleteScheduleAction, saveScheduleAction } from '@/modules/campaigns/server/actions';
import type { CampaignOption, ScheduleItem } from '@/modules/campaigns/server/queries';

function ScheduleDialog({
  trigger,
  schedule,
  clients,
  campaigns,
}: {
  trigger: ReactNode;
  schedule?: ScheduleItem;
  clients: { id: string; name: LocalizedText }[];
  campaigns: CampaignOption[];
}) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const [open, setOpen] = useState(false);
  const initial = () => ({
    clientId: schedule?.clientId ?? '',
    campaignId: schedule?.campaign?.id ?? '',
    cadence: (schedule?.cadence ?? 'monthly') as ReportCadence,
    locale: schedule?.locale ?? locale,
    autoPublish: schedule?.autoPublish ?? false,
    isActive: schedule?.isActive ?? true,
    kinds: (schedule?.sections ?? defaultReportSections).map((s) => s.kind),
  });
  const [v, setV] = useState(initial);
  const save = useAction(saveScheduleAction, { successMessage: t('schedules.saved'), onSuccess: () => setOpen(false) });
  const configFor = (kind: ReportSectionKind) =>
    schedule?.sections.find((s) => s.kind === kind)?.config ?? defaultReportSections.find((s) => s.kind === kind)?.config ?? {};

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setV(initial());
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent closeLabel={tc('close')} data-testid="schedule-dialog">
        <DialogHeader>
          <DialogTitle>{schedule ? t('schedules.edit') : t('schedules.new')}</DialogTitle>
          <DialogDescription>{t('schedules.description')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label={t('create.client')} required>
            {(p) => (
              <NativeSelect
                {...p}
                value={v.clientId}
                disabled={Boolean(schedule)}
                onChange={(e) => setV({ ...v, clientId: e.target.value, campaignId: '' })}
              >
                <option value="" disabled>
                  {tc('select')}
                </option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {localized(c.name, locale)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('schedules.scope')}>
            {(p) => (
              <NativeSelect {...p} value={v.campaignId} disabled={!v.clientId} onChange={(e) => setV({ ...v, campaignId: e.target.value })}>
                <option value="">{t('create.scopeClient')}</option>
                {campaigns
                  .filter((c) => c.clientId === v.clientId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </NativeSelect>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('schedules.frequency')}>
              {(p) => (
                <NativeSelect {...p} value={v.cadence} onChange={(e) => setV({ ...v, cadence: e.target.value as ReportCadence })}>
                  <option value="monthly">{t('schedules.cadence.monthly')}</option>
                  <option value="weekly">{t('schedules.cadence.weekly')}</option>
                </NativeSelect>
              )}
            </Field>
            <Field label={t('create.locale')}>
              {(p) => (
                <NativeSelect {...p} value={v.locale} onChange={(e) => setV({ ...v, locale: e.target.value as 'ar' | 'en' })}>
                  <option value="ar">{t('create.localeAr')}</option>
                  <option value="en">{t('create.localeEn')}</option>
                </NativeSelect>
              )}
            </Field>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium">{t('schedules.sections')}</legend>
            {reportSectionKinds.map((k) => (
              <label key={k} className="inline-flex items-center gap-2 text-sm">
                <Checkbox
                  checked={v.kinds.includes(k)}
                  onCheckedChange={(on) =>
                    setV({
                      ...v,
                      kinds: on ? reportSectionKinds.filter((x) => x === k || v.kinds.includes(x)) : v.kinds.filter((x) => x !== k),
                    })
                  }
                />
                {t(`kind.${k}`)}
              </label>
            ))}
          </fieldset>
          <label className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">{t('schedules.autoPublish')}</span>
              <span className="block text-xs text-subtle-foreground">{t('schedules.autoPublishHint')}</span>
            </span>
            <Switch checked={v.autoPublish} onCheckedChange={(autoPublish) => setV({ ...v, autoPublish })} />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{t('schedules.active')}</span>
            <Switch checked={v.isActive} onCheckedChange={(isActive) => setV({ ...v, isActive })} />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc('cancel')}
          </Button>
          <Button
            loading={save.pending}
            disabled={!v.clientId || v.kinds.length === 0}
            onClick={() =>
              save.run({
                scheduleId: schedule?.id,
                clientId: v.clientId,
                campaignId: v.campaignId || null,
                cadence: v.cadence,
                locale: v.locale,
                autoPublish: v.autoPublish,
                isActive: v.isActive,
                sections: v.kinds.map((kind) => ({ kind, config: configFor(kind) })),
              })
            }
            data-testid="schedule-save"
          >
            {t('schedules.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SchedulesPanel({
  schedules,
  clients,
  campaigns,
  canManage,
}: {
  schedules: ScheduleItem[];
  clients: { id: string; name: LocalizedText }[];
  campaigns: CampaignOption[];
  canManage: boolean;
}) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const f = useFormat();
  const remove = useAction(deleteScheduleAction, { successMessage: t('schedules.deleted') });
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="schedules">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t('schedules.title')}</h2>
          <p className="text-xs text-subtle-foreground">{t('schedules.description')}</p>
        </div>
        {canManage ? (
          <ScheduleDialog
            clients={clients}
            campaigns={campaigns}
            trigger={
              <Button variant="outline" size="sm" data-testid="new-schedule">
                <Plus aria-hidden />
                {t('schedules.new')}
              </Button>
            }
          />
        ) : null}
      </div>
      {schedules.length === 0 ? (
        <EmptyState compact icon={CalendarClock} title={t('schedules.empty')} />
      ) : (
        <ul className="divide-y divide-border">
          {schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5" data-testid="schedule-row">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {[localized(s.clientName, locale), s.campaign?.name].filter(Boolean).join(' · ')}
                </span>
                <span className="block text-xs text-subtle-foreground">
                  {[
                    t(`schedules.cadenceShort.${s.cadence}`),
                    s.isActive ? t('schedules.nextRun', { date: f.date(`${s.nextRunOn}T12:00:00Z`) }) : t('schedules.paused'),
                    s.lastRunAt ? t('schedules.lastRun', { date: f.date(s.lastRunAt) }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="flex items-center gap-1">
                {s.autoPublish ? <Badge tone="info">{t('schedules.autoPublish')}</Badge> : null}
                {canManage ? (
                  <>
                    <ScheduleDialog
                      schedule={s}
                      clients={clients}
                      campaigns={campaigns}
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={t('schedules.edit')}>
                          <Pencil aria-hidden />
                        </Button>
                      }
                    />
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label={t('schedules.delete')}>
                          <Trash2 aria-hidden />
                        </Button>
                      }
                      title={t('schedules.deleteTitle')}
                      description={t('schedules.deleteBody')}
                      confirmLabel={tc('delete')}
                      cancelLabel={tc('cancel')}
                      destructive
                      onConfirm={() => remove.run({ scheduleId: s.id })}
                    />
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
