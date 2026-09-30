import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { CampaignInsights } from '@/modules/ai/components/campaign-insights';
import { listInsights } from '@/modules/ai/server/queries';
import { CampaignWorkspace } from '@/modules/campaigns/components/campaign-workspace';
import { getCampaign, listCampaignOptions } from '@/modules/campaigns/server/queries';
import { listAgencyPeople, listClients } from '@/modules/clients/server/queries';
import { listDeliverables } from '@/modules/deliverables/server/queries';
import { dayInZone } from '@/modules/tasks/constants';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata({ params }: { params: Promise<{ campaignId: string }> }): Promise<Metadata> {
  const { campaignId } = await params;
  const c = isUuid(campaignId) ? await getCampaign(campaignId) : null;
  return { title: c?.name };
}

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { campaignId } = await params;
  const { tab } = await searchParams;
  if (!isUuid(campaignId)) notFound();
  const ctx = await requireAgency('campaigns:read');
  if (!ctx.flags['module.campaigns']) notFound();
  const campaign = await getCampaign(campaignId);
  if (!campaign) notFound();
  const [clients, people, campaignOptions, clientDeliverables, insights] = await Promise.all([
    listClients(ctx),
    listAgencyPeople(ctx),
    listCampaignOptions(campaign.clientId),
    ctx.flags['module.tasks'] ? listDeliverables({ clientId: campaign.clientId }) : Promise.resolve([]),
    ctx.flags['module.ai'] ? listInsights({ campaignId: campaign.id, status: 'all' }) : Promise.resolve(null),
  ]);
  // Live insights first; resolved and dismissed ones stay visible below them for context.
  const activeInsights = insights?.filter((i) => i.status === 'open' || i.status === 'acknowledged').length ?? 0;
  return (
    <>
      <BreadcrumbLabel segment={campaignId} label={campaign.name} />
      <CampaignWorkspace
        campaign={campaign}
        initialTab={tab}
        can={{
          manage: can(ctx.permissions, 'campaigns:manage'),
          metrics: can(ctx.permissions, 'metrics:manage'),
          reports: can(ctx.permissions, 'reports:manage'),
        }}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        people={people.map((p) => ({ id: p.id, name: p.name }))}
        campaignOptions={campaignOptions}
        linkable={clientDeliverables.filter((d) => d.campaignId === null)}
        today={dayInZone(new Date(), ctx.organization.defaultTimezone)}
        insights={
          insights
            ? { panel: <CampaignInsights items={insights.slice(0, 30)} campaignId={campaign.id} />, count: activeInsights }
            : undefined
        }
      />
    </>
  );
}
