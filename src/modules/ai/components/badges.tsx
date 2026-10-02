'use client';

import { AlertOctagon, AlertTriangle, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/primitives';
import type { InsightSeverity, InsightStatus } from '@/modules/ai/insights-core';

const severityTone = { info: 'info', warning: 'warning', critical: 'danger' } as const;
const severityIcon = { info: Info, warning: AlertTriangle, critical: AlertOctagon } as const;

export function SeverityBadge({ severity }: { severity: InsightSeverity }) {
  const t = useTranslations('ai');
  const Icon = severityIcon[severity];
  return (
    <Badge tone={severityTone[severity]} data-testid="insight-severity" data-severity={severity}>
      <Icon aria-hidden />
      {t(`severity.${severity}`)}
    </Badge>
  );
}

const statusTone = { open: 'brand', acknowledged: 'neutral', dismissed: 'outline', resolved: 'success' } as const;

export function InsightStatusBadge({ status }: { status: InsightStatus }) {
  const t = useTranslations('ai');
  return (
    <Badge tone={statusTone[status]} dot data-testid="insight-status" data-status={status}>
      {t(`status.${status}`)}
    </Badge>
  );
}
