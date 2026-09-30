import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PageHeader } from '@/components/patterns';
import { requireAgencyAny } from '@/lib/auth/context';
import { IntegrationsOverviewView } from '@/modules/integrations/components/integrations-overview';
import { getIntegrationsOverview } from '@/modules/integrations/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('integrations') };
}

export default async function IntegrationsPage() {
  const ctx = await requireAgencyAny(['integrations:read', 'integrations:manage']);
  if (!ctx.flags['module.integrations']) notFound();
  const [data, t] = await Promise.all([getIntegrationsOverview(), getTranslations('integrations')]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <Suspense>
        <IntegrationsOverviewView data={data} />
      </Suspense>
    </>
  );
}
