'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, MailCheck, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { sendMagicLinkAction, signInWithPasswordAction } from '@/modules/identity/server/auth-actions';

const passwordForm = z.object({
  email: z.email({ message: 'invalid_email' }),
  password: z.string().min(1, { message: 'required' }),
});
const magicForm = z.object({ email: z.email({ message: 'invalid_email' }) });

export function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const pw = useForm<z.infer<typeof passwordForm>>({ resolver: zodResolver(passwordForm), defaultValues: { email: '', password: '' } });
  const magic = useForm<z.infer<typeof magicForm>>({ resolver: zodResolver(magicForm), defaultValues: { email: '' } });

  const onPassword = pw.handleSubmit(async (values) => {
    setError(null);
    const res = await signInWithPasswordAction({ ...values, next });
    if (!res.ok) {
      setError(t(`errors.${res.error.code}` as never));
      return;
    }
    router.replace(res.data.redirectTo);
    router.refresh();
  });

  const onMagic = magic.handleSubmit(async (values) => {
    setError(null);
    const res = await sendMagicLinkAction(values);
    if (!res.ok) {
      setError(t(`errors.${res.error.code}` as never));
      return;
    }
    setSentTo(values.email);
  });

  if (sentTo) {
    return (
      <div className="text-center" data-testid="magic-link-sent">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
          <MailCheck className="size-6" aria-hidden />
        </div>
        <h1 className="mt-4 text-h2 font-semibold">{t('auth.checkEmailTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.rich('auth.checkEmailBody', { email: sentTo, b: (chunks) => <bdi className="font-medium text-foreground">{chunks}</bdi> })}
        </p>
        <Button variant="ghost" className="mt-6" onClick={() => setSentTo(null)}>
          {t('auth.useAnotherMethod')}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-h1 font-semibold tracking-tight">{t('auth.loginTitle')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t('auth.loginSubtitle')}</p>

      {error ? (
        <div role="alert" className="mt-6 rounded-md border border-danger/20 bg-danger-soft px-3 py-2.5 text-sm text-danger" data-testid="auth-error">
          {error}
        </div>
      ) : null}

      <Tabs defaultValue="password" className="mt-6">
        <TabsList className="w-full">
          <TabsTrigger value="password" className="flex-1">
            <KeyRound />
            {t('auth.tabPassword')}
          </TabsTrigger>
          <TabsTrigger value="magic" className="flex-1" data-testid="tab-magic-link">
            <Wand2 />
            {t('auth.tabMagicLink')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="password">
          <form onSubmit={onPassword} className="grid gap-4" noValidate>
            <Field label={t('common.email')} error={pw.formState.errors.email?.message} required>
              {(p) => <Input {...p} type="email" autoComplete="email" dir="ltr" inputMode="email" {...pw.register('email')} data-testid="login-email" />}
            </Field>
            <Field label={t('auth.password')} error={pw.formState.errors.password?.message} required>
              {(p) => <Input {...p} type="password" autoComplete="current-password" dir="ltr" {...pw.register('password')} data-testid="login-password" />}
            </Field>
            <div className="-mt-1 flex justify-end">
              <Link href="/forgot-password" className="text-sm text-link hover:underline">
                {t('auth.forgotPassword')}
              </Link>
            </div>
            <Button type="submit" size="lg" loading={pw.formState.isSubmitting} data-testid="login-submit">
              {t('auth.signIn')}
            </Button>
          </form>
        </TabsContent>
        <TabsContent value="magic">
          <form onSubmit={onMagic} className="grid gap-4" noValidate>
            <Field label={t('common.email')} error={magic.formState.errors.email?.message} hint={t('auth.magicLinkHint')} required>
              {(p) => <Input {...p} type="email" autoComplete="email" dir="ltr" inputMode="email" {...magic.register('email')} data-testid="magic-email" />}
            </Field>
            <Button type="submit" size="lg" loading={magic.formState.isSubmitting} data-testid="magic-submit">
              {t('auth.sendMagicLink')}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
      <p className="mt-8 text-center text-xs text-subtle-foreground">{t('auth.inviteOnlyNote')}</p>
    </div>
  );
}
