'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { LogoUploader } from '@/components/patterns/logo-uploader';
import { Button } from '@/components/ui/button';
import { Field, FormSection } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { updateOrganizationAction } from '@/modules/organizations/server/actions';

const presets = ['#5140E0', '#148780', '#0B5C75', '#6D2E46', '#B07236', '#1F2937'];

const schema = z
  .object({
    nameAr: z.string().trim().max(100),
    nameEn: z.string().trim().max(100),
    supportEmail: z.union([z.literal(''), z.email({ message: 'invalid_email' })]),
    supportWhatsapp: z.string().trim(),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: 'required' }),
    logoPath: z.string().nullable(),
    defaultLocale: z.enum(['ar', 'en']),
    defaultTimezone: z.string(),
  })
  .refine((v) => v.nameAr || v.nameEn, { message: 'required_one_language', path: ['nameAr'] });

export type OrganizationFormValues = z.infer<typeof schema>;

export function OrganizationForm({ defaults, timezones }: { defaults: OrganizationFormValues; timezones: string[] }) {
  const t = useTranslations();
  const form = useForm<OrganizationFormValues>({ resolver: zodResolver(schema), defaultValues: defaults });
  const save = useAction(updateOrganizationAction, { successMessage: t('common.saved') });
  const submit = form.handleSubmit(async (v) => {
    const res = await save.run({
      name: { ar: v.nameAr, en: v.nameEn },
      supportEmail: v.supportEmail,
      supportWhatsapp: v.supportWhatsapp || undefined,
      brandColor: v.brandColor,
      logoPath: v.logoPath,
      defaultLocale: v.defaultLocale,
      defaultTimezone: v.defaultTimezone,
    });
    if (res.ok) form.reset(v);
  });
  const brand = form.watch('brandColor');
  return (
    <form onSubmit={submit} noValidate>
      <Card className="px-5">
        <FormSection title={t('admin.organization.identity')} description={t('admin.organization.identityHint')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.nameAr')} error={form.formState.errors.nameAr?.message}>
              {(p) => <Input {...p} dir="rtl" lang="ar" {...form.register('nameAr')} />}
            </Field>
            <Field label={t('admin.nameEn')}>{(p) => <Input {...p} dir="ltr" lang="en" {...form.register('nameEn')} />}</Field>
          </div>
          <Controller
            control={form.control}
            name="logoPath"
            render={({ field }) => <LogoUploader name={form.watch('nameEn') || form.watch('nameAr')} value={field.value} onChange={field.onChange} target="organization" />}
          />
        </FormSection>
        <FormSection title={t('admin.organization.branding')} description={t('admin.organization.brandingHint')}>
          <Controller
            control={form.control}
            name="brandColor"
            render={({ field }) => (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {presets.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      aria-pressed={field.value.toLowerCase() === c.toLowerCase()}
                      onClick={() => field.onChange(c)}
                      className="size-8 rounded-full ring-offset-2 ring-offset-surface aria-pressed:ring-2 aria-pressed:ring-ring"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <Input type="color" aria-label={t('admin.organization.customColor')} value={field.value} onChange={(e) => field.onChange(e.target.value)} className="h-8 w-12 cursor-pointer p-1" />
                  <code className="text-xs text-muted-foreground" dir="ltr">
                    {field.value}
                  </code>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-border p-4" style={{ ['--brand' as string]: brand }}>
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground">
                    {(form.watch('nameAr') || form.watch('nameEn')).charAt(0)}
                  </span>
                  <span className="text-sm text-muted-foreground">{t('admin.organization.preview')}</span>
                  <Button type="button" size="sm" className="ms-auto">
                    {t('admin.organization.previewButton')}
                  </Button>
                </div>
              </div>
            )}
          />
        </FormSection>
        <FormSection title={t('admin.organization.contact')} description={t('admin.organization.contactHint')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.organization.supportEmail')} error={form.formState.errors.supportEmail?.message} optional>
              {(p) => <Input {...p} type="email" dir="ltr" {...form.register('supportEmail')} />}
            </Field>
            <Field label={t('admin.organization.supportWhatsapp')} optional>
              {(p) => <Input {...p} type="tel" dir="ltr" placeholder="05XXXXXXXX" {...form.register('supportWhatsapp')} />}
            </Field>
          </div>
        </FormSection>
        <FormSection title={t('admin.organization.defaults')} description={t('admin.organization.defaultsHint')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('common.language')}>
              {(p) => (
                <NativeSelect {...p} {...form.register('defaultLocale')}>
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </NativeSelect>
              )}
            </Field>
            <Field label={t('settings.timezone')}>
              {(p) => (
                <NativeSelect {...p} {...form.register('defaultTimezone')}>
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
        </FormSection>
      </Card>
      <div className="sticky bottom-0 mt-4 flex justify-end gap-2 bg-background/80 py-3 backdrop-blur">
        <Button type="button" variant="outline" disabled={!form.formState.isDirty} onClick={() => form.reset()}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>
          {t('common.saveChanges')}
        </Button>
      </div>
    </form>
  );
}
