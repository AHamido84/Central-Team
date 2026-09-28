import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { TypesAdmin } from '@/modules/requests/components/types-admin';
import { listRequestTypes } from '@/modules/requests/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('requestTypes') };
}

export default async function RequestTypesPage() {
  const ctx = await requireAgency('request_types:manage');
  if (!ctx.flags['module.requests']) notFound();
  const t = await getTranslations('requests.types');
  const types = await listRequestTypes();
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <TypesAdmin types={types} />
    </>
  );
}
