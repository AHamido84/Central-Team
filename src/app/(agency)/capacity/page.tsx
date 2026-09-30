import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { CapacityPlanner } from '@/modules/capacity/components/capacity-planner';
import { getCapacity } from '@/modules/capacity/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('capacity') };
}

export default async function CapacityPage() {
  const ctx = await requireAgency('capacity:read');
  if (!ctx.flags['module.crm']) notFound();
  const [data, t] = await Promise.all([getCapacity(ctx), getTranslations('capacity')]);
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <CapacityPlanner data={data} />
    </div>
  );
}
