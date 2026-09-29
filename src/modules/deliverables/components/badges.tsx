'use client';

import type { LucideIcon } from 'lucide-react';
import {
  CheckCircle2,
  Clapperboard,
  FileText,
  Hourglass,
  Image as ImageIcon,
  PenLine,
  RotateCcw,
  ScanEye,
  Shapes,
  UserCheck,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/primitives';
import { clientState, type DeliverableStatus, type VersionStatus } from '@/modules/deliverables/constants';
import type { DeliverableType } from '@/modules/workflows/constants';

export const deliverableStatusTone: Record<DeliverableStatus, 'neutral' | 'info' | 'warning' | 'brand' | 'success' | 'accent'> = {
  in_progress: 'neutral',
  internal_review: 'info',
  internal_changes: 'warning',
  client_review: 'brand',
  client_changes: 'warning',
  approved: 'success',
};

const statusIcon: Record<DeliverableStatus, LucideIcon> = {
  in_progress: Hourglass,
  internal_review: ScanEye,
  internal_changes: RotateCcw,
  client_review: UserCheck,
  client_changes: RotateCcw,
  approved: CheckCircle2,
};

export const deliverableTypeIcon: Record<DeliverableType, LucideIcon> = {
  design: ImageIcon,
  video: Clapperboard,
  copy: PenLine,
  document: FileText,
  other: Shapes,
};

export function DeliverableStatusBadge({
  status,
  compact,
  className,
}: {
  status: DeliverableStatus;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations('deliverables');
  const Icon = statusIcon[status];
  return (
    <Badge tone={deliverableStatusTone[status]} className={className} data-testid="deliverable-status" data-status={status}>
      <Icon aria-hidden />
      {compact ? t(`statusShort.${status}`) : t(`statuses.${status}`)}
    </Badge>
  );
}

export function VersionStatusBadge({ status }: { status: VersionStatus }) {
  const t = useTranslations('deliverables');
  const tone = status === 'superseded' || status === 'draft' ? 'neutral' : deliverableStatusTone[status];
  return (
    <Badge tone={tone} data-testid="version-status" data-status={status}>
      {t(`versionStatuses.${status}`)}
    </Badge>
  );
}

/** The client's wording: awaiting your approval / in revision / approved. */
export function ClientDeliverableBadge({ status }: { status: DeliverableStatus }) {
  const t = useTranslations('deliverables');
  const state = clientState(status);
  const tone = state === 'awaiting' ? 'brand' : state === 'approved' ? 'success' : 'warning';
  const Icon = state === 'awaiting' ? UserCheck : state === 'approved' ? CheckCircle2 : RotateCcw;
  return (
    <Badge tone={tone} data-testid="client-deliverable-status" data-state={state}>
      <Icon aria-hidden />
      {t(`clientStates.${state}`)}
    </Badge>
  );
}
