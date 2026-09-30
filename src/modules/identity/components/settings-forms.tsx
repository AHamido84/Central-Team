'use client';

import { languageNames } from '@/lib/i18n/localized';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Bell,
  CheckCheck,
  ClipboardList,
  FileUp,
  KeyRound,
  ListTodo,
  Mail,
  Megaphone,
  MessageSquare,
  Handshake,
  Timer,
  UserRound,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Field, FormSection } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, NativeSelect, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { password } from '@/lib/validation';
import { AvatarUploader } from '@/modules/identity/components/avatar-uploader';
import {
  changePasswordAction,
  requestEmailChangeAction,
  updatePreferencesAction,
  updateProfileAction,
} from '@/modules/identity/server/actions';
import { updateNotificationPreferencesAction } from '@/modules/notifications/server/actions';
import type { NotificationCategory } from '@/modules/notifications/types';

const phonePattern = /^(\+?[1-9]\d{7,14}|0?5\d{8})$/;
const profileSchema = z.object({
  fullName: z.string().trim().min(1, { message: 'required' }).max(120),
  phone: z
    .string()
    .trim()
    .refine((v) => !v || phonePattern.test(v.replace(/[\s()-]/g, '')), { message: 'invalid_phone' }),
  whatsapp: z
    .string()
    .trim()
    .refine((v) => !v || phonePattern.test(v.replace(/[\s()-]/g, '')), { message: 'invalid_phone' }),
  avatarPath: z.string().nullable(),
});

export function ProfileSettings({ defaults, email }: { defaults: z.infer<typeof profileSchema>; email: string }) {
  const t = useTranslations();
  const params = useSearchParams();
  const form = useForm<z.infer<typeof profileSchema>>({ resolver: zodResolver(profileSchema), defaultValues: defaults });
  const save = useAction(updateProfileAction, { successMessage: t('common.saved') });
  const [newEmail, setNewEmail] = useState('');
  const emailChange = useAction(requestEmailChangeAction, { successMessage: t('settings.emailChangeSent'), refresh: false });
  const pwForm = useForm<{ password: string }>({ resolver: zodResolver(z.object({ password })), defaultValues: { password: '' } });
  const pw = useAction(changePasswordAction, { successMessage: t('auth.passwordUpdated'), refresh: false });

  useEffect(() => {
    if (params.get('email_changed')) toast.success(t('settings.emailChanged'));
  }, [params, t]);

  const submit = form.handleSubmit(async (v) => {
    const res = await save.run({
      fullName: v.fullName,
      phone: v.phone || undefined,
      whatsapp: v.whatsapp || undefined,
      avatarPath: v.avatarPath,
    });
    if (res.ok) form.reset(v);
  });

  return (
    <div className="space-y-6">
      <form onSubmit={submit} noValidate>
        <Card className="px-5">
          <FormSection title={t('settings.profileSection')} description={t('settings.profileSectionHint')}>
            <Controller
              control={form.control}
              name="avatarPath"
              render={({ field }) => <AvatarUploader name={form.watch('fullName')} value={field.value} onChange={field.onChange} />}
            />
            <Field label={t('onboarding.fullName')} error={form.formState.errors.fullName?.message} required>
              {(p) => <Input {...p} {...form.register('fullName')} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('onboarding.phone')} error={form.formState.errors.phone?.message} optional>
                {(p) => <Input {...p} type="tel" dir="ltr" placeholder="05XXXXXXXX" {...form.register('phone')} />}
              </Field>
              <Field label={t('onboarding.whatsapp')} error={form.formState.errors.whatsapp?.message} optional>
                {(p) => <Input {...p} type="tel" dir="ltr" placeholder="05XXXXXXXX" {...form.register('whatsapp')} />}
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
                <UserRound />
                {t('common.saveChanges')}
              </Button>
            </div>
          </FormSection>
        </Card>
      </form>

      <Card className="px-5">
        <FormSection title={t('settings.emailSection')} description={t('settings.emailSectionHint', { email })}>
          <Field label={t('settings.newEmail')}>
            {(p) => <Input {...p} type="email" dir="ltr" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />}
          </Field>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              loading={emailChange.pending}
              disabled={!newEmail}
              onClick={async () => {
                const res = await emailChange.run({ email: newEmail });
                if (res.ok) setNewEmail('');
              }}
            >
              <Mail />
              {t('settings.sendConfirmation')}
            </Button>
          </div>
        </FormSection>
        <FormSection title={t('settings.passwordSection')} description={t('auth.passwordRules')}>
          <form
            onSubmit={pwForm.handleSubmit(async (v) => {
              const res = await pw.run(v);
              if (res.ok) pwForm.reset();
            })}
            noValidate
            className="grid gap-4"
          >
            <Field label={t('auth.newPassword')} error={pwForm.formState.errors.password?.message}>
              {(p) => <Input {...p} type="password" dir="ltr" autoComplete="new-password" {...pwForm.register('password')} />}
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="outline" loading={pwForm.formState.isSubmitting}>
                <KeyRound />
                {t('auth.updatePassword')}
              </Button>
            </div>
          </form>
        </FormSection>
      </Card>
    </div>
  );
}

