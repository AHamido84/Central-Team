import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { WhatsAppPanel } from '@/modules/integrations/components/whatsapp-panel';
import { getWhatsAppPanel } from '@/modules/integrations/server/queries';
import { DealDetailView } from '@/modules/crm/components/deal-detail';
import { dealReference } from '@/modules/crm/constants';
import { getCrmOptions, getDeal } from '@/modules/crm/server/queries';

const uuid = /^[0-9a-f-]{36}$/;

export async function generateMetadata({ params }: { params: Promise<{ dealId: string }> }): Promise<Metadata> {
  const { dealId } = await params;
  const t = await getTranslations('nav');
  return { title: uuid.test(dealId) ? t('deals') : undefined };
}

export default async function DealPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!uuid.test(dealId)) notFound();
  const ctx = await requireAgency('deals:read');
  if (!ctx.flags['module.crm']) notFound();
  const [deal, options] = await Promise.all([getDeal(ctx, dealId), getCrmOptions(ctx)]);
  if (!deal) notFound();
  // WhatsApp (Phase 7): senders see the panel; the history follows the lead / deal read rules.
  const whatsapp =
    ctx.flags['module.integrations'] && can(ctx.permissions, 'whatsapp:send') ? await getWhatsAppPanel({ dealId: dealId }) : null;
  const pipeline = options.pipelines.find((p) => p.id === deal.pipelineId);
  if (!pipeline) notFound();
  return (
    <div className="space-y-6">
      <BreadcrumbLabel segment={dealId} label={deal.title} />
      <PageHeader
        title={<bdi>{deal.title}</bdi>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span dir="ltr">{dealReference(deal.number)}</span>
            {deal.company ? <bdi>{deal.company}</bdi> : null}
          </span>
        }
      />
      <DealDetailView
        deal={deal}
        pipeline={pipeline}
        options={options}
        canManageAll={can(ctx.permissions, 'crm:manage_all')}
        canConvert={can(ctx.permissions, 'clients:create')}
      />
      {whatsapp ? <WhatsAppPanel subject={{ dealId: dealId }} data={whatsapp} canSend /> : null}
    </div>
  );
}
