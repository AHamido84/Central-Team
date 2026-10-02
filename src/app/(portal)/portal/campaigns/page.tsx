import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader, SectionTitle } from '@/components/patterns';
import { requirePortal } from '@/lib/auth/context';
import { PortalCampaignList } from '@/modules/campaigns/components/portal-campaign-list';
import { ReportList } from '@/modules/campaigns/components/report-list';
import { listCampaigns, listReports } from '@/modules/campaigns/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('portalCampaigns') };
}

export default async function PortalCampaignsPage() {
  const ctx = await requirePortal();
  if (!ctx.flags['module.campaigns']) notFound();
  const t = await getTranslations('campaigns');
  // RLS already limits these to the client's client-visible campaigns and published reports.
  const [campaigns, reports] = await Promise.all([
    listCampaigns({ clientId: ctx.client.id }),
    listReports({ clientId: ctx.client.id, status: 'published' }),
  ]);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t('portal.title')} description={t('portal.description')} className="pb-0" />
      <PortalCampaignList campaigns={campaigns} />
      <section>
        <SectionTitle title={t('portal.reports')} />
        <ReportList reports={reports} hrefBase="/portal/reports" showClient={false} showStatus={false} emptyLabel={t('portal.noReports')} />
      </section>
    </div>
  );
}
