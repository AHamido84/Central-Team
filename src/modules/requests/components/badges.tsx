'use client';

import type { LucideIcon } from 'lucide-react';
import {
  AlarmClock,
  ArrowDown,
  ArrowUp,
  Calendar,
  Camera,
  CheckCircle2,
  Clapperboard,
  ClipboardList,
  Flame,
  Image,
  Megaphone,
  Minus,
  Palette,
  PenLine,
  Repeat,
  Sparkles,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useFormat } from '@/components/providers';
import { Badge, Tooltip } from '@/components/ui/primitives';
import { cn } from '@/lib/utils/cn';
import {
  requestPriorityTone,
  requestStatusTone,
  slaState,
  slaTone,
  type FormIcon as FormIconKey,
  type RequestPriority,
  type RequestStatus,
} from '@/modules/requests/constants';

const formIconMap: Record<FormIconKey, LucideIcon> = {
  'clipboard-list': ClipboardList,
  image: Image,
  clapperboard: Clapperboard,
  'pen-line': PenLine,
  megaphone: Megaphone,
  camera: Camera,
  palette: Palette,
  sparkles: Sparkles,
  calendar: Calendar,
  repeat: Repeat,
};

export function formIconComponent(icon: FormIconKey): LucideIcon {
  return formIconMap[icon] ?? ClipboardList;
}

export function FormIcon({ icon, className, size = 'md' }: { icon: FormIconKey; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = formIconMap[icon] ?? ClipboardList;
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground',
        size === 'sm' ? 'size-8' : size === 'lg' ? 'size-12' : 'size-10',
        className,
      )}
    >
      <Icon className={size === 'lg' ? 'size-6' : size === 'sm' ? 'size-4' : 'size-5'} aria-hidden />
    </span>
  );
}

export function RequestStatusBadge({ status, className }: { status: RequestStatus; className?: string }) {
  const t = useTranslations('requests');
  return (
    <Badge tone={requestStatusTone[status]} dot className={className} data-testid="request-status" data-status={status}>
      {t(`statuses.${status}`)}
    </Badge>
  );
}

const priorityIcon: Record<RequestPriority, LucideIcon> = { low: ArrowDown, normal: Minus, high: ArrowUp, urgent: Flame };

export function PriorityBadge({ priority, className }: { priority: RequestPriority; className?: string }) {
  const t = useTranslations('requests');
  const Icon = priorityIcon[priority];
  return (
    <Badge tone={requestPriorityTone[priority]} className={className} data-testid="request-priority" data-priority={priority}>
      <Icon aria-hidden />
      {t(`priorities.${priority}`)}
    </Badge>
  );
}

type SlaInput = Parameters<typeof slaState>[0];

/** Next SLA milestone (first response, then resolution) with a tone for on track / at risk / breached. */
export function SlaBadge({ request, className }: { request: SlaInput; className?: string }) {
  const t = useTranslations('requests');
  const f = useFormat();
  const sla = slaState(request);
  if (sla.state === 'none' || !sla.dueAt || !sla.milestone) return <span className="text-subtle-foreground">—</span>;
  const Icon = sla.state === 'met' ? CheckCircle2 : AlarmClock;
  const label =
    sla.state === 'met'
      ? t('sla.met')
      : sla.state === 'breached'
        ? t('sla.overdue', { when: f.relative(sla.dueAt) })
        : t('sla.due', { when: f.relative(sla.dueAt) });
  return (
    <Tooltip content={`${t(`sla.${sla.milestone}`)} · ${f.dateTime(sla.dueAt)}`}>
      <Badge tone={slaTone[sla.state]} className={className} data-testid="request-sla" data-sla={sla.state}>
        <Icon aria-hidden />
        {label}
      </Badge>
    </Tooltip>
  );
}
