'use client';

import {
  FileUp,
  MessageSquare,
  AtSign,
  UserCheck,
  ShieldCheck,
  Bell,
  ClipboardList,
  UserRoundPlus,
  RefreshCw,
  MessageCircleQuestion,
  AlarmClock,
  CalendarClock,
  CheckCheck,
  ListTodo,
  PenLine,
  ScanEye,
  Unlock,
  BellRing,
  Rocket,
  Timer,
  Siren,
  TriangleAlert,
  ChartNoAxesColumn,
  FileChartColumn,
  FilePen,
  Hourglass,
  Trophy,
  UserPlus,
  PlugZap,
  RefreshCwOff,
  Workflow,
  MessageCircleX,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { useFormat } from '@/components/providers';
import { Avatar } from '@/components/ui/primitives';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import type { NotificationItem, NotificationType } from '@/modules/notifications/types';

const typeIcon: Record<NotificationType, typeof Bell> = {
  invitation_accepted: UserCheck,
  roles_changed: ShieldCheck,
  message_new: MessageSquare,
  mention: AtSign,
  file_shared: FileUp,
  file_uploaded_by_client: FileUp,
  request_submitted: ClipboardList,
  request_assigned: UserRoundPlus,
  request_status_changed: RefreshCw,
  request_needs_info: MessageCircleQuestion,
  task_assigned: ListTodo,
  task_due_soon: CalendarClock,
  task_overdue: AlarmClock,
  task_unblocked: Unlock,
  task_review_requested: ScanEye,
  review_requested: ScanEye,
  deliverable_approved: CheckCheck,
  deliverable_changes_requested: PenLine,
  approval_requested: CheckCheck,
  approval_reminder: BellRing,
  campaign_started: Rocket,
  campaign_at_risk: TriangleAlert,
  campaign_metrics_stale: ChartNoAxesColumn,
  report_published: FileChartColumn,
  report_ready: FilePen,
  sla_at_risk: Timer,
  sla_breached: Siren,
  lead_assigned: UserPlus,
  crm_followup_due: CalendarClock,
  deal_stale: Hourglass,
  deal_won: Trophy,
  integration_expired: PlugZap,
  integration_sync_failed: RefreshCwOff,
  automation_failed: Workflow,
  whatsapp_failed: MessageCircleX,
  automation_message: Zap,
};

export function NotificationRow({
  item,
  onOpen,
  compact,
}: {
  item: NotificationItem;
  onOpen?: (item: NotificationItem) => void;
  compact?: boolean;
}) {
  const t = useTranslations('notifications');
  const f = useFormat();
  const Icon = typeIcon[item.type] ?? Bell;
  const title = t.has(`types.${item.type}.title`) ? t(`types.${item.type}.title`, item.params as never) : item.type;
  const body = t.has(`types.${item.type}.body`) ? t(`types.${item.type}.body`, item.params as never) : '';
  const content = (
    <div className={cn('flex gap-3', compact ? 'px-3 py-2.5' : 'px-4 py-3.5')}>
      <div className="relative">
        {item.actor ? (
          <Avatar name={item.actor.name} src={publicAssetUrl(item.actor.avatarPath)} size="sm" />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
            <Icon className="size-4" aria-hidden />
          </span>
        )}
        {item.actor ? (
          <span className="absolute -end-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-surface text-primary ring-2 ring-surface">
            <Icon className="size-3" aria-hidden />
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', item.readAt ? 'text-muted-foreground' : 'font-medium text-foreground')}>{title}</p>
        {body ? <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{body}</p> : null}
        <p className="mt-1 text-xs text-subtle-foreground">{f.relative(item.createdAt)}</p>
      </div>
      {!item.readAt ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label={t('unread')} /> : null}
    </div>
  );
  return item.link ? (
    <Link
      href={item.link}
      onClick={() => onOpen?.(item)}
      className="block transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
      data-testid="notification-item"
    >
      {content}
    </Link>
  ) : (
    <button
      type="button"
      onClick={() => onOpen?.(item)}
      className="block w-full text-start hover:bg-surface-muted"
      data-testid="notification-item"
    >
      {content}
    </button>
  );
}
