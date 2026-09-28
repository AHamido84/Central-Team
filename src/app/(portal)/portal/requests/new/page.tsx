import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { EmptyState, PageHeader } from '@/components/patterns';
import { Card } from '@/components/ui/primitives';
import { requirePortal } from '@/lib/auth/context';
import { ClipboardList } from 'lucide-react';
import { RequestWizard } from '@/modules/requests/components/request-wizard';
import { getQuotas, listRequestTypes } from '@/modules/requests/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('requests');
  return { title: t('newRequest') };
}

export default async function NewRequestPage() {
  const ctx = await requirePortal('portal_requests:create');
  if (!ctx.flags['module.requests']) notFound();
  const t = await getTranslations('requests');
  const types = await listRequestTypes({ activeOnly: true });
  const quotas = await getQuotas(ctx.client.id, types.map((x) => x.packageItemType).filter(Boolean) as string[]);
  return (
    <>
      <PageHeader title={t('newRequest')} description={t('wizard.description')} />
      {types.length ? (
        <RequestWizard types={types} quotas={quotas} clientId={ctx.client.id} />
      ) : (
        <Card>
          <EmptyState icon={ClipboardList} title={t('noTypesTitle')} description={t('noTypesBody')} />
        </Card>
      )}
    </>
  );
}
