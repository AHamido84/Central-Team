'use client';

import { CalendarClock, Handshake, Mail, MessageCircle, NotebookPen, Phone, SquareCheckBig, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge, Tooltip } from '@/components/ui/primitives';
import { cn } from '@/lib/utils/cn';
import {
  leadStatusTone,
  quoteStatusTone,
  type ActivityType,
  type DealStatus,
  type LeadStatus,
  type QuoteStatus,
} from '@/modules/crm/constants';

export const activityIcon: Record<ActivityType, LucideIcon> = {
  call: Phone,
  meeting: Handshake,
  email: Mail,
  whatsapp: MessageCircle,
  note: NotebookPen,
  task: SquareCheckBig,
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const t = useTranslations('crm.statuses');
  return (
    <Badge tone={leadStatusTone[status]} data-testid="lead-status" data-status={status}>
      {t(status)}
    </Badge>
  );
}

export function DealStatusBadge({ status }: { status: DealStatus }) {
  const t = useTranslations('crm.dealStatuses');
  return (
    <Badge tone={status === 'won' ? 'success' : status === 'lost' ? 'danger' : 'info'} data-testid="deal-status" data-status={status}>
      {t(status)}
    </Badge>
  );
}

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const t = useTranslations('crm.quoteStatuses');
  return <Badge tone={quoteStatusTone[status]}>{t(status)}</Badge>;
}

/** 0–100 as a small meter; colour follows the band so it's readable without the number. */
export function ScoreMeter({ score, className }: { score: number; className?: string }) {
  const t = useTranslations('crm.leads');
  const tone = score >= 70 ? 'bg-success' : score >= 40 ? 'bg-warning' : 'bg-subtle-foreground';
  return (
    <Tooltip content={t('scoreHint')}>
      <span className={cn('inline-flex items-center gap-1.5', className)} data-testid="lead-score" data-score={score}>
        <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
          <span className={cn('absolute inset-y-0 start-0 rounded-full', tone)} style={{ width: `${score}%` }} />
        </span>
        <span className="tabular text-xs text-muted-foreground">{score}</span>
      </span>
    </Tooltip>
  );
}

export function DueChip({ at, overdue }: { at: string; overdue: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', overdue ? 'font-medium text-danger' : 'text-muted-foreground')}>
      <CalendarClock className="size-3.5" aria-hidden />
      {at}
    </span>
  );
}
