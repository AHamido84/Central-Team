import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { requireAgency } from '@/lib/auth/context';
import { localized, type Locale } from '@/lib/i18n/localized';
import { FormBuilder } from '@/modules/requests/components/form-builder';
import { getFormForBuilder } from '@/modules/requests/server/queries';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata({ params }: { params: Promise<{ formId: string }> }): Promise<Metadata> {
  const { formId } = await params;
  const data = isUuid(formId) ? await getFormForBuilder(formId) : null;
  return { title: data ? localized(data.form.name, (await getLocale()) as Locale) : undefined };
}

export default async function RequestFormBuilderPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  if (!isUuid(formId)) notFound();
  const ctx = await requireAgency('request_forms:manage');
  if (!ctx.flags['module.requests']) notFound();
  const data = await getFormForBuilder(formId);
  if (!data) notFound();
  const t = await getTranslations('requests.builder');
  const name = localized(data.form.name, (await getLocale()) as Locale);
  return (
    <>
      <BreadcrumbLabel segment={formId} label={name} />
      <PageHeader title={name} description={t('description')} />
      {/* Remount after publish/discard so the editor starts from the saved state. */}
      <FormBuilder key={`${data.draftVersionId ?? 'published'}-${data.form.currentVersion ?? 0}`} data={data} />
    </>
  );
}
