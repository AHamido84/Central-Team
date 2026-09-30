import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { LeadDetailView } from '@/modules/crm/components/lead-detail';
import { leadReference } from '@/modules/crm/constants';
import { getCrmOptions, getLead } from '@/modules/crm/server/queries';

const uuid = /^[0-9a-f-]{36}$/;

export async function generateMetadata({ params }: { params: Promise<{ leadId: string }> }): Promise<Metadata> {
  const { leadId } = await params;
  const t = await getTranslations('nav');
  return { title: uuid.test(leadId) ? t('leads') : undefined };
}

export default async function LeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  if (!uuid.test(leadId)) notFound();
  const ctx = await requireAgency('leads:read');
  if (!ctx.flags['module.crm']) notFound();
  const [lead, options] = await Promise.all([getLead(ctx, leadId), getCrmOptions(ctx)]);
  if (!lead) notFound();
  const t = await getTranslations('crm');
  return (
    <div className="space-y-6">
      <BreadcrumbLabel segment={leadId} label={lead.fullName} />
      <PageHeader
        title={<bdi>{lead.fullName}</bdi>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span dir="ltr">{leadReference(lead.number)}</span>
            {lead.company ? <bdi>{lead.company}</bdi> : null}
            <span>{t(`sources.${lead.source}`)}</span>
          </span>
        }
      />
      <LeadDetailView
        lead={lead}
        options={options}
        me={ctx.session.userId}
        canManageAll={can(ctx.permissions, 'crm:manage_all')}
        canCreateDeal={can(ctx.permissions, 'deals:manage') && lead.canWrite}
      />
    </div>
  );
}
