import { AlarmClock, Briefcase, CalendarDays, ClipboardList, Clock, ListTodo, ScanEye } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { EmptyState, SectionTitle, StatCard } from '@/components/patterns';
import { Avatar, Card } from '@/components/ui/primitives';
import { localized } from '@/lib/i18n/localized';
import { getFormatters } from '@/lib/i18n/server-format';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import type { MemberTask, TeamMemberDetail } from '@/modules/operations/server/queries';
import { RequestStatusBadge } from '@/modules/requests/components/badges';
import { endOfWeek, taskReference } from '@/modules/tasks/constants';

const buckets = ['overdue', 'today', 'week', 'later', 'none'] as const;
type Bucket = (typeof buckets)[number];

function bucketOf(task: MemberTask, today: string, weekEnd: string): Bucket {
  if (!task.dueDate) return 'none';
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'today';
  if (task.dueDate <= weekEnd) return 'week';
  return 'later';
}

export async function TeamMemberView({ data }: { data: TeamMemberDetail }) {
  const t = await getTranslations();
  const f = await getFormatters();
  const weekEnd = endOfWeek(data.today);
  const grouped = buckets
    .map((b) => ({ bucket: b, tasks: data.tasks.filter((x) => bucketOf(x, data.today, weekEnd) === b) }))
    .filter((g) => g.tasks.length);
  const maxMinutes = Math.max(60, ...(data.days ?? []).map((d) => d.minutes));
  const totalMinutes = (data.days ?? []).reduce((n, d) => n + d.minutes, 0);
  const hours = (m: number) => f.number(m / 60, { maximumFractionDigits: 1 });

  return (
    <div className="space-y-6" data-testid="team-member">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('operations.team.openTasks')} value={f.number(data.openTasks)} icon={ListTodo} />
        <StatCard
          label={t('operations.team.overdue')}
          value={f.number(data.overdue)}
          icon={AlarmClock}
          className={data.overdue ? 'border-danger/40' : undefined}
        />
        <StatCard label={t('operations.team.week')} value={f.number(data.dueThisWeek)} icon={CalendarDays} />
        <StatCard label={t('operations.team.reviews')} value={f.number(data.reviews)} icon={ScanEye} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0">
          <SectionTitle title={t('operations.team.detail.tasks')} />
          <Card className="overflow-hidden">
            {grouped.length === 0 ? (
              <EmptyState
                compact
                icon={ListTodo}
                title={t('operations.team.detail.noTasks')}
                description={t('operations.team.detail.noTasksBody')}
              />
            ) : (
              grouped.map((g) => (
                <div key={g.bucket} data-testid={`member-bucket-${g.bucket}`}>
                  <p
                    className={cn(
                      'border-b border-border bg-surface-muted px-4 py-2 text-xs font-medium',
                      g.bucket === 'overdue' ? 'text-danger' : 'text-muted-foreground',
                    )}
                  >
                    {t(`operations.team.detail.buckets.${g.bucket}`)} · {f.number(g.tasks.length)}
                  </p>
                  <ul className="divide-y divide-border">
                    {g.tasks.map((task) => (
                      <li key={task.id}>
                        <Link href={`/tasks?task=${task.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              <bdi>{task.title}</bdi>
                            </p>
                            <p className="truncate text-xs text-subtle-foreground">
                              <span dir="ltr">{taskReference(task.number)}</span> · {localized(task.clientName, f.locale)}
                            </p>
                          </div>
                          {task.dueDate ? (
                            <span className="tabular shrink-0 text-xs text-muted-foreground">
                              {f.date(`${task.dueDate}T12:00:00`, 'short')}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </Card>
        </section>

        <aside className="min-w-0 space-y-6">
          {data.days ? (
            <section>
              <SectionTitle title={t('operations.team.detail.time')} />
              <Card className="p-4" data-testid="member-time">
                {totalMinutes === 0 ? (
                  <EmptyState compact icon={Clock} title={t('operations.team.detail.noTime')} />
                ) : (
                  <>
                    <p className="mb-3 text-sm font-medium">{t('operations.team.detail.totalHours', { hours: hours(totalMinutes) })}</p>
                    {/* One series, so plain bars: height = hours that day; weekends are dimmed. */}
                    <ol className="flex h-28 items-end gap-1" aria-label={t('operations.team.detail.time')}>
                      {data.days.map((d) => {
                        const dow = new Date(`${d.day}T12:00:00Z`).getUTCDay();
                        const label = `${f.date(`${d.day}T12:00:00`, 'short')}: ${t('operations.team.hoursValue', { hours: hours(d.minutes) })}`;
                        return (
                          <li key={d.day} className="flex h-full flex-1 flex-col justify-end" title={label}>
                            <span className="sr-only">{label}</span>
                            <span
                              className={cn('block w-full rounded-t-sm', dow === 5 || dow === 6 ? 'bg-primary/40' : 'bg-primary')}
                              style={{ height: `${Math.max(d.minutes ? 4 : 1, (d.minutes / maxMinutes) * 100)}%` }}
                              aria-hidden
                            />
                          </li>
                        );
                      })}
                    </ol>
                    <div className="mt-1 flex justify-between text-[0.625rem] text-subtle-foreground">
                      <span>{f.dayMonth(`${data.days[0]!.day}T12:00:00`)}</span>
                      <span>{f.dayMonth(`${data.days.at(-1)!.day}T12:00:00`)}</span>
                    </div>
                  </>
                )}
              </Card>
            </section>
          ) : null}

          <section>
            <SectionTitle title={t('operations.team.detail.requests')} />
            <Card className="divide-y divide-border">
              {data.requests.length === 0 ? (
                <EmptyState compact icon={ClipboardList} title={t('operations.team.detail.noRequests')} />
              ) : (
                data.requests.map((r) => (
                  <Link key={r.id} href={`/requests/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        <bdi>{r.title}</bdi>
                      </p>
                      <p className="truncate text-xs text-subtle-foreground">
                        <span dir="ltr">{r.reference}</span> · {localized(r.clientName, f.locale)}
                      </p>
                    </div>
                    <RequestStatusBadge status={r.status} />
                  </Link>
                ))
              )}
            </Card>
          </section>

          <section>
            <SectionTitle title={t('operations.team.detail.clients')} />
            <Card className="divide-y divide-border">
              {data.managedClients.length === 0 ? (
                <EmptyState compact icon={Briefcase} title={t('operations.team.detail.noClients')} />
              ) : (
                data.managedClients.map((c) => (
                  <Link key={c.id} href={`/clients/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted">
                    <Avatar name={localized(c.name, f.locale)} src={publicAssetUrl(c.logoPath)} size="sm" square />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{localized(c.name, f.locale)}</span>
                  </Link>
                ))
              )}
            </Card>
          </section>
        </aside>
      </div>
      <p className="text-xs text-subtle-foreground">{t('operations.team.scopeNote')}</p>
    </div>
  );
}
