'use client';

import { CircleCheck, CircleDashed, CircleX, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils/cn';
import type { CampaignHealth, CampaignStatus, Platform } from '@/modules/campaigns/constants';
import type { PacingStatus } from '@/modules/campaigns/metrics';

const healthTone = { on_track: 'success', at_risk: 'warning', off_track: 'danger', no_data: 'neutral' } as const;
const healthIcon: Record<PacingStatus, LucideIcon> = {
  on_track: CircleCheck,
  at_risk: TriangleAlert,
  off_track: CircleX,
  no_data: CircleDashed,
};

/** Status colours always come with an icon and a label (never colour alone). */
export function HealthBadge({ health, className }: { health: CampaignHealth | PacingStatus; className?: string }) {
  const t = useTranslations('campaigns.health');
  const Icon = healthIcon[health];
  return (
    <Badge tone={healthTone[health]} className={className} data-testid="health-badge" data-health={health}>
      <Icon aria-hidden />
      {t(health)}
    </Badge>
  );
}

const statusTone = {
  draft: 'outline',
  planned: 'info',
  active: 'brand',
  paused: 'warning',
  completed: 'neutral',
  archived: 'neutral',
} as const;

export function CampaignStatusBadge({ status, className }: { status: CampaignStatus; className?: string }) {
  const t = useTranslations('campaigns.status');
  return (
    <Badge tone={statusTone[status]} dot className={className} data-testid="campaign-status" data-status={status}>
      {t(status)}
    </Badge>
  );
}

/** Two-letter platform mark (brand logos are trademarks; a neutral mark + the name is enough). */
const platformMark: Record<Platform, string> = {
  meta: 'Me',
  instagram: 'Ig',
  facebook: 'Fb',
  tiktok: 'Tk',
  snapchat: 'Sc',
  google: 'G',
  youtube: 'Yt',
  x: 'X',
  linkedin: 'In',
  other: '•',
};

export function PlatformMark({ platform, className }: { platform: Platform; className?: string }) {
  return (
    <span
      aria-hidden
      dir="ltr"
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-[0.625rem] font-semibold text-muted-foreground',
        className,
      )}
    >
      {platformMark[platform]}
    </span>
  );
}

export function PlatformList({ platforms, className }: { platforms: Platform[]; className?: string }) {
  const t = useTranslations('campaigns.platform');
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)} aria-label={platforms.map((p) => t(p)).join('، ')}>
      {platforms.map((p) => (
        <PlatformMark key={p} platform={p} />
      ))}
    </span>
  );
}

/** Categorical chart slot for the n-th series (fixed order, never cycled — ADR-050). */
export const seriesColor = (index: number) => `var(--chart-${Math.min(index, 7) + 1})`;
