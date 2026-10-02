'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/overlays';
import { NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type LocalizedText } from '@/lib/i18n/localized';
import { useFormat } from '@/components/providers';
import { inputToTarget, inputUnit, targetToInput } from '@/modules/campaigns/components/format';
import {
  campaignObjectives,
  campaignStatuses,
  metricKeys,
  objectiveDefaultKpis,
  platforms,
  type CampaignObjective,
  type CampaignStatus,
  type MetricKey,
  type Platform,
} from '@/modules/campaigns/constants';
import { campaignInputSchema } from '@/modules/campaigns/schemas';
import { saveCampaignAction } from '@/modules/campaigns/server/actions';
import type { CampaignDetail } from '@/modules/campaigns/server/queries';

type FormValues = {
  clientId: string;
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  startDate: string;
  endDate: string;
  budget: string;
  ownerId: string;
  description: string;
  visibility: 'internal' | 'client';
  channels: { id: string; platform: Platform; name: string; budget: string; externalRef: string }[];
  kpis: { metric: MetricKey; target: string; channelId: string }[];
};

const newChannel = (platform: Platform = 'meta') => ({ id: crypto.randomUUID(), platform, name: '', budget: '', externalRef: '' });
const num = (v: string) => (v.trim() === '' ? Number.NaN : Number(v.replace(/[,٬]/g, '')));

function defaults(campaign: CampaignDetail | undefined, clientId: string | undefined, today: string): FormValues {
  if (campaign) {
    return {
      clientId: campaign.clientId,
      name: campaign.name,
      objective: campaign.objective,
      status: campaign.status,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      budget: String(campaign.budgetMinor / 100),
      ownerId: campaign.ownerId ?? '',
      description: campaign.description,
      visibility: campaign.visibility,
      channels: campaign.channels.map((c) => ({
        id: c.id,
        platform: c.platform,
        name: c.name,
        budget: String(c.budgetMinor / 100),
        externalRef: c.externalRef ?? '',
      })),
      kpis: campaign.kpis.map((k) => ({
        metric: k.metric,
        target: String(targetToInput(k.metric, k.target)),
        channelId: k.channelId ?? '',
      })),
    };
  }
  return {
    clientId: clientId ?? '',
    name: '',
    objective: 'awareness',
    status: 'draft',
    startDate: today,
    endDate: today,
    budget: '',
    ownerId: '',
    description: '',
    visibility: 'client',
    channels: [newChannel()],
    kpis: objectiveDefaultKpis.awareness.map((metric) => ({ metric, target: '', channelId: '' })),
  };
}

