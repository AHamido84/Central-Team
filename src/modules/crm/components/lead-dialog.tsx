'use client';

import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { NativeSelect } from '@/components/ui/primitives';
import type { ActionError } from '@/lib/actions/errors';
import { useAction } from '@/lib/actions/use-action';
import { cn } from '@/lib/utils/cn';
import { cities } from '@/modules/clients/constants';
import { budgetRanges, crmServices, leadSources, type BudgetRange, type CrmService, type LeadSource } from '@/modules/crm/constants';
import { findLeadDuplicatesAction, saveLeadAction } from '@/modules/crm/server/actions';

export type LeadDraft = {
  id?: string;
  fullName: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  source: LeadSource;
  sourceDetail: string | null;
  services: string[];
  budgetRange: BudgetRange;
  city: string | null;
  ownerId: string | null;
  tags: string[];
  notes: string;
};

const emptyLead = (ownerId: string | null): LeadDraft => ({
  fullName: '',
  company: null,
  phone: null,
  email: null,
  source: 'manual',
  sourceDetail: null,
  services: [],
  budgetRange: 'unknown',
  city: null,
  ownerId,
  tags: [],
  notes: '',
});

export function ServicePicker({
  value,
  onChange,
  testId,
  only,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  testId?: string;
  /** Restrict the choices (a public form's offered services). */
  only?: readonly string[];
}) {
  const t = useTranslations('crm.services');
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {crmServices
        .filter((s) => !only || only.includes(s))
        .map((s) => {
          const on = value.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== s) : [...value, s])}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                on
                  ? 'border-primary bg-primary-soft text-primary-soft-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
              data-value={s}
            >
              {t(s as CrmService)}
            </button>
          );
        })}
    </div>
  );
}

type DialogProps = {
  lead: LeadDraft | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  owners: { id: string; name: string }[];
  me: string;
  canManageAll: boolean;
};

