import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { FormsAdmin } from '@/modules/requests/components/forms-admin';
import { listForms } from '@/modules/requests/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('requestForms') };
}

export default async function RequestFormsPage() {
  const ctx = await requireAgency('request_forms:manage');
  if (!ctx.flags['module.requests']) notFound();
  const t = await getTranslations('requests.forms');
  const forms = await listForms();
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <FormsAdmin forms={forms} />
    </>
  );
}
