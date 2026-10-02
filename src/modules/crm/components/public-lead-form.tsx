'use client';

import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/primitives';
import { cities } from '@/modules/clients/constants';
import { ServicePicker } from '@/modules/crm/components/lead-dialog';
import { budgetRanges, type BudgetRange } from '@/modules/crm/constants';

type Errors = Record<string, string[] | undefined>;

export function PublicLeadForm({
  token,
  ticket,
  services,
  thankYou,
}: {
  token: string;
  ticket: string;
  services: string[];
  thankYou: string;
}) {
  const t = useTranslations();
  const [values, setValues] = useState({
    fullName: '',
    company: '',
    phone: '',
    email: '',
    city: '',
    services: [] as string[],
    budgetRange: 'unknown' as BudgetRange,
    message: '',
  });
  const [website, setWebsite] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof typeof values>(k: K, v: (typeof values)[K]) => setValues((x) => ({ ...x, [k]: v }));
  const err = (k: string) => errors[k]?.[0];

  if (state === 'done') {
    return (
      <div
        className="mt-8 flex flex-col items-center gap-3 rounded-xl border border-border bg-surface p-8 text-center"
        role="status"
        data-testid="public-form-done"
      >
        <CheckCircle2 className="size-10 text-success" aria-hidden />
        <p className="text-lg font-semibold">{t('crm.publicForm.thanks')}</p>
        <p className="text-sm text-muted-foreground">{thankYou || t('crm.publicForm.thanksDefault')}</p>
      </div>
    );
  }

  return (
    <form
      className="mt-6 grid gap-4"
      noValidate
      data-testid="public-lead-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setState('sending');
        setProblem(null);
        setErrors({});
        try {
          const res = await fetch(`/api/public/lead-forms/${token}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ fields: { ...values, city: values.city || null }, website, ticket }),
          });
          const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; fieldErrors?: Errors };
          if (res.ok && data.ok) return setState('done');
          setState('idle');
          if (data.fieldErrors) return setErrors(data.fieldErrors);
          const known = ['too_fast', 'expired', 'rate_limited'] as const;
          setProblem(t(`crm.publicForm.errors.${known.find((k) => k === data.error) ?? 'generic'}`));
        } catch {
          setState('idle');
          setProblem(t('crm.publicForm.errors.generic'));
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('crm.publicForm.name')} error={err('fullName')} required>
          {(p) => (
            <Input
              {...p}
              autoComplete="name"
              value={values.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              maxLength={120}
              data-testid="pf-name"
            />
          )}
        </Field>
        <Field label={t('crm.publicForm.company')} optional>
          {(p) => (
            <Input
              {...p}
              autoComplete="organization"
              value={values.company}
              onChange={(e) => set('company', e.target.value)}
              maxLength={120}
              data-testid="pf-company"
            />
          )}
        </Field>
        <Field label={t('crm.publicForm.phone')} error={err('phone')}>
          {(p) => (
            <Input
              {...p}
              type="tel"
              dir="ltr"
              autoComplete="tel"
              inputMode="tel"
              value={values.phone}
              onChange={(e) => set('phone', e.target.value)}
              data-testid="pf-phone"
            />
          )}
        </Field>
        <Field label={t('crm.publicForm.email')} error={err('email')}>
          {(p) => (
            <Input
              {...p}
              type="email"
              dir="ltr"
              autoComplete="email"
              value={values.email}
              onChange={(e) => set('email', e.target.value)}
              data-testid="pf-email"
            />
          )}
        </Field>
        <Field label={t('crm.publicForm.city')} optional>
          {(p) => (
            <NativeSelect {...p} value={values.city} onChange={(e) => set('city', e.target.value)} data-testid="pf-city">
              <option value="">—</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {t(`clients.cities.${c}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label={t('crm.publicForm.budget')} optional>
          {(p) => (
            <NativeSelect
              {...p}
              value={values.budgetRange}
              onChange={(e) => set('budgetRange', e.target.value as BudgetRange)}
              data-testid="pf-budget"
            >
              {budgetRanges.map((b) => (
                <option key={b} value={b}>
                  {t(`crm.budgets.${b}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t('crm.publicForm.services')}</legend>
        <ServicePicker
          value={values.services}
          onChange={(v) => set('services', v)}
          only={services.length ? services : undefined}
          testId="pf-services"
        />
      </fieldset>
      <Field label={t('crm.publicForm.message')} optional>
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            value={values.message}
            onChange={(e) => set('message', e.target.value)}
            maxLength={2000}
            data-testid="pf-message"
          />
        )}
      </Field>
      {/* Honeypot: invisible to people (and to screen readers), irresistible to bots. */}
      <div aria-hidden className="absolute -start-[9999px] size-px overflow-hidden">
        <label>
          {t('crm.publicForm.honeypot')}
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
        </label>
      </div>
      {problem ? (
        <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
          {problem}
        </p>
      ) : null}
      <Button type="submit" size="lg" loading={state === 'sending'} data-testid="pf-submit">
        {state === 'sending' ? t('crm.publicForm.sending') : t('crm.publicForm.submit')}
      </Button>
      <p className="text-xs text-subtle-foreground">{t('crm.publicForm.privacy')}</p>
    </form>
  );
}
