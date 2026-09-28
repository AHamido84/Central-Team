import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requirePortal } from '@/lib/auth/context';
import { RequestWizard } from '@/modules/requests/components/request-wizard';
import { clientEditableStatuses, type RequestPriority } from '@/modules/requests/constants';
import { getQuotas, getRequest, listRequestTypes } from '@/modules/requests/server/queries';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('requests');
  return { title: t('editRequest') };
}

/** Continue a draft, or update the brief when the agency asked for more information. */
export default async function EditRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  if (!isUuid(requestId)) notFound();
  const ctx = await requirePortal('portal_requests:create');
  if (!ctx.flags['module.requests']) notFound();
  const request = await getRequest(requestId);
  if (!request || request.clientId !== ctx.client.id) notFound();
  if (!clientEditableStatuses.includes(request.status)) redirect(`/portal/requests/${requestId}`);
  const t = await getTranslations('requests');
  const active = await listRequestTypes({ activeOnly: true });
  // A request in Needs info stays editable even if its type was deactivated since: rebuild it from the request.
  const types =
    active.some((x) => x.id === request.typeId) || request.status === 'draft'
      ? active
      : [
          ...active,
          {
            id: request.typeId,
            key: '',
            name: request.typeName,
            description: {},
            icon: request.typeIcon,
            category: 'other' as const,
            defaultPriority: request.priority,
            slaDays: null,
            packageItemType: request.packageItemType,
            isActive: false,
            fields: request.fields,
            schemaVersion: request.schemaVersion,
            requestCount: 0,
            updatedAt: request.lastActivityAt,
          },
        ];
  const quotas = await getQuotas(ctx.client.id, types.map((x) => x.packageItemType).filter(Boolean) as string[], request.id);
  const toKnown = (a: (typeof request.attachments)[number]) => ({ id: a.id, name: a.name, mimeType: a.mimeType, sizeBytes: a.sizeBytes });
  const needsInfo = request.status === 'needs_info';
  return (
    <>
      <PageHeader
        title={needsInfo ? t('needsInfo.title', { reference: request.reference ?? '' }) : t('continueDraft')}
        description={needsInfo ? t('needsInfo.description') : t('wizard.description')}
      />
      <RequestWizard
        types={types}
        quotas={quotas}
        clientId={ctx.client.id}
        mode={needsInfo ? 'needs_info' : 'draft'}
        initial={{
          requestId: request.id,
          typeId: request.typeId,
          title: request.title,
          brief: request.brief,
          referenceLinks: request.referenceLinks,
          desiredDate: request.desiredDate,
          priority: request.priority as RequestPriority,
          attachments: request.attachments.filter((a) => !a.fieldId).map(toKnown),
          briefFiles: request.attachments.filter((a) => a.fieldId).map(toKnown),
          fields: needsInfo ? request.fields : undefined,
          reason: request.needsInfoReason,
        }}
      />
    </>
  );
}
