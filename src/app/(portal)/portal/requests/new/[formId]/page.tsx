import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requirePortal } from '@/lib/auth/context';
import { localized, type Locale } from '@/lib/i18n/localized';
import { NewRequestForm } from '@/modules/requests/components/new-request-form';
import { getPublishedForm } from '@/modules/requests/server/queries';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('requests');
  return { title: t('newRequest') };
}

export default async function NewRequestFormPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  if (!isUuid(formId)) notFound();
  const ctx = await requirePortal('portal_requests:create');
  if (!ctx.flags['module.requests']) notFound();
  const form = await getPublishedForm(formId);
  if (!form) notFound();
  const t = await getTranslations('requests');
  const locale = (await getLocale()) as Locale;
  return (
    <>
      <PageHeader title={localized(form.name, locale)} description={t('newRequestDescription')} />
      <NewRequestForm form={form} clientId={ctx.client.id} basePath="/portal/requests" />
    </>
  );
}
