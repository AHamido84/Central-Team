import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { DataManagement } from '@/modules/data/components/data-management';
import { getDataManagement } from '@/modules/data/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('dataManagement') };
}

export default async function DataManagementPage() {
  const ctx = await requireAgency();
  if (!ctx.isSuperAdmin) forbidden();
  const t = await getTranslations('data.reset');
  const data = await getDataManagement();
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <DataManagement lockedAt={data.lockedAt} jobs={data.jobs} />
    </>
  );
}
