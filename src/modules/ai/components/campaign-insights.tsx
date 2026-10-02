'use client';

import { Lightbulb } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { InsightRows } from '@/modules/ai/components/insight-list';
import type { InsightListItem } from '@/modules/ai/server/queries';

/** The campaign workspace's Insights tab (Phase 8). */
export function CampaignInsights({ items, campaignId }: { items: InsightListItem[]; campaignId: string }) {
  const t = useTranslations('ai.insights');
  return (
    <div className="flex flex-col gap-3" data-testid="campaign-insights">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/insights?status=all&campaignId=${campaignId}`}>{t('viewAll')}</Link>
        </Button>
      </div>
      <Card>
        {items.length === 0 ? (
          <EmptyState compact icon={Lightbulb} title={t('campaignEmpty')} description={t('emptyHint')} />
        ) : (
          <InsightRows items={items} showCampaign={false} />
        )}
      </Card>
    </div>
  );
}
