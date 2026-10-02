import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { DeliverableReview } from '@/modules/deliverables/components/deliverable-review';
import { getDeliverable } from '@/modules/deliverables/server/queries';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata({ params }: { params: Promise<{ deliverableId: string }> }): Promise<Metadata> {
  const { deliverableId } = await params;
  const d = isUuid(deliverableId) ? await getDeliverable(deliverableId) : null;
  return { title: d?.title };
}

export default async function DeliverablePage({ params }: { params: Promise<{ deliverableId: string }> }) {
  const { deliverableId } = await params;
  if (!isUuid(deliverableId)) notFound();
  const ctx = await requireAgency('tasks:read');
  if (!ctx.flags['module.tasks']) notFound();
  const deliverable = await getDeliverable(deliverableId);
  if (!deliverable) notFound();
  return (
    <>
      <BreadcrumbLabel segment={deliverableId} label={deliverable.title} />
      <DeliverableReview
        initial={deliverable}
        side="agency"
        perms={{
          canManage: can(ctx.permissions, 'deliverables:manage'),
          canReview: can(ctx.permissions, 'deliverables:review'),
          canApprove: false,
          canDelete: can(ctx.permissions, 'deliverables:delete'),
        }}
        quota={null}
      />
    </>
  );
}
