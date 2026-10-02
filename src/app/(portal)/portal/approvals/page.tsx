import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requirePortal } from '@/lib/auth/context';
import { DeliverablesList } from '@/modules/deliverables/components/deliverables-list';
import { listDeliverables } from '@/modules/deliverables/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('approvals') };
}

/** Approvals center: everything the agency sent for approval — awaiting you, in revision, approved. */
export default async function PortalApprovalsPage() {
  const ctx = await requirePortal();
  if (!ctx.flags['module.approvals']) notFound();
  const t = await getTranslations('deliverables.portal');
  const deliverables = await listDeliverables({ clientId: ctx.client.id, clientVisibleOnly: true });
  return (
    <>
      <PageHeader title={t('title')} description={ctx.client.canApprove ? t('description') : t('descriptionViewer')} />
      <DeliverablesList deliverables={deliverables} side="client" />
    </>
  );
}
