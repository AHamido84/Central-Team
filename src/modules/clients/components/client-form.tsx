'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AtSign, Globe } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { LogoUploader } from '@/components/patterns/logo-uploader';
import { Button } from '@/components/ui/button';
import { Field, FormSection } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { Avatar, Card, Checkbox, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { cities, clientStatuses, industries, socialNetworks } from '@/modules/clients/constants';
import { createClientAction, updateClientAction, updateCompanyProfileAction } from '@/modules/clients/server/actions';

const schema = z
  .object({
    nameAr: z.string().trim().max(120),
    nameEn: z.string().trim().max(120),
    industry: z.string(),
    city: z.string(),
    website: z.string().trim().max(200),
    social: z.record(z.string(), z.string().trim().max(80)),
    logoPath: z.string().nullable(),
    status: z.enum(clientStatuses),
    accountManagerId: z.string(),
    startDate: z.string(),
    notes: z.string().max(4000),
    teamIds: z.array(z.string()),
  })
  .refine((v) => v.nameAr || v.nameEn, { message: 'required_one_language', path: ['nameAr'] });

export type ClientFormValues = z.infer<typeof schema>;

export function ClientForm({
  mode,
  clientId,
  defaults,
  people,
}: {
  /** `agency-create` / `agency-edit` show agency-managed fields; `portal` is the Client Owner's company profile. */
  mode: 'agency-create' | 'agency-edit' | 'portal';
  clientId?: string;
  defaults: ClientFormValues;
  people: { id: string; name: string; avatarPath: string | null; jobTitle: string | null }[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const form = useForm<ClientFormValues>({ resolver: zodResolver(schema), defaultValues: defaults });
  const create = useAction(createClientAction, { successMessage: t('clients.created'), refresh: false });
  const update = useAction(updateClientAction, { successMessage: t('common.saved') });
  const updateCompany = useAction(updateCompanyProfileAction, { successMessage: t('common.saved') });
  const agency = mode !== 'portal';

  const submit = form.handleSubmit(async (v) => {
    const base = {
      name: { ar: v.nameAr, en: v.nameEn },
      industry: (v.industry || null) as (typeof industries)[number] | null,
      city: (v.city || null) as (typeof cities)[number] | null,
      website: v.website,
      social: v.social,
      logoPath: v.logoPath,
    };
    if (mode === 'portal') {
      const res = await updateCompany.run(base);
      if (res.ok) form.reset(v);
      return;
    }
    const full = {
      ...base,
      status: v.status,
      accountManagerId: v.accountManagerId || null,
      startDate: v.startDate || null,
      notes: v.notes || undefined,
      teamIds: v.teamIds,
    };
    if (mode === 'agency-create') {
      const res = await create.run(full);
      if (res.ok) router.push(`/clients/${res.data.clientId}?created=1`);
    } else if (clientId) {
      const res = await update.run({ ...full, clientId });
      if (res.ok) router.push(`/clients/${clientId}`);
    }
  });

  return (
    <form onSubmit={submit} noValidate>
      <Card className="px-5">
        <FormSection title={t('clients.form.company')} description={t('clients.form.companyHint')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.nameAr')} error={form.formState.errors.nameAr?.message}>
              {(p) => <Input {...p} dir="rtl" lang="ar" {...form.register('nameAr')} data-testid="client-name-ar" />}
            </Field>
            <Field label={t('admin.nameEn')}>{(p) => <Input {...p} dir="ltr" lang="en" {...form.register('nameEn')} data-testid="client-name-en" />}</Field>
          </div>
          {clientId ? (
            <Controller
              control={form.control}
              name="logoPath"
              render={({ field }) => (
                <LogoUploader name={form.watch('nameEn') || form.watch('nameAr')} value={field.value} onChange={field.onChange} target="client" clientId={clientId} />
              )}
            />
          ) : (
            <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted-foreground">{t('clients.form.logoAfterCreate')}</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('clients.industry')}>
              {(p) => (
                <NativeSelect {...p} {...form.register('industry')}>
                  <option value="">{t('common.none')}</option>
                  {industries.map((i) => (
                    <option key={i} value={i}>
                      {t(`clients.industries.${i}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label={t('clients.city')}>
              {(p) => (
                <NativeSelect {...p} {...form.register('city')}>
                  <option value="">{t('common.none')}</option>
                  {cities.map((c) => (
                    <option key={c} value={c}>
                      {t(`clients.cities.${c}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
        </FormSection>

        <FormSection title={t('clients.form.online')} description={t('clients.form.onlineHint')}>
          <Field label={t('common.website')} optional>
            {(p) => (
              <div className="relative">
                <Globe className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
                <Input {...p} dir="ltr" className="ps-9" placeholder="example.sa" {...form.register('website')} />
              </div>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {socialNetworks.map((n) => (
              <Field key={n} label={t(`clients.social.${n}`)} optional>
                {(p) => (
                  <div className="relative">
                    <AtSign className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
                    <Input {...p} dir="ltr" className="ps-9" {...form.register(`social.${n}`)} />
                  </div>
                )}
              </Field>
            ))}
          </div>
        </FormSection>

        {agency ? (
          <>
            <FormSection title={t('clients.form.account')} description={t('clients.form.accountHint')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('common.status')}>
                  {(p) => (
                    <NativeSelect {...p} {...form.register('status')}>
                      {clientStatuses.map((s) => (
                        <option key={s} value={s}>
                          {t(`clients.statuses.${s}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field label={t('clients.startDate')} optional>
                  {(p) => <Input {...p} type="date" dir="ltr" {...form.register('startDate')} />}
                </Field>
              </div>
              <Field label={t('clients.accountManager')}>
                {(p) => (
                  <NativeSelect {...p} {...form.register('accountManagerId')} data-testid="client-am">
                    <option value="">{t('common.none')}</option>
                    {people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                        {person.jobTitle ? ` — ${person.jobTitle}` : ''}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Controller
                control={form.control}
                name="teamIds"
                render={({ field }) => (
                  <fieldset>
                    <legend className="mb-2 text-sm font-medium">{t('clients.team')}</legend>
                    <p className="mb-2 text-xs text-subtle-foreground">{t('clients.form.teamHint')}</p>
                    <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border border-border p-1 sm:grid-cols-2">
                      {people.map((person) => {
                        const checked = field.value.includes(person.id);
                        return (
                          <label key={person.id} className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-muted', checked && 'bg-primary-soft/50')}>
                            <Checkbox checked={checked} onCheckedChange={(v) => field.onChange(v ? [...field.value, person.id] : field.value.filter((x) => x !== person.id))} />
                            <Avatar name={person.name} src={publicAssetUrl(person.avatarPath)} size="xs" />
                            <span className="truncate text-sm">{person.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
              />
            </FormSection>
            <FormSection title={t('clients.notes')} description={t('clients.form.notesHint')}>
              <Field label={t('clients.notes')} optional>
                {(p) => <Textarea {...p} rows={4} {...form.register('notes')} />}
              </Field>
            </FormSection>
          </>
        ) : null}
      </Card>
      <div className="sticky bottom-0 z-10 mt-4 flex justify-end gap-2 bg-background/80 py-3 backdrop-blur">
        <Button type="button" variant="outline" onClick={() => (mode === 'portal' ? form.reset() : router.back())}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting} disabled={mode !== 'agency-create' && !form.formState.isDirty} data-testid="client-submit">
          {mode === 'agency-create' ? t('clients.create') : t('common.saveChanges')}
        </Button>
      </div>
    </form>
  );
}
