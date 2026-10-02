'use client';

import Link from 'next/link';

import { cn } from '@/lib/utils/cn';
import { deliverableTypeIcon } from '@/modules/deliverables/components/badges';
import type { DeliverableSummary } from '@/modules/deliverables/server/queries';
import { MonthCalendar } from '@/modules/tasks/components/task-calendar';

type Item = DeliverableSummary & { day: string };

/** The client's content calendar: approved or scheduled deliverables on their publishing date. */
export function ContentCalendar({ items, today }: { items: Item[]; today: string }) {
  return (
    <MonthCalendar
      items={items}
      dayOf={(d) => d.day}
      today={today}
      testId="content-calendar"
      renderItem={(d) => {
        const Icon = deliverableTypeIcon[d.type];
        return (
          <Link
            href={`/portal/approvals/${d.id}`}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-xs hover:bg-surface-muted',
              d.status === 'approved' ? 'border-success/40 bg-success-soft/40' : 'border-border bg-surface',
            )}
            data-testid="calendar-deliverable"
          >
            {d.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
              <img src={d.thumbUrl} alt="" className="size-6 shrink-0 rounded object-cover" />
            ) : (
              <Icon className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate">
              <bdi>{d.title}</bdi>
            </span>
          </Link>
        );
      }}
    />
  );
}
