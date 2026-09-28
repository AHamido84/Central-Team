import type { LucideIcon } from 'lucide-react';
import {
  ArrowDownRight,
  ArrowUpRight,
  File,
  FileArchive,
  FileImage,
  FileText,
  FileVideo,
  Minus,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Card } from '@/components/ui/primitives';
import { cn } from '@/lib/utils/cn';

/* -------------------------------------------------------------------------- */
/* DirIcon — mirrors directional icons in RTL (CLAUDE.md §7)                   */
/* -------------------------------------------------------------------------- */

export function DirIcon({ icon: Icon, className, ...props }: { icon: LucideIcon } & ComponentProps<'svg'>) {
  return <Icon className={cn('rtl:-scale-x-100', className)} aria-hidden {...props} />;
}

/* -------------------------------------------------------------------------- */
/* PageHeader                                                                 */
/* -------------------------------------------------------------------------- */

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header className={cn('flex flex-col gap-4 pb-6', className)}>
      {eyebrow}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-h2 font-semibold tracking-tight text-balance sm:text-h1">{title}</h1>
          {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* EmptyState / ErrorState                                                    */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground',
          compact ? 'size-10' : 'size-12',
        )}
      >
        <Icon className={compact ? 'size-5' : 'size-6'} aria-hidden />
      </div>
      <div className="max-w-sm">
        <p className="font-semibold">{title}</p>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action || secondaryAction ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* StatCard                                                                   */
/* -------------------------------------------------------------------------- */

export function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  icon: Icon,
  footer,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: number;
  deltaLabel?: ReactNode;
  icon?: LucideIcon;
  footer?: ReactNode;
  className?: string;
}) {
  const trend = delta === undefined ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;
  return (
    <Card className={cn('flex flex-col gap-3 p-5', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        {Icon ? (
          <span className="flex size-8 items-center justify-center rounded-md bg-surface-muted text-muted-foreground">
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="tabular text-h1 font-semibold tracking-tight">{value}</span>
        {trend ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium',
              trend === 'up' && 'bg-success-soft text-success',
              trend === 'down' && 'bg-danger-soft text-danger',
              trend === 'flat' && 'bg-surface-muted text-muted-foreground',
            )}
          >
            <DirIcon icon={TrendIcon} className="size-3.5" />
            {deltaLabel}
          </span>
        ) : null}
      </div>
      {footer ? <div className="text-xs text-subtle-foreground">{footer}</div> : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* File type icon                                                             */
/* -------------------------------------------------------------------------- */

export type FileKind = 'image' | 'video' | 'pdf' | 'document' | 'archive' | 'other';

const fileKindIcon: Record<FileKind, LucideIcon> = {
  image: FileImage,
  video: FileVideo,
  pdf: FileText,
  document: FileText,
  archive: FileArchive,
  other: File,
};

const fileKindTone: Record<FileKind, string> = {
  image: 'bg-info-soft text-info',
  video: 'bg-danger-soft text-danger',
  pdf: 'bg-warning-soft text-warning',
  document: 'bg-primary-soft text-primary-soft-foreground',
  archive: 'bg-accent text-accent-foreground',
  other: 'bg-surface-muted text-muted-foreground',
};

export function FileTypeIcon({ kind, className }: { kind: FileKind; className?: string }) {
  const Icon = fileKindIcon[kind];
  return (
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-md', fileKindTone[kind], className)}>
      <Icon className="size-5" aria-hidden />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Section title used inside pages                                            */
/* -------------------------------------------------------------------------- */

export function SectionTitle({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-2', className)}>
      <h2 className="text-[0.9375rem] font-semibold">{title}</h2>
      {action}
    </div>
  );
}

/** Bidi-isolated inline content (emails, phone numbers, URLs) inside mixed-direction text. */
export function Bdi({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}
