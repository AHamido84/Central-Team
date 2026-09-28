'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { password } from '@/lib/validation';
import { acceptInvitationAction } from '@/modules/invitations/server/accept';

const schema = z
  .object({ fullName: z.string().trim().min(1, { message: 'required' }).max(120), password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'passwords_mismatch', path: ['confirm'] });

export function AcceptInvitationForm({ token, email, defaultName }: { token: string; email: string; defaultName: string }) {
  const t = useTranslations();
  const router = useRouter();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: defaultName, password: '', confirm: '' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    const res = await acceptInvitationAction({ token, ...values });
    if (!res.ok) {
      toast.error(t(`errors.${res.error.code}` as never));
      if (res.error.code === 'invitation_invalid' || res.error.code === 'invitation_expired') router.refresh();
      return;
    }
    router.replace(res.data.redirectTo);
    router.refresh();
  });
  return (
    <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
      <Field label={t('common.email')}>
        {(p) => <Input {...p} value={email} readOnly disabled dir="ltr" />}
      </Field>
      <Field label={t('onboarding.fullName')} error={form.formState.errors.fullName?.message} required>
        {(p) => <Input {...p} autoComplete="name" {...form.register('fullName')} data-testid="accept-name" />}
      </Field>
      <Field label={t('auth.choosePassword')} error={form.formState.errors.password?.message} hint={t('auth.passwordRules')} required>
        {(p) => <Input {...p} type="password" dir="ltr" autoComplete="new-password" {...form.register('password')} data-testid="accept-password" />}
      </Field>
      <Field label={t('auth.confirmPassword')} error={form.formState.errors.confirm?.message} required>
        {(p) => <Input {...p} type="password" dir="ltr" autoComplete="new-password" {...form.register('confirm')} data-testid="accept-confirm" />}
      </Field>
      <Button type="submit" size="lg" loading={form.formState.isSubmitting} data-testid="accept-submit">
        {t('auth.acceptInvitation')}
      </Button>
    </form>
  );
}