export function LeadDialog(props: DialogProps) {
  const t = useTranslations('common');
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent closeLabel={t('close')} size="lg">
        {/* Mounted only while open, so every opening starts from the lead's current values. */}
        <LeadFormBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

function LeadFormBody({ lead, onOpenChange, owners, me, canManageAll }: DialogProps) {
  const t = useTranslations();
  const router = useRouter();
  const [v, setV] = useState<LeadDraft>(lead ?? emptyLead(canManageAll ? null : me));
  const [tagText, setTagText] = useState((lead?.tags ?? []).join(', '));
  const [errors, setErrors] = useState<ActionError['fieldErrors']>();
  const [dups, setDups] = useState<{ id: string; number: number; fullName: string }[]>([]);
  const save = useAction(saveLeadAction, { successMessage: t('common.saved'), refresh: true });
  const check = useAction(findLeadDuplicatesAction, { refresh: false });

  const set = <K extends keyof LeadDraft>(k: K, value: LeadDraft[K]) => setV((x) => ({ ...x, [k]: value }));
  const lookup = async () => {
    if (!v.phone && !v.email) return setDups([]);
    const res = await check.run({ phone: v.phone, email: v.email, excludeId: v.id });
    if (res.ok) setDups(res.data);
  };
  const err = (k: string) => errors?.[k]?.[0];

  return (
    <form
      className="flex min-h-0 flex-col"
      noValidate
      data-testid="lead-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await save.run({
          leadId: v.id,
          ...v,
          tags: tagText
            .split(/[,،]/)
            .map((x) => x.trim())
            .filter(Boolean),
        } as Parameters<typeof saveLeadAction>[0]);
        if (!res.ok) return setErrors(res.error.fieldErrors);
        onOpenChange(false);
        if (!v.id) router.push(`/crm/leads/${res.data.leadId}`);
      }}
    >
      <DialogHeader>
        <DialogTitle>{v.id ? t('crm.leads.edit') : t('crm.leads.new')}</DialogTitle>
      </DialogHeader>
      <DialogBody className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('crm.leads.name')} error={err('fullName')} required>
            {(p) => (
              <Input {...p} value={v.fullName} onChange={(e) => set('fullName', e.target.value)} maxLength={120} data-testid="lead-name" />
            )}
          </Field>
          <Field label={t('crm.leads.company')} optional>
            {(p) => (
              <Input
                {...p}
                value={v.company ?? ''}
                onChange={(e) => set('company', e.target.value || null)}
                maxLength={120}
                data-testid="lead-company"
              />
            )}
          </Field>
          <Field label={t('crm.leads.phone')} hint={t('crm.leads.phoneHint')} error={err('phone')}>
            {(p) => (
              <Input
                {...p}
                type="tel"
                dir="ltr"
                inputMode="tel"
                value={v.phone ?? ''}
                onChange={(e) => set('phone', e.target.value || null)}
                onBlur={lookup}
                data-testid="lead-phone"
              />
            )}
          </Field>
          <Field label={t('crm.leads.email')} error={err('email')}>
            {(p) => (
              <Input
                {...p}
                type="email"
                dir="ltr"
                value={v.email ?? ''}
                onChange={(e) => set('email', e.target.value || null)}
                onBlur={lookup}
                data-testid="lead-email"
              />
            )}
          </Field>
        </div>
        {dups.length ? (
          <p
            className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning"
            role="status"
            data-testid="lead-duplicate-warning"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="grid gap-1">
              <span className="font-medium">{t('crm.leads.duplicates')}</span>
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {dups.map((d) => (
                  <Link key={d.id} href={`/crm/leads/${d.id}`} className="underline">
                    <bdi>{d.fullName}</bdi>
                  </Link>
                ))}
              </span>
            </span>
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('crm.leads.source')}>
            {(p) => (
              <NativeSelect {...p} value={v.source} onChange={(e) => set('source', e.target.value as LeadSource)} data-testid="lead-source">
                {leadSources.map((s) => (
                  <option key={s} value={s}>
                    {t(`crm.sources.${s}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('crm.leads.budget')}>
            {(p) => (
              <NativeSelect
                {...p}
                value={v.budgetRange}
                onChange={(e) => set('budgetRange', e.target.value as BudgetRange)}
                data-testid="lead-budget"
              >
                {budgetRanges.map((s) => (
                  <option key={s} value={s}>
                    {t(`crm.budgets.${s}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('crm.leads.city')} optional>
            {(p) => (
              <NativeSelect {...p} value={v.city ?? ''} onChange={(e) => set('city', e.target.value || null)}>
                <option value="">—</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {t(`clients.cities.${c}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
        <Field label={t('crm.leads.sourceDetail')} hint={t('crm.leads.sourceDetailHint')} optional>
          {(p) => (
            <Input {...p} value={v.sourceDetail ?? ''} onChange={(e) => set('sourceDetail', e.target.value || null)} maxLength={200} />
          )}
        </Field>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t('crm.leads.services')}</legend>
          <ServicePicker value={v.services} onChange={(s) => set('services', s)} testId="lead-services" />
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('crm.leads.owner')}>
            {(p) => (
              <NativeSelect
                {...p}
                value={v.ownerId ?? ''}
                onChange={(e) => set('ownerId', e.target.value || null)}
                disabled={!canManageAll}
                data-testid="lead-owner"
              >
                <option value="">{v.id ? t('crm.leads.unassigned') : t('crm.leads.autoAssign')}</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('crm.leads.tags')} hint={t('crm.leads.tagsHint')} optional>
            {(p) => <Input {...p} value={tagText} onChange={(e) => setTagText(e.target.value)} />}
          </Field>
        </div>
        <Field label={t('crm.leads.notes')} optional>
          {(p) => <Textarea {...p} value={v.notes} onChange={(e) => set('notes', e.target.value)} rows={3} maxLength={4000} />}
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={save.pending} data-testid="lead-save">
          {t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
