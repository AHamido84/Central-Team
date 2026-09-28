import { CheckCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { EmptyState, PageHeader } from '@/components/patterns';
import { Card } from '@/components/ui/primitives';
import { requirePortal } from '@/lib/auth/context';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('approvals') };
}

/** Designed-in route for an upcoming phase. Hidden (404) until the `module.approvals` flag is enabled. */
export default async function PortalApprovalsPage() {
  const ctx = await requirePortal();
  if (!ctx.flags['module.approvals']) notFound();
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t('nav.approvals')} description={t('portal.upcoming.approvals.description')} />
      <Card>
        <EmptyState icon={CheckCheck} title={t('portal.upcoming.approvals.title')} description={t('portal.upcoming.approvals.body')} />
      </Card>
    </>
  );
}
