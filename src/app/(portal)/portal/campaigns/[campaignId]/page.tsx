import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { requirePortal } from '@/lib/auth/context';
import { PortalCampaignDetail } from '@/modules/campaigns/components/portal-campaign-detail';
import { getCampaign } from '@/modules/campaigns/server/queries';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata({ params }: { params: Promise<{ campaignId: string }> }): Promise<Metadata> {
  const { campaignId } = await params;
  const c = isUuid(campaignId) ? await getCampaign(campaignId, 'client') : null;
  return { title: c?.name };
}

export default async function PortalCampaignPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  if (!isUuid(campaignId)) notFound();
  const ctx = await requirePortal();
  if (!ctx.flags['module.campaigns']) notFound();
  const campaign = await getCampaign(campaignId, 'client');
  // RLS returns nothing for drafts, internal campaigns and other clients' campaigns.
  if (!campaign || campaign.clientId !== ctx.client.id) notFound();
  return <PortalCampaignDetail campaign={campaign} />;
}
