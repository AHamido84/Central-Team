'use client';

import { ImageIcon, Printer } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useFormat } from '@/components/providers';
import { EmptyState, PageHeader, SectionTitle } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { CampaignStatusBadge, HealthBadge, PlatformList } from '@/modules/campaigns/components/badges';
import { CampaignFlight } from '@/modules/campaigns/components/campaign-list';
import { CampaignOverview } from '@/modules/campaigns/components/campaign-overview';
import { CreativeGrid } from '@/modules/campaigns/components/campaign-workspace';
import { ReportList } from '@/modules/campaigns/components/report-list';
import type { CampaignDetail } from '@/modules/campaigns/server/queries';

export function PortalCampaignDetail({ campaign }: { campaign: CampaignDetail }) {
  const t = useTranslations('campaigns');
  const f = useFormat();
  return (
    <div className="flex flex-col gap-6" data-testid="portal-campaign-detail">
      <PageHeader
        title={campaign.name}
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <CampaignStatusBadge status={campaign.status} />
            <HealthBadge health={campaign.health} />
          </div>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t(`objective.${campaign.objective}`)}</span>
            <CampaignFlight start={campaign.startDate} end={campaign.endDate} />
            <span>{`${t('fields.budget')}: ${f.currency(campaign.budgetMinor, campaign.currency)}`}</span>
            <PlatformList platforms={campaign.platforms} />
          </span>
        }
      />
      {campaign.description ? <p className="-mt-4 max-w-3xl text-sm text-muted-foreground">{campaign.description}</p> : null}
      <CampaignOverview
        analysis={campaign.analysis}
        channels={campaign.channels}
        rows={campaign.rows}
        startDate={campaign.startDate}
        endDate={campaign.endDate}
        currency={campaign.currency}
      />
      <section>
        <SectionTitle title={t('creatives.title')} />
        {campaign.deliverables.length ? (
          <CreativeGrid items={campaign.deliverables} hrefBase="/portal/approvals" />
        ) : (
          <Card>
            <EmptyState compact icon={ImageIcon} title={t('creatives.emptyPortal')} />
          </Card>
        )}
      </section>
      <section>
        <SectionTitle title={t('portal.reports')} />
        <ReportList
          reports={campaign.reports}
          hrefBase="/portal/reports"
          showClient={false}
          showStatus={false}
          emptyLabel={t('portal.noReports')}
        />
      </section>
    </div>
  );
}

export function PrintButton() {
  const t = useTranslations('reports');
  return (
    <Button variant="outline" onClick={() => window.print()} className="print:hidden" data-testid="report-print">
      <Printer aria-hidden />
      {t('builder.print')}
    </Button>
  );
}
