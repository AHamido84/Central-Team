'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';

import { DirIcon } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

/** Sunday-first month grid (YYYY-MM-DD cells) for the task and content calendars. */
export function monthGrid(month: string): string[] {
  const first = new Date(`${month}-01T12:00:00Z`);
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

export function shiftMonth(month: string, delta: number): string {
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
}

/**
 * A month calendar. Items are placed by day; on phones the grid becomes an agenda list of the days that have items.
 */
export function MonthCalendar<T extends { id: string }>({
  items,
  dayOf,
  renderItem,
  today,
  initialMonth,
  maxPerDay = 3,
  testId = 'calendar',
  aside,
}: {
  items: T[];
  dayOf: (item: T) => string | null;
  renderItem: (item: T) => ReactNode;
  today: string;
  initialMonth?: string;
  maxPerDay?: number;
  testId?: string;
  aside?: ReactNode;
}) {
  const t = useTranslations('tasks.calendar');
  const f = useFormat();
  const [month, setMonth] = useState(initialMonth ?? today.slice(0, 7));
  const [expanded, setExpanded] = useState<string | null>(null);
  const days = monthGrid(month);
  const byDay = useMemo(() => {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const d = dayOf(item);
      if (d) map.set(d, [...(map.get(d) ?? []), item]);
    }
    return map;
  }, [items, dayOf]);
  const inMonth = (d: string) => d.startsWith(month);
  const agenda = days.filter((d) => inMonth(d) && byDay.has(d));

  return (
    <div className="grid gap-4" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="me-auto text-lg font-semibold" data-testid="calendar-month">
          {f.monthYear(`${month}-15T12:00:00`)}
        </h2>
        <Button variant="outline" size="sm" onClick={() => setMonth(today.slice(0, 7))}>
          {t('today')}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setMonth(shiftMonth(month, -1))}
          aria-label={t('previous')}
          data-testid="calendar-prev"
        >
          <DirIcon icon={ChevronLeft} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setMonth(shiftMonth(month, 1))}
          aria-label={t('next')}
          data-testid="calendar-next"
        >
          <DirIcon icon={ChevronRight} />
        </Button>
      </div>
      <div className={cn('grid gap-4', aside && 'xl:grid-cols-[minmax(0,1fr)_18rem]')}>
        <div className="hidden overflow-hidden rounded-xl border border-border bg-surface md:block">
          <div className="grid grid-cols-7 border-b border-border bg-surface-muted/60 text-xs font-medium text-muted-foreground">
            {days.slice(0, 7).map((d) => (
              <div key={d} className="px-2 py-2">
                {f.weekday(`${d}T12:00:00`)}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const list = byDay.get(d) ?? [];
              const open = expanded === d;
              const shown = open ? list : list.slice(0, maxPerDay);
              return (
                <div
                  key={d}
                  className={cn(
                    'min-h-28 border-e border-b border-border p-1.5 [&:nth-child(7n)]:border-e-0',
                    !inMonth(d) && 'bg-surface-muted/40 text-subtle-foreground',
                  )}
                  data-testid="calendar-day"
                  data-day={d}
                >
                  <span
                    className={cn(
                      'tabular mb-1 inline-flex size-6 items-center justify-center rounded-full text-xs',
                      d === today && 'bg-primary font-semibold text-primary-foreground',
                    )}
                  >
                    {f.number(Number(d.slice(8)))}
                  </span>
                  <div className="grid gap-1">
                    {shown.map((item) => (
                      <div key={item.id}>{renderItem(item)}</div>
                    ))}
                  </div>
                  {list.length > maxPerDay ? (
                    <button type="button" className="mt-1 text-xs text-link hover:underline" onClick={() => setExpanded(open ? null : d)}>
                      {open ? t('less') : t('more', { count: list.length - maxPerDay })}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <ol className="grid gap-3 md:hidden" data-testid="calendar-agenda">
          {agenda.length === 0 ? (
            <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-subtle-foreground">
              {t('emptyMonth')}
            </li>
          ) : null}
          {agenda.map((d) => (
            <li key={d} className="rounded-xl border border-border bg-surface p-3">
              <p className={cn('mb-2 text-sm font-semibold', d === today && 'text-primary')}>{f.date(`${d}T12:00:00`, 'long')}</p>
              <div className="grid gap-1.5">
                {byDay.get(d)!.map((item) => (
                  <div key={item.id}>{renderItem(item)}</div>
                ))}
              </div>
            </li>
          ))}
        </ol>
        {aside}
      </div>
    </div>
  );
}
