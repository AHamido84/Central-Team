'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, Check, Monitor, Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { DirIcon } from '@/components/patterns';
import { useSwitchLocale } from '@/components/shell/preferences-menu';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import { AvatarUploader } from '@/modules/identity/components/avatar-uploader';
import { completeOnboardingAction } from '@/modules/identity/server/actions';

const phonePattern = /^(\+?[1-9]\d{7,14}|0?5\d{8})$/;
const schema = z.object({
  fullName: z.string().trim().min(1, { message: 'required' }).max(120, { message: 'too_long' }),
  phone: z.string().trim().refine((v) => v === '' || phonePattern.test(v.replace(/[\s()-]/g, '')), { message: 'invalid_phone' }),
  whatsapp: z.string().trim().refine((v) => v === '' || phonePattern.test(v.replace(/[\s()-]/g, '')), { message: 'invalid_phone' }),
  avatarPath: z.string().nullable(),
  locale: z.enum(['ar', 'en']),
  theme: z.enum(['system', 'light', 'dark']),
});
type Values = z.infer<typeof schema>;

const steps = ['stepProfile', 'stepPhoto', 'stepPreferences'] as const;

export function OnboardingWizard({ defaults }: { defaults: Values }) {
  const t = useTranslations();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const { setTheme } = useTheme();
  const { switchTo: switchLocale } = useSwitchLocale();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults, mode: 'onTouched' });

  const next = async () => {
    const fields: (keyof Values)[][] = [['fullName', 'phone', 'whatsapp'], ['avatarPath'], ['locale', 'theme']];
    if (await form.trigger(fields[step])) setStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const submit = form.handleSubmit(async (values) => {
    const res = await completeOnboardingAction({
      ...values,
      phone: values.phone || undefined,
      whatsapp: values.whatsapp || undefined,
    });
    if (!res.ok) {
      toast.error(t(`errors.${res.error.code}` as never));
      return;
    }
    toast.success(t('onboarding.done'));
    router.replace(res.data.redirectTo);
    router.refresh();
  });

  const fullName = form.watch('fullName');

  return (
    <div>
      <ol className="mb-8 flex items-center gap-2" aria-label={t('onboarding.progress')}>
        {steps.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                i < step && 'bg-primary text-primary-foreground',
                i === step && 'bg-primary-soft text-primary-soft-foreground ring-2 ring-primary',
                i > step && 'bg-surface-muted text-subtle-foreground',
              )}
              aria-current={i === step ? 'step' : undefined}
            >
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn('hidden text-xs font-medium sm:block', i === step ? 'text-foreground' : 'text-subtle-foreground')}>
              {t(`onboarding.${s}`)}
            </span>
            {i < steps.length - 1 ? <span className="h-px flex-1 bg-border" aria-hidden /> : null}
          </li>
        ))}
      </ol>

      <h1 className="text-h1 font-semibold tracking-tight">{t(`onboarding.${steps[step]!}Title`)}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t(`onboarding.${steps[step]!}Body`)}</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step < steps.length - 1) void next();
          else void submit();
        }}
        className="mt-6 grid gap-4"
        noValidate
      >
        {step === 0 ? (
          <>
            <Field label={t('onboarding.fullName')} error={form.formState.errors.fullName?.message} required>
              {(p) => <Input {...p} autoComplete="name" {...form.register('fullName')} data-testid="onboarding-name" />}
            </Field>
            <Field label={t('onboarding.phone')} error={form.formState.errors.phone?.message} hint={t('onboarding.phoneHint')} optional>
              {(p) => <Input {...p} type="tel" dir="ltr" inputMode="tel" placeholder="05XXXXXXXX" autoComplete="tel" {...form.register('phone')} data-testid="onboarding-phone" />}
            </Field>
            <Field label={t('onboarding.whatsapp')} error={form.formState.errors.whatsapp?.message} hint={t('onboarding.whatsappHint')} optional>
              {(p) => <Input {...p} type="tel" dir="ltr" inputMode="tel" placeholder="05XXXXXXXX" {...form.register('whatsapp')} />}
            </Field>
          </>
        ) : null}

        {step === 1 ? (
          <Controller
            control={form.control}
            name="avatarPath"
            render={({ field }) => <AvatarUploader name={fullName} value={field.value} onChange={field.onChange} />}
          />
        ) : null}

        {step === 2 ? (
          <>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">{t('common.language')}</legend>
              <Controller
                control={form.control}
                name="locale"
                render={({ field }) => (
                  <div className="grid grid-cols-2 gap-2">
                    {(['ar', 'en'] as const).map((l) => (
                      <button
                        key={l}
                        type="button"
                        lang={l}
                        onClick={() => {
                          field.onChange(l);
                          switchLocale(l);
                        }}
                        className={cn(
                          'rounded-lg border px-4 py-3 text-start text-sm font-medium transition-colors',
                          field.value === l ? 'border-primary bg-primary-soft text-primary-soft-foreground' : 'border-border hover:bg-surface-muted',
                        )}
                        aria-pressed={field.value === l}
                        data-testid={`onboarding-locale-${l}`}
                      >
                        {l === 'ar' ? 'العربية' : 'English'}
                      </button>
                    ))}
                  </div>
                )}
              />
            </fieldset>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">{t('common.theme')}</legend>
              <Controller
                control={form.control}
                name="theme"
                render={({ field }) => (
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      ['light', Sun],
                      ['dark', Moon],
                      ['system', Monitor],
                    ] as const).map(([value, Icon]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          field.onChange(value);
                          setTheme(value);
                        }}
                        className={cn(
                          'flex flex-col items-center gap-2 rounded-lg border px-3 py-3 text-sm font-medium transition-colors',
                          field.value === value ? 'border-primary bg-primary-soft text-primary-soft-foreground' : 'border-border hover:bg-surface-muted',
                        )}
                        aria-pressed={field.value === value}
                      >
                        <Icon className="size-5" aria-hidden />
                        {t(`common.${value}`)}
                      </button>
                    ))}
                  </div>
                )}
              />
            </fieldset>
          </>
        ) : null}

        <div className="mt-2 flex items-center justify-between gap-2">
          {step > 0 ? (
            <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
              <DirIcon icon={ArrowLeft} />
              {t('common.back')}
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" size="lg" loading={form.formState.isSubmitting} data-testid="onboarding-next">
            {step < steps.length - 1 ? t('common.continue') : t('onboarding.finish')}
            {step < steps.length - 1 ? <DirIcon icon={ArrowRight} /> : null}
          </Button>
        </div>
        {step === 1 ? (
          <button type="button" className="text-center text-sm text-muted-foreground hover:text-foreground" onClick={() => setStep(2)}>
            {t('onboarding.skipPhoto')}
          </button>
        ) : null}
      </form>
    </div>
  );
}
