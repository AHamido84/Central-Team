'use client';

import { FileChartColumn, Megaphone } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { useFormat } from '@/components/providers';
import { EmptyState, SectionTitle } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { CampaignStatusBadge, HealthBadge, PlatformList } from '@/modules/campaigns/components/badges';
import { CampaignFlight } from '@/modules/campaigns/components/campaign-list';
import { PacingMeter } from '@/modules/campaigns/components/charts';
import { useMetricFormat } from '@/modules/campaigns/components/format';
import type { CampaignSummary, ReportSummary } from '@/modules/campaigns/server/queries';

const toneOf = { on_track: 'success', at_risk: 'warning', off_track: 'danger', no_data: 'neutral' } as const;

export function PortalCampaignCard({ c }: { c: CampaignSummary }) {
  const t = useTranslations('campaigns');
  const { value } = useMetricFormat(c.currency);
  const k = c.headline;
  return (
    <Link
      href={`/portal/campaigns/${c.id}`}
      className="block rounded-lg border border-border bg-surface p-4 shadow-sm transition-colors hover:bg-surface-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      data-testid="portal-campaign"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-medium">{c.name}</p>
        <HealthBadge health={c.health} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <CampaignStatusBadge status={c.status} />
        <CampaignFlight start={c.startDate} end={c.endDate} />
        <PlatformList platforms={c.platforms} />
      </div>
      {k ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{t(`metric.${k.metric}`)}</span>
            <span className="tabular font-medium">
              {value(k.metric, k.actual, { compact: true })}
              <span className="text-subtle-foreground"> / {value(k.metric, k.target, { compact: true })}</span>
            </span>
          </div>
          <PacingMeter
            value={k.actual === null ? 0 : k.projected !== null ? k.actual / k.target : Math.min(1, k.ratio ?? 0)}
            expected={k.projected !== null ? c.analysis.elapsed : null}
            tone={toneOf[k.status]}
            label={t(`metric.${k.metric}`)}
          />
        </div>
      ) : null}
    </Link>
  );
}

/** Portal home block: the latest published report and the campaigns running now. */
export function PortalCampaignsSummary({ campaigns, latest }: { campaigns: CampaignSummary[]; latest: ReportSummary | null }) {
  const t = useTranslations('campaigns');
  const tc = useTranslations('common');
  const f = useFormat();
  const running = campaigns.filter((c) => c.status === 'active' || c.status === 'paused');
  return (
    <section data-testid="home-campaigns">
      <SectionTitle
        title={t('portal.title')}
        action={
          <Button asChild variant="link" size="sm">
            <Link href="/portal/campaigns">{tc('viewAll')}</Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-3">
        {latest ? (
          <Link
            href={`/portal/reports/${latest.id}`}
            className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm hover:bg-surface-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            data-testid="home-latest-report"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground">
              <FileChartColumn className="size-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-xs text-subtle-foreground">{t('portal.latestReport')}</span>
              <span className="block truncate text-sm font-medium" dir="auto">
                {latest.title}
              </span>
              {latest.publishedAt ? <span className="block text-xs text-subtle-foreground">{f.date(latest.publishedAt)}</span> : null}
            </span>
          </Link>
        ) : null}
        {running.length ? (
          running.slice(0, 3).map((c) => <PortalCampaignCard key={c.id} c={c} />)
        ) : !latest ? (
          <Card>
            <EmptyState compact icon={Megaphone} title={t('portal.empty')} description={t('portal.emptyBody')} />
          </Card>
        ) : null}
      </div>
    </section>
  );
}
