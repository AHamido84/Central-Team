import { ClipboardList } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { EmptyState, PageHeader } from '@/components/patterns';
import { Card } from '@/components/ui/primitives';
import { requirePortal } from '@/lib/auth/context';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('requests') };
}

/** Designed-in route for an upcoming phase. Hidden (404) until the `module.requests` flag is enabled. */
export default async function PortalRequestsPage() {
  const ctx = await requirePortal();
  if (!ctx.flags['module.requests']) notFound();
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t('nav.requests')} description={t('portal.upcoming.requests.description')} />
      <Card>
        <EmptyState icon={ClipboardList} title={t('portal.upcoming.requests.title')} description={t('portal.upcoming.requests.body')} />
      </Card>
    </>
  );
}
