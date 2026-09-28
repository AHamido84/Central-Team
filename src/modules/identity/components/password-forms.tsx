'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { DirIcon } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { password } from '@/lib/validation';
import { resetPasswordAction, sendPasswordResetAction } from '@/modules/identity/server/auth-actions';

export function PasswordStrengthHint() {
  const t = useTranslations('auth');
  return <p className="text-xs text-subtle-foreground">{t('passwordRules')}</p>;
}

export function ForgotPasswordForm() {
  const t = useTranslations();
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ email: string }>({
    resolver: zodResolver(z.object({ email: z.email({ message: 'invalid_email' }) })),
    defaultValues: { email: '' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const res = await sendPasswordResetAction(values);
    if (!res.ok) return setError(t(`errors.${res.error.code}` as never));
    setSent(values.email);
  });

  if (sent) {
    return (
      <div className="text-center" data-testid="reset-sent">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
          <MailCheck className="size-6" aria-hidden />
        </div>
        <h1 className="mt-4 text-h2 font-semibold">{t('auth.checkEmailTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.rich('auth.resetSentBody', { email: sent, b: (c) => <bdi className="font-medium text-foreground">{c}</bdi> })}
        </p>
        <Button asChild variant="ghost" className="mt-6">
          <Link href="/login">{t('auth.backToLogin')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <DirIcon icon={ArrowLeft} className="size-4" />
        {t('auth.backToLogin')}
      </Link>
      <h1 className="mt-6 text-h1 font-semibold tracking-tight">{t('auth.forgotTitle')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('auth.forgotSubtitle')}</p>
      {error ? (
        <div role="alert" className="mt-6 rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger">
          {error}
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
        <Field label={t('common.email')} error={form.formState.errors.email?.message} required>
          {(p) => <Input {...p} type="email" dir="ltr" autoComplete="email" {...form.register('email')} data-testid="forgot-email" />}
        </Field>
        <Button type="submit" size="lg" loading={form.formState.isSubmitting} data-testid="forgot-submit">
          {t('auth.sendResetLink')}
        </Button>
      </form>
    </div>
  );
}

const resetSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'passwords_mismatch', path: ['confirm'] });

export function ResetPasswordForm() {
  const t = useTranslations();
  const router = useRouter();
  const form = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), defaultValues: { password: '', confirm: '' } });
  const onSubmit = form.handleSubmit(async (values) => {
    const res = await resetPasswordAction(values);
    if (!res.ok) {
      toast.error(t(`errors.${res.error.code}` as never));
      return;
    }
    toast.success(t('auth.passwordUpdated'));
    router.replace(res.data.redirectTo);
    router.refresh();
  });
  return (
    <div>
      <h1 className="text-h1 font-semibold tracking-tight">{t('auth.resetTitle')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('auth.resetSubtitle')}</p>
      <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
        <Field label={t('auth.newPassword')} error={form.formState.errors.password?.message} hint={t('auth.passwordRules')} required>
          {(p) => <Input {...p} type="password" dir="ltr" autoComplete="new-password" {...form.register('password')} data-testid="reset-password" />}
        </Field>
        <Field label={t('auth.confirmPassword')} error={form.formState.errors.confirm?.message} required>
          {(p) => <Input {...p} type="password" dir="ltr" autoComplete="new-password" {...form.register('confirm')} data-testid="reset-confirm" />}
        </Field>
        <Button type="submit" size="lg" loading={form.formState.isSubmitting} data-testid="reset-submit">
          {t('auth.updatePassword')}
        </Button>
      </form>
    </div>
  );
}