export function CampaignFormDialog({
  trigger,
  campaign,
  clients,
  people,
  defaultClientId,
  today,
}: {
  trigger: ReactNode;
  campaign?: CampaignDetail;
  clients: { id: string; name: LocalizedText }[];
  people: { id: string; name: string }[];
  defaultClientId?: string;
  today: string;
}) {
  const t = useTranslations('campaigns');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const locale = useLocale() as 'ar' | 'en';
  const f = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const form = useForm<FormValues>({ defaultValues: defaults(campaign, defaultClientId, today) });
  const channels = useFieldArray({ control: form.control, name: 'channels' });
  const kpis = useFieldArray({ control: form.control, name: 'kpis' });
  const watched = useWatch({ control: form.control });
  const [kpisTouched, setKpisTouched] = useState(Boolean(campaign));
  const save = useAction(saveCampaignAction, {
    successMessage: campaign ? t('form.saved') : t('form.created'),
    onSuccess: (data) => {
      setOpen(false);
      if (!campaign) router.push(`/campaigns/${data.campaignId}`);
    },
  });

  const budget = num(watched.budget ?? '');
  const allocated = (watched.channels ?? []).reduce((s, c) => s + (Number.isNaN(num(c?.budget ?? '')) ? 0 : num(c!.budget!)), 0);
  const err = (path: string) => errors[path]?.[0];
  const listError = (key: string) => (tv.has(key as never) ? tv(key as never) : tv('invalid'));

  const onObjective = (objective: CampaignObjective) => {
    form.setValue('objective', objective);
    // Until the user edits KPIs, they follow the objective.
    if (!kpisTouched) kpis.replace(objectiveDefaultKpis[objective].map((metric) => ({ metric, target: '', channelId: '' })));
  };

  const submit = form.handleSubmit(async (v) => {
    const input = {
      campaignId: campaign?.id,
      clientId: v.clientId,
      name: v.name,
      objective: v.objective,
      status: v.status,
      startDate: v.startDate,
      endDate: v.endDate,
      budget: num(v.budget),
      ownerId: v.ownerId || null,
      description: v.description,
      visibility: v.visibility,
      channels: v.channels.map((c) => ({
        id: c.id,
        platform: c.platform,
        name: c.name,
        budget: Number.isNaN(num(c.budget)) ? 0 : num(c.budget),
        externalRef: c.externalRef.trim() || null,
      })),
      kpis: v.kpis.map((k) => ({ metric: k.metric, target: inputToTarget(k.metric, num(k.target)), channelId: k.channelId || null })),
    };
    const parsed = campaignInputSchema.safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        (next[key] ??= []).push(issue.message);
      }
      setErrors(next);
      return;
    }
    setErrors({});
    await save.run(input);
  });

  const money = (v: number) => f.currency(Math.round(v * 100));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          form.reset(defaults(campaign, defaultClientId, today));
          setErrors({});
          setKpisTouched(Boolean(campaign));
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="xl" closeLabel={tc('close')} data-testid="campaign-form">
        <form onSubmit={submit} className="flex min-h-0 flex-col" noValidate>
          <DialogHeader>
            <DialogTitle>{campaign ? t('form.editTitle') : t('form.createTitle')}</DialogTitle>
            <DialogDescription>{t('description')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-6">
            <section className="grid gap-4 sm:grid-cols-2">
              <Field label={t('fields.name')} required error={err('name')} className="sm:col-span-2">
                {(p) => <Input {...p} {...form.register('name')} maxLength={160} data-testid="campaign-name" />}
              </Field>
              <Field label={t('fields.client')} required error={err('clientId')}>
                {(p) => (
                  <NativeSelect {...p} {...form.register('clientId')} disabled={Boolean(campaign)} data-testid="campaign-client">
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
              <Field label={t('fields.objective')} required>
                {(p) => (
                  <NativeSelect
                    {...p}
                    value={watched.objective}
                    onChange={(e) => onObjective(e.target.value as CampaignObjective)}
                    data-testid="campaign-objective"
                  >
                    {campaignObjectives.map((o) => (
                      <option key={o} value={o}>
                        {t(`objective.${o}`)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('fields.startDate')} required error={err('startDate')}>
                {(p) => <Input {...p} type="date" {...form.register('startDate')} data-testid="campaign-start" />}
              </Field>
              <Field label={t('fields.endDate')} required error={err('endDate')}>
                {(p) => <Input {...p} type="date" {...form.register('endDate')} data-testid="campaign-end" />}
              </Field>
              <Field label={t('fields.budget')} required error={err('budget')} hint={t('metrics.moneyHint')}>
                {(p) => <Input {...p} inputMode="decimal" dir="ltr" {...form.register('budget')} data-testid="campaign-budget" />}
              </Field>
              <Field label={t('fields.status')}>
                {(p) => (
                  <NativeSelect {...p} {...form.register('status')} data-testid="campaign-status-select">
                    {campaignStatuses.map((s) => (
                      <option key={s} value={s}>
                        {t(`status.${s}`)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('fields.owner')}>
                {(p) => (
                  <NativeSelect {...p} {...form.register('ownerId')}>
                    <option value="">{t('fields.noOwner')}</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('fields.visibility')} hint={t('form.visibilityHint')}>
                {(p) => (
                  <NativeSelect {...p} {...form.register('visibility')}>
                    <option value="client">{t('fields.visibilityClient')}</option>
                    <option value="internal">{t('fields.visibilityInternal')}</option>
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('fields.description')} optional error={err('description')} className="sm:col-span-2">
                {(p) => <Textarea {...p} rows={2} maxLength={5000} {...form.register('description')} />}
              </Field>
            </section>

            <section className="flex flex-col gap-3" aria-labelledby="channels-title">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 id="channels-title" className="text-sm font-semibold">
                    {t('fields.channels')}
                  </h3>
                  <p className="text-xs text-subtle-foreground">{t('form.channelsHint')}</p>
                </div>
                <p
                  className={allocated > budget ? 'text-xs font-medium text-warning' : 'text-xs text-subtle-foreground'}
                  data-testid="allocation"
                >
                  {allocated > budget
                    ? t('form.allocationOver')
                    : t('form.allocated', { allocated: money(allocated), budget: money(Number.isNaN(budget) ? 0 : budget) })}
                </p>
              </div>
              {err('channels') ? (
                <p role="alert" className="text-xs font-medium text-danger">
                  {listError(err('channels')!)}
                </p>
              ) : null}
              <ul className="flex flex-col gap-2">
                {channels.fields.map((field, i) => (
                  <li
                    key={field.id}
                    className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[10rem_1fr_9rem_auto] sm:items-end"
                    data-testid="channel-row"
                  >
                    <Field label={t('fields.platform')}>
                      {(p) => (
                        <NativeSelect {...p} {...form.register(`channels.${i}.platform`)} data-testid="channel-platform">
                          {platforms.map((pl) => (
                            <option key={pl} value={pl}>
                              {t(`platform.${pl}`)}
                            </option>
                          ))}
                        </NativeSelect>
                      )}
                    </Field>
                    <Field label={t('fields.channelName')} optional>
                      {(p) => <Input {...p} maxLength={120} {...form.register(`channels.${i}.name`)} />}
                    </Field>
                    <Field label={t('fields.channelBudget')} error={err(`channels.${i}.budget`)}>
                      {(p) => (
                        <Input
                          {...p}
                          inputMode="decimal"
                          dir="ltr"
                          {...form.register(`channels.${i}.budget`)}
                          data-testid="channel-budget"
                        />
                      )}
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('form.removeChannel')}
                      disabled={channels.fields.length === 1}
                      onClick={() => {
                        channels.remove(i);
                        const removed = field.id;
                        form.setValue(
                          'kpis',
                          form.getValues('kpis').map((k) => (k.channelId === removed ? { ...k, channelId: '' } : k)),
                        );
                      }}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => channels.append(newChannel())}
                data-testid="add-channel"
              >
                <Plus aria-hidden />
                {t('form.addChannel')}
              </Button>
            </section>

            <section className="flex flex-col gap-3" aria-labelledby="kpis-title">
              <div>
                <h3 id="kpis-title" className="text-sm font-semibold">
                  {t('fields.kpis')}
                </h3>
                <p className="text-xs text-subtle-foreground">{kpisTouched ? t('form.kpiHint') : t('form.kpiSuggested')}</p>
              </div>
              {err('kpis') ? (
                <p role="alert" className="text-xs font-medium text-danger">
                  {listError(err('kpis')!)}
                </p>
              ) : null}
              <ul className="flex flex-col gap-2">
                {kpis.fields.map((field, i) => {
                  const metric = watched.kpis?.[i]?.metric ?? field.metric;
                  const unit = inputUnit(metric);
                  return (
                    <li
                      key={field.id}
                      className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end"
                      data-testid="kpi-row"
                    >
                      <Field label={t('fields.kpiMetric')}>
                        {(p) => (
                          <NativeSelect
                            {...p}
                            {...form.register(`kpis.${i}.metric`, { onChange: () => setKpisTouched(true) })}
                            data-testid="kpi-metric"
                          >
                            {metricKeys.map((m) => (
                              <option key={m} value={m}>
                                {t(`metric.${m}`)}
                              </option>
                            ))}
                          </NativeSelect>
                        )}
                      </Field>
                      <Field label={t('fields.kpiScope')}>
                        {(p) => (
                          <NativeSelect {...p} {...form.register(`kpis.${i}.channelId`, { onChange: () => setKpisTouched(true) })}>
                            <option value="">{t('fields.wholeCampaign')}</option>
                            {(watched.channels ?? []).map((c, ci) =>
                              c?.id ? (
                                <option key={c.id} value={c.id}>
                                  {c.name || `${t(`platform.${c.platform ?? 'other'}`)} ${ci + 1}`}
                                </option>
                              ) : null,
                            )}
                          </NativeSelect>
                        )}
                      </Field>
                      <Field
                        label={unit ? `${t('fields.kpiTarget')} (${unit})` : t('fields.kpiTarget')}
                        required
                        error={err(`kpis.${i}.target`)}
                      >
                        {(p) => (
                          <Input
                            {...p}
                            inputMode="decimal"
                            dir="ltr"
                            {...form.register(`kpis.${i}.target`, { onChange: () => setKpisTouched(true) })}
                            data-testid="kpi-target"
                          />
                        )}
                      </Field>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('form.removeKpi')}
                        onClick={() => {
                          setKpisTouched(true);
                          kpis.remove(i);
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                disabled={kpis.fields.length >= 20}
                onClick={() => {
                  setKpisTouched(true);
                  kpis.append({ metric: 'impressions', target: '', channelId: '' });
                }}
                data-testid="add-kpi"
              >
                <Plus aria-hidden />
                {t('form.addKpi')}
              </Button>
            </section>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={save.pending} data-testid="campaign-save">
              {campaign ? t('form.save') : t('form.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