const prefsSchema = z.object({
  locale: z.enum(['ar', 'en']),
  theme: z.enum(['system', 'light', 'dark']),
  timezone: z.string(),
  calendar: z.enum(['gregory', 'islamic-umalqura']),
});

export function PreferencesSettings({ defaults, timezones }: { defaults: z.infer<typeof prefsSchema>; timezones: string[] }) {
  const t = useTranslations();
  const { setTheme } = useTheme();
  const form = useForm<z.infer<typeof prefsSchema>>({ resolver: zodResolver(prefsSchema), defaultValues: defaults });
  const save = useAction(updatePreferencesAction, { successMessage: t('common.saved') });
  const submit = form.handleSubmit(async (v) => {
    const res = await save.run(v);
    if (res.ok) {
      setTheme(v.theme);
      form.reset(v);
    }
  });
  return (
    <form onSubmit={submit} noValidate>
      <Card className="px-5">
        <FormSection title={t('settings.displaySection')} description={t('settings.displaySectionHint')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('common.language')}>
              {(p) => (
                <NativeSelect {...p} {...form.register('locale')} data-testid="prefs-locale">
                  <option value="ar">{languageNames.ar}</option>
                  <option value="en">{languageNames.en}</option>
                </NativeSelect>
              )}
            </Field>
            <Field label={t('common.theme')}>
              {(p) => (
                <NativeSelect {...p} {...form.register('theme')}>
                  <option value="system">{t('common.system')}</option>
                  <option value="light">{t('common.light')}</option>
                  <option value="dark">{t('common.dark')}</option>
                </NativeSelect>
              )}
            </Field>
          </div>
        </FormSection>
        <FormSection title={t('settings.regionSection')} description={t('settings.regionSectionHint')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.timezone')}>
              {(p) => (
                <NativeSelect {...p} {...form.register('timezone')}>
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label={t('settings.calendar')} hint={t('settings.calendarHint')}>
              {(p) => (
                <NativeSelect {...p} {...form.register('calendar')}>
                  <option value="gregory">{t('settings.gregorian')}</option>
                  <option value="islamic-umalqura">{t('settings.hijri')}</option>
                </NativeSelect>
              )}
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty} data-testid="prefs-save">
              {t('common.saveChanges')}
            </Button>
          </div>
        </FormSection>
      </Card>
    </form>
  );
}

const categoryIcon: Record<NotificationCategory, typeof Bell> = {
  account: Bell,
  messages: MessageSquare,
  files: FileUp,
  requests: ClipboardList,
  tasks: ListTodo,
  approvals: CheckCheck,
  campaigns: Megaphone,
  sla: Timer,
  sales: Handshake,
};

export function NotificationSettings({ defaults }: { defaults: { category: NotificationCategory; inApp: boolean; email: boolean }[] }) {
  const t = useTranslations();
  const [prefs, setPrefs] = useState(defaults);
  const save = useAction(updateNotificationPreferencesAction, { successMessage: t('common.saved'), refresh: false });
  const update = (category: NotificationCategory, key: 'inApp' | 'email', value: boolean) => {
    const next = prefs.map((p) => (p.category === category ? { ...p, [key]: value } : p));
    setPrefs(next);
    void save.run({ preferences: next });
  };
  return (
    <Card className="divide-y divide-border">
      <div className="hidden grid-cols-[1fr_6rem_6rem] items-center gap-4 px-5 py-3 text-xs font-medium text-muted-foreground sm:grid">
        <span>{t('settings.category')}</span>
        <span className="text-center">{t('settings.inApp')}</span>
        <span className="text-center">{t('settings.emailChannel')}</span>
      </div>
      {prefs.map((p) => {
        const Icon = categoryIcon[p.category];
        return (
          <div key={p.category} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-4 sm:grid-cols-[1fr_6rem_6rem]">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-muted text-muted-foreground">
                <Icon className="size-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-medium">{t(`settings.categories.${p.category}.title`)}</p>
                <p className="text-xs text-subtle-foreground">{t(`settings.categories.${p.category}.body`)}</p>
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Switch
                checked={p.inApp}
                onCheckedChange={(v) => update(p.category, 'inApp', v)}
                aria-label={`${t(`settings.categories.${p.category}.title`)} · ${t('settings.inApp')}`}
              />
              <span className="text-[0.6875rem] text-subtle-foreground sm:hidden">{t('settings.inApp')}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Switch
                checked={p.email}
                onCheckedChange={(v) => update(p.category, 'email', v)}
                aria-label={`${t(`settings.categories.${p.category}.title`)} · ${t('settings.emailChannel')}`}
              />
              <span className="text-[0.6875rem] text-subtle-foreground sm:hidden">{t('settings.emailChannel')}</span>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
