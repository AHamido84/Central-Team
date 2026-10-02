'use client';

import { Megaphone } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { EmptyState, SectionTitle } from '@/components/patterns';
import { Card } from '@/components/ui/primitives';
import { PortalCampaignCard } from '@/modules/campaigns/components/portal-campaigns';
import type { CampaignSummary } from '@/modules/campaigns/server/queries';

export function PortalCampaignList({ campaigns }: { campaigns: CampaignSummary[] }) {
  const t = useTranslations('campaigns');
  const running = campaigns.filter((c) => c.status !== 'completed');
  const past = campaigns.filter((c) => c.status === 'completed');
  if (campaigns.length === 0) {
    return (
      <Card>
        <EmptyState icon={Megaphone} title={t('portal.empty')} description={t('portal.emptyBody')} />
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-8" data-testid="portal-campaigns">
      {running.length ? (
        <section>
          <SectionTitle title={t('portal.active')} />
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {running.map((c) => (
              <li key={c.id}>
                <PortalCampaignCard c={c} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {past.length ? (
        <section>
          <SectionTitle title={t('portal.past')} />
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {past.map((c) => (
              <li key={c.id}>
                <PortalCampaignCard c={c} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
