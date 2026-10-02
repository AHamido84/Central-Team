import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { PageHeader } from '@/components/patterns';
import { requireAgencyAny } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { IntegrationsOverviewView } from '@/modules/integrations/components/integrations-overview';
import { PeopleConnections } from '@/modules/integrations/components/my-connections';
import { getIntegrationsOverview, listConnectionOwners, listPersonalConnections } from '@/modules/integrations/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('integrations') };
}

export default async function IntegrationsPage() {
  const ctx = await requireAgencyAny(['integrations:read', 'integrations:manage']);
  if (!ctx.flags['module.integrations']) notFound();
  const canManage = can(ctx.permissions, 'integrations:manage');
  const [data, t, personal, team] = await Promise.all([
    getIntegrationsOverview(),
    getTranslations('integrations'),
    listPersonalConnections('all', ctx.session.userId),
    canManage ? listConnectionOwners(ctx.organization.id) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <Suspense>
        <IntegrationsOverviewView data={data} />
      </Suspense>
      <PeopleConnections connections={personal} canManage={canManage} members={team} />
    </>
  );
}
