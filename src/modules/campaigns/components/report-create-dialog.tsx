'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/overlays';
import { NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type LocalizedText } from '@/lib/i18n/localized';
import { addDays } from '@/modules/campaigns/metrics';
import { lastFullMonth } from '@/modules/campaigns/periods';
import { createReportAction } from '@/modules/campaigns/server/actions';
import type { CampaignOption } from '@/modules/campaigns/server/queries';

type Preset = 'lastMonth' | 'thisMonth' | 'flight' | 'custom';

export function ReportCreateDialog({
  trigger,
  clients,
  campaigns,
  defaultClientId,
  defaultCampaignId,
  today,
}: {
  trigger: ReactNode;
  clients: { id: string; name: LocalizedText }[];
  campaigns: CampaignOption[];
  defaultClientId?: string;
  defaultCampaignId?: string;
  today: string;
}) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const f = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(defaultClientId ?? '');
  const [campaignId, setCampaignId] = useState(defaultCampaignId ?? '');
  const [preset, setPreset] = useState<Preset>(defaultCampaignId ? 'flight' : 'lastMonth');
  const [custom, setCustom] = useState({ start: addDays(today, -30), end: addDays(today, -1) });
  const [reportLocale, setReportLocale] = useState<'ar' | 'en'>(locale);
  const [title, setTitle] = useState<string | null>(null);
  const create = useAction(createReportAction, {
    successMessage: t('create.created'),
    onSuccess: (data) => {
      setOpen(false);
      router.push(`/reports/${data.reportId}`);
    },
  });

  const campaign = campaigns.find((c) => c.id === campaignId) ?? null;
  const yesterday = addDays(today, -1);
  const period = (() => {
    if (preset === 'lastMonth') return lastFullMonth(today);
    if (preset === 'thisMonth')
      return { start: `${today.slice(0, 7)}-01`, end: yesterday < `${today.slice(0, 7)}-01` ? `${today.slice(0, 7)}-01` : yesterday };
    if (preset === 'flight' && campaign)
      return {
        start: campaign.startDate,
        end: campaign.endDate < yesterday ? campaign.endDate : yesterday < campaign.startDate ? campaign.startDate : yesterday,
      };
    return custom;
  })();
  const noon = (d: string) => `${d}T12:00:00Z`;
  const periodLabel =
    preset === 'lastMonth' ? f.monthYear(noon(period.start)) : `${f.dayMonth(noon(period.start))} – ${f.date(noon(period.end))}`;
  const client = clients.find((c) => c.id === clientId);
  const autoTitle = client
    ? t('create.defaultTitle', { client: campaign ? campaign.name : localized(client.name, reportLocale), period: periodLabel })
    : '';
  const clientCampaigns = campaigns.filter((c) => c.clientId === clientId);

  const submit = () =>
    create.run({
      clientId,
      campaignId: campaignId || null,
      title: (title ?? autoTitle).trim(),
      periodStart: period.start,
      periodEnd: period.end,
      locale: reportLocale,
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setTitle(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="md" closeLabel={tc('close')} data-testid="report-create">
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field label={t('create.client')} required>
            {(p) => (
              <NativeSelect
                {...p}
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  setCampaignId('');
                  if (preset === 'flight') setPreset('lastMonth');
                }}
                data-testid="report-client"
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
          <Field label={t('create.scope')}>
            {(p) => (
              <NativeSelect
                {...p}
                value={campaignId}
                onChange={(e) => {
                  setCampaignId(e.target.value);
                  if (!e.target.value && preset === 'flight') setPreset('lastMonth');
                }}
                disabled={!clientId}
                data-testid="report-scope"
              >
                <option value="">{t('create.scopeClient')}</option>
                {clientCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('create.period')}>
            {(p) => (
              <NativeSelect {...p} value={preset} onChange={(e) => setPreset(e.target.value as Preset)} data-testid="report-preset">
                <option value="lastMonth">{t('create.presets.lastMonth')}</option>
                <option value="thisMonth">{t('create.presets.thisMonth')}</option>
                {campaign ? <option value="flight">{t('create.presets.flight')}</option> : null}
                <option value="custom">{t('create.presets.custom')}</option>
              </NativeSelect>
            )}
          </Field>
          {preset === 'custom' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('create.from')}>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={custom.start}
                    max={custom.end}
                    onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
                  />
                )}
              </Field>
              <Field label={t('create.to')}>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={custom.end}
                    min={custom.start}
                    onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
                  />
                )}
              </Field>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="report-period">
              {`${f.date(noon(period.start))} – ${f.date(noon(period.end))}`}
            </p>
          )}
          <Field label={t('create.locale')}>
            {(p) => (
              <NativeSelect {...p} value={reportLocale} onChange={(e) => setReportLocale(e.target.value as 'ar' | 'en')}>
                <option value="ar">{t('create.localeAr')}</option>
                <option value="en">{t('create.localeEn')}</option>
              </NativeSelect>
            )}
          </Field>
          <Field label={t('create.reportTitle')} required>
            {(p) => (
              <Input
                {...p}
                value={title ?? autoTitle}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="report-title"
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={submit}
            loading={create.pending}
            disabled={!clientId || !(title ?? autoTitle).trim() || period.end < period.start}
            data-testid="report-create-submit"
          >
            {t('create.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
