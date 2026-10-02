'use client';

import type { LucideIcon } from 'lucide-react';
import { AlarmClock, CalendarClock, CheckCircle2, Circle, CircleDashed, CircleDot, Eye, OctagonPause, RotateCcw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { useFormat } from '@/components/providers';
import { Badge } from '@/components/ui/primitives';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import { taskReference, type StatusCategory, type StatusColor } from '@/modules/tasks/constants';

export type StatusOption = { id: string; name: LocalizedText; category: StatusCategory; color: StatusColor };

export const statusTone: Record<StatusColor, 'neutral' | 'info' | 'brand' | 'accent' | 'warning' | 'danger' | 'success'> = {
  neutral: 'neutral',
  info: 'info',
  primary: 'brand',
  accent: 'accent',
  warning: 'warning',
  danger: 'danger',
  success: 'success',
};

/** Dot colors for board column headers (tokens, never raw colors). */
export const statusDot: Record<StatusColor, string> = {
  neutral: 'bg-subtle-foreground',
  info: 'bg-info',
  primary: 'bg-primary',
  accent: 'bg-accent-foreground',
  warning: 'bg-warning',
  danger: 'bg-danger',
  success: 'bg-success',
};

export const categoryIcon: Record<StatusCategory, LucideIcon> = {
  todo: Circle,
  active: CircleDot,
  review: Eye,
  changes: RotateCcw,
  blocked: OctagonPause,
  done: CheckCircle2,
};

export function TaskStatusBadge({ status, className }: { status: StatusOption | undefined; className?: string }) {
  const locale = useLocale() as Locale;
  if (!status) return null;
  const Icon = categoryIcon[status.category] ?? CircleDashed;
  return (
    <Badge tone={statusTone[status.color]} className={className} data-testid="task-status" data-category={status.category}>
      <Icon aria-hidden />
      {localized(status.name, locale)}
    </Badge>
  );
}

/** Due date with overdue / today emphasis (text + icon, never color alone). */
export function DueDate({ date, done, today, className }: { date: string | null; done: boolean; today: string; className?: string }) {
  const t = useTranslations('tasks');
  const f = useFormat();
  if (!date) return null;
  const overdue = !done && date < today;
  const isToday = !done && date === today;
  const Icon = overdue ? AlarmClock : CalendarClock;
  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-1 text-xs',
        overdue ? 'font-medium text-danger' : isToday ? 'font-medium text-warning' : 'text-muted-foreground',
        className,
      )}
      data-testid="task-due"
      data-overdue={overdue || undefined}
    >
      <Icon className="size-3.5" aria-hidden />
      {overdue
        ? t('due.overdue', { date: f.date(`${date}T12:00:00`, 'short') })
        : isToday
          ? t('due.today')
          : f.date(`${date}T12:00:00`, 'short')}
    </span>
  );
}

export function TaskRef({ number, className }: { number: number; className?: string }) {
  return (
    <span dir="ltr" className={cn('tabular font-mono text-[0.6875rem] text-subtle-foreground', className)}>
      {taskReference(number)}
    </span>
  );
}

/** "2h 30m" / "45m" / "3h" in the viewer's language. */
export function useDuration() {
  const t = useTranslations('tasks.time');
  const f = useFormat();
  return (total: number) => {
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h && m) return t('hm', { h: f.number(h), m: f.number(m) });
    if (h) return t('hOnly', { h: f.number(h) });
    return t('mOnly', { m: f.number(m) });
  };
}
