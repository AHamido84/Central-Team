'use client';

import { CalendarCheck } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Card, Checkbox } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { cn } from '@/lib/utils/cn';
import { activityIcon } from '@/modules/crm/components/badges';
import { followUpBuckets, type FollowUpBucket } from '@/modules/crm/constants';
import { completeActivityAction } from '@/modules/crm/server/actions';
import type { FollowUp } from '@/modules/crm/server/queries';
import { dayInZone } from '@/modules/tasks/constants';

export function bucketOf(dueAt: string, today: string, timeZone: string, now: number): FollowUpBucket {
  const day = dayInZone(new Date(dueAt), timeZone);
  if (day < today || (day === today && Date.parse(dueAt) < now)) return 'overdue';
  return day === today ? 'today' : 'upcoming';
}

export function FollowUpList({
  items,
  today,
  timeZone,
  now,
  showOwner,
}: {
  items: FollowUp[];
  today: string;
  timeZone: string;
  now: string;
  showOwner: boolean;
}) {
  const t = useTranslations('crm');
  const f = useFormat();
  const complete = useAction(completeActivityAction);
  if (!items.length) return <EmptyState icon={CalendarCheck} title={t('followUps.empty')} description={t('followUps.emptyBody')} />;
  const nowMs = Date.parse(now);
  const grouped = Object.fromEntries(followUpBuckets.map((b) => [b, [] as FollowUp[]])) as Record<FollowUpBucket, FollowUp[]>;
  for (const i of items) grouped[bucketOf(i.dueAt!, today, timeZone, nowMs)].push(i);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {followUpBuckets.map((b) => (
        <section key={b} className="min-w-0" data-testid={`followups-${b}`}>
          <h2
            className={cn('mb-2 flex items-center gap-2 text-sm font-semibold', b === 'overdue' && grouped[b].length ? 'text-danger' : '')}
          >
            {t(`followUps.buckets.${b}`)}
            <span className="tabular rounded-full bg-surface-muted px-2 text-xs text-muted-foreground">{f.number(grouped[b].length)}</span>
          </h2>
          <Card className="divide-y divide-border">
            {grouped[b].length === 0 ? (
              <p className="px-4 py-3 text-sm text-subtle-foreground">{t('followUps.allClear')}</p>
            ) : (
              grouped[b].map((a) => {
                const Icon = activityIcon[a.type];
                return (
                  <div key={a.id} className="flex items-start gap-3 px-3 py-3" data-testid="followup-item">
                    <Checkbox
                      className="mt-1"
                      aria-label={t('activities.complete')}
                      disabled={complete.pending}
                      onCheckedChange={() => complete.run({ activityId: a.id, done: true })}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <bdi className="truncate">{a.subject}</bdi>
                      </p>
                      <Link href={a.href} className="block truncate text-xs text-primary hover:underline">
                        <span dir="ltr">{a.parentRef}</span> · <bdi>{a.parentTitle}</bdi>
                      </Link>
                      <p className={cn('text-xs', b === 'overdue' ? 'font-medium text-danger' : 'text-subtle-foreground')}>
                        {b === 'upcoming' ? f.dateTime(a.dueAt!) : f.time(a.dueAt!)}
                        {b === 'overdue' && dayInZone(new Date(a.dueAt!), timeZone) !== today ? ` · ${f.date(a.dueAt!)}` : ''}
                        {showOwner && a.owner ? ` · ${a.owner.name}` : ''}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </Card>
        </section>
      ))}
    </div>
  );
}
