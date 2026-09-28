'use client';

import type { LucideIcon } from 'lucide-react';
import {
  AlarmClock,
  ArrowDown,
  ArrowUp,
  Camera,
  CheckCircle2,
  Clapperboard,
  ClipboardList,
  Flame,
  GalleryHorizontal,
  Globe,
  Image,
  Megaphone,
  Minus,
  Palette,
  PenLine,
  Smartphone,
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
  type RequestPriority,
  type RequestStatus,
  type TypeIcon as TypeIconKey,
} from '@/modules/requests/constants';

export const typeIconMap: Record<TypeIconKey, LucideIcon> = {
  image: Image,
  'gallery-horizontal': GalleryHorizontal,
  clapperboard: Clapperboard,
  smartphone: Smartphone,
  megaphone: Megaphone,
  camera: Camera,
  globe: Globe,
  palette: Palette,
  'pen-line': PenLine,
  'clipboard-list': ClipboardList,
};

export function TypeIcon({ icon, className, size = 'md' }: { icon: TypeIconKey; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const Icon = typeIconMap[icon] ?? ClipboardList;
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

/** On track / at risk / overdue against the due date (from the type's SLA days, agency-editable). */
export function SlaBadge({ request, className }: { request: SlaInput; className?: string }) {
  const t = useTranslations('requests');
  const f = useFormat();
  const state = slaState(request);
  if (state === 'none' || !request.dueDate) return <span className="text-subtle-foreground">—</span>;
  const Icon = state === 'met' ? CheckCircle2 : AlarmClock;
  return (
    <Tooltip content={t('sla.dueOn', { date: f.date(`${request.dueDate}T12:00:00`, 'long') })}>
      <Badge tone={slaTone[state]} className={className} data-testid="request-sla" data-sla={state}>
        <Icon aria-hidden />
        {t(`sla.states.${state}`)}
      </Badge>
    </Tooltip>
  );
}

export function ExtraBadge() {
  const t = useTranslations('requests');
  return (
    <Badge tone="accent" data-testid="request-extra">
      {t('extra')}
    </Badge>
  );
}
