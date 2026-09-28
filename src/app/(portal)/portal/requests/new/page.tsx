import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requirePortal } from '@/lib/auth/context';
import { FormPicker } from '@/modules/requests/components/portal-requests';
import { listPublishedForms } from '@/modules/requests/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('requests');
  return { title: t('newRequest') };
}

export default async function NewRequestPage() {
  const ctx = await requirePortal('portal_requests:create');
  if (!ctx.flags['module.requests']) notFound();
  const t = await getTranslations('requests');
  const forms = await listPublishedForms();
  return (
    <>
      <PageHeader title={t('newRequest')} description={t('chooseForm')} />
      <FormPicker forms={forms} />
    </>
  );
}
