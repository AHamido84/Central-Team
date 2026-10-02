import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requirePortal } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { PortalRequestsList } from '@/modules/requests/components/portal-requests';
import { listRequests } from '@/modules/requests/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('requests') };
}

export default async function PortalRequestsPage() {
  const ctx = await requirePortal();
  if (!ctx.flags['module.requests']) notFound();
  const t = await getTranslations('requests');
  const requests = await listRequests({ clientId: ctx.client.id });
  return (
    <>
      <PageHeader title={t('portalTitle')} description={t('portalDescription')} />
      <PortalRequestsList requests={requests} canCreate={can(ctx.permissions, 'portal_requests:create')} />
    </>
  );
}
