import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { requirePortal } from '@/lib/auth/context';
import { DeliverableReview } from '@/modules/deliverables/components/deliverable-review';
import { getDeliverable } from '@/modules/deliverables/server/queries';
import { getQuotas } from '@/modules/requests/server/queries';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata({ params }: { params: Promise<{ deliverableId: string }> }): Promise<Metadata> {
  const { deliverableId } = await params;
  const d = isUuid(deliverableId) ? await getDeliverable(deliverableId) : null;
  return { title: d?.title };
}

/** Mobile-first review: preview, zoom, annotate, approve / request changes, version history. RLS shows only what was sent. */
export default async function PortalDeliverablePage({ params }: { params: Promise<{ deliverableId: string }> }) {
  const { deliverableId } = await params;
  if (!isUuid(deliverableId)) notFound();
  const ctx = await requirePortal();
  if (!ctx.flags['module.approvals']) notFound();
  const deliverable = await getDeliverable(deliverableId);
  if (!deliverable || deliverable.clientId !== ctx.client.id) notFound();
  const quotas = await getQuotas(ctx.client.id, ['revision_round']);
  const q = quotas.revision_round;
  return (
    <>
      <BreadcrumbLabel segment={deliverableId} label={deliverable.title} />
      <DeliverableReview
        initial={deliverable}
        side="client"
        perms={{ canManage: false, canReview: false, canApprove: ctx.client.canApprove }}
        quota={q ? { allowed: q.allowed, used: q.used, hasPackage: q.hasPackage } : null}
        backHref="/portal/approvals"
      />
    </>
  );
}
