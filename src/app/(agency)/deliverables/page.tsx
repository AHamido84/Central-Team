import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { DeliverablesList } from '@/modules/deliverables/components/deliverables-list';
import { listDeliverables } from '@/modules/deliverables/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('deliverables') };
}

export default async function DeliverablesPage() {
  const ctx = await requireAgency('tasks:read');
  if (!ctx.flags['module.tasks']) notFound();
  const t = await getTranslations('deliverables');
  const deliverables = await listDeliverables();
  return (
    <>
      <PageHeader title={t('agencyTitle')} description={t('agencyDescription')} />
      <DeliverablesList deliverables={deliverables} side="agency" />
    </>
  );
}
