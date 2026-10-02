import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { SlaAdmin } from '@/modules/sla/components/sla-admin';
import { getSlaAdmin } from '@/modules/sla/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('slaPolicies') };
}

export default async function SlaAdminPage() {
  const ctx = await requireAgency('sla:manage');
  if (!ctx.flags['module.requests']) notFound();
  const t = await getTranslations('sla.admin');
  const data = await getSlaAdmin(ctx);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <SlaAdmin data={data} />
    </>
  );
}
