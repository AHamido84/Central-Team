'use client';

import { HeartPulse, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge, Tooltip } from '@/components/ui/primitives';
import { clientHealthTone, type ClientHealth, type ClientSignals, type HealthReason } from '@/modules/operations/health';

const icon = { healthy: ShieldCheck, watch: HeartPulse, at_risk: ShieldAlert } as const;

/** Client health chip; the tooltip lists what costs the most. */
export function ClientHealthBadge({
  health,
  score,
  reasons,
  signals,
  className,
}: {
  health: ClientHealth;
  score: number;
  reasons: HealthReason[];
  signals?: ClientSignals;
  className?: string;
}) {
  const t = useTranslations('operations.health');
  const Icon = icon[health];
  const badge = (
    <Badge tone={clientHealthTone[health]} className={className} data-testid="client-health" data-health={health}>
      <Icon aria-hidden />
      {t(`levels.${health}`)}
    </Badge>
  );
  if (!signals || reasons.length === 0) return badge;
  return (
    <Tooltip
      content={
        <span className="grid gap-0.5 text-start">
          <span className="font-medium">{t('score', { score })}</span>
          {reasons.slice(0, 3).map((r) => (
            <span key={r}>{t(`reasons.${r}`, { count: signals[r] })}</span>
          ))}
        </span>
      }
    >
      {badge}
    </Tooltip>
  );
}

export function HealthReasons({ reasons, signals }: { reasons: HealthReason[]; signals: ClientSignals }) {
  const t = useTranslations('operations.health');
  if (reasons.length === 0) return <p className="text-sm text-muted-foreground">{t('allGood')}</p>;
  return (
    <ul className="grid gap-1 text-sm" data-testid="health-reasons">
      {reasons.map((r) => (
        <li key={r} className="flex items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full bg-current opacity-60" aria-hidden />
          {t(`reasons.${r}`, { count: signals[r] })}
        </li>
      ))}
    </ul>
  );
}
