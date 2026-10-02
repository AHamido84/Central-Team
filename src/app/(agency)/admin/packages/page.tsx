import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { PackagesAdmin } from '@/modules/clients/components/packages-admin';
import { listPackages } from '@/modules/clients/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('packages') };
}

export default async function PackagesPage() {
  const ctx = await requireAgency('packages:manage');
  const t = await getTranslations('clients.packages');
  const packages = await listPackages(ctx);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <PackagesAdmin packages={packages} canDelete={can(ctx.permissions, 'packages:delete')} />
    </>
  );
}
