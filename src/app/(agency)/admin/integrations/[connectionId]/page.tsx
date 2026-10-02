import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { requireAgencyAny } from '@/lib/auth/context';
import { env } from '@/lib/env';
import { can } from '@/lib/permissions/can';
import { ConnectionDetailView } from '@/modules/integrations/components/connection-detail';
import { getConnectionDetail } from '@/modules/integrations/server/queries';

const uuid = /^[0-9a-f-]{36}$/;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('integrations') };
}

export default async function ConnectionPage({ params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  if (!uuid.test(connectionId)) notFound();
  const ctx = await requireAgencyAny(['integrations:read', 'integrations:manage']);
  if (!ctx.flags['module.integrations']) notFound();
  const data = await getConnectionDetail(connectionId);
  if (!data) notFound();
  const t = await getTranslations('integrations');
  return (
    <>
      <BreadcrumbLabel segment={connectionId} label={data.connection.name} />
      <PageHeader title={<bdi>{data.connection.name}</bdi>} description={t(`providers.${data.connection.provider}.name`)} />
      <ConnectionDetailView
        data={data}
        hooksBaseUrl={env().NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}
        canManage={can(ctx.permissions, 'integrations:manage')}
      />
    </>
  );
}
