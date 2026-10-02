import {
  CalendarClock,
  CheckCheck,
  ClipboardList,
  FileChartColumn,
  Hourglass,
  ListTodo,
  Megaphone,
  MessagesSquare,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { EmptyState, SectionTitle, StatCard } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Badge, Card, Progress } from '@/components/ui/primitives';
import { getFormatters } from '@/lib/i18n/server-format';
import { ClientHealthBadge, HealthReasons } from '@/modules/operations/components/health';
import type { ActivityItem, Client360 } from '@/modules/operations/server/queries';
import { PriorityBadge } from '@/modules/requests/components/badges';
import type { RequestStatus } from '@/modules/requests/constants';
import { IssueRow } from '@/modules/sla/components/sla-monitor';

const activityIcon: Record<ActivityItem['kind'], typeof ClipboardList> = {
  request_status: ClipboardList,
  approval: CheckCheck,
  report: FileChartColumn,
  message: MessagesSquare,
};

/** Top of the client page's overview tab: health, key numbers, SLA, deadlines and one activity stream. */
export async function Client360View({ data, canSla }: { data: Client360; canSla: boolean }) {
  const t = await getTranslations();
  const f = await getFormatters();
  const o = data.ops;
  const rate = (r: number | null) => (r === null ? t('operations.client360.noData') : f.percent(r));
  const activityLine = (a: ActivityItem) => {
    switch (a.kind) {
      case 'request_status':
        return t('operations.client360.activityKinds.request_status', { status: t(`requests.statuses.${a.detail as RequestStatus}`) });
      case 'approval':
        return t('operations.client360.activityKinds.approval', { decision: a.detail ?? 'approved' });
      case 'report':
        return t('operations.client360.activityKinds.report');
      case 'message':
        return t('operations.client360.activityKinds.message', { side: a.detail ?? 'agency' });
    }
  };

  return (
    <div className="space-y-6" data-testid="client-360">
      <Card className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{t('operations.health.title')}</p>
            <ClientHealthBadge health={o.health} score={o.score} reasons={o.reasons} />
            <span className="tabular text-xs text-subtle-foreground">{t('operations.health.score', { score: o.score })}</span>
          </div>
          <HealthReasons reasons={o.reasons} signals={o.signals} />
          <p className="text-xs text-subtle-foreground">{t('operations.health.explain')}</p>
        </div>
        <div className="grid content-start gap-3" data-testid="client-sla-compliance">
          <p className="text-sm font-medium">{t('operations.client360.compliance')}</p>
          {(
            [
              ['responseRate', data.compliance.response],
              ['resolutionRate', data.compliance.resolution],
            ] as const
          ).map(([key, c]) => (
            <div key={key} className="grid gap-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{t(`operations.client360.${key}`)}</span>
                <span className="tabular">
                  {rate(c.rate)}
                  {c.total ? (
                    <span className="ms-1 text-subtle-foreground">
                      ({t('operations.client360.ofTotal', { met: c.met, total: c.total })})
                    </span>
                  ) : null}
                </span>
              </div>
              <Progress
                value={(c.rate ?? 0) * 100}
                tone={c.rate === null || c.rate >= 0.9 ? 'success' : c.rate >= 0.75 ? 'warning' : 'danger'}
                aria-label={t(`operations.client360.${key}`)}
              />
            </div>
          ))}
          {canSla ? (
            <Button asChild variant="link" size="sm" className="justify-start px-0">
              <Link href={`/sla?client=${o.id}`}>{t('operations.client360.openSla')}</Link>
            </Button>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('operations.client360.openRequests')}
          value={f.number(o.openRequests)}
          icon={ClipboardList}
          footer={t('operations.client360.openRequestsFooter', { count: o.awaitingTriage })}
        />
        <StatCard
          label={t('operations.client360.openTasks')}
          value={f.number(o.openTasks)}
          icon={ListTodo}
          footer={t('operations.client360.openTasksFooter', { count: o.signals.overdueTasks })}
        />
        <StatCard
          label={t('operations.client360.approvals')}
          value={f.number(o.clientReview)}
          icon={Hourglass}
          footer={t('operations.client360.approvalsFooter', { count: o.internalReview })}
        />
        <StatCard
          label={t('operations.client360.campaigns')}
          value={f.number(o.activeCampaigns)}
          icon={Megaphone}
          footer={o.worstCampaign ? t('operations.client360.campaignsFooter', { health: t(`campaigns.health.${o.worstCampaign}`) }) : null}
        />
      </div>

      {data.issues.length ? (
        <section>
          <SectionTitle title={t('operations.client360.issues')} />
          <Card className="divide-y divide-border">
            {data.issues.map((i) => (
              <IssueRow key={`${i.requestId}-${i.kind}`} issue={i} showClient={false} />
            ))}
          </Card>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="min-w-0">
          <SectionTitle title={t('operations.client360.deadlines')} />
          <Card className="divide-y divide-border" data-testid="client-deadlines">
            {data.deadlines.length === 0 ? (
              <EmptyState
                compact
                icon={CalendarClock}
                title={t('operations.client360.noDeadlines')}
                description={t('operations.client360.noDeadlinesBody')}
              />
            ) : (
              data.deadlines.map((d) => (
                <Link
                  key={`${d.kind}-${d.id}`}
                  href={d.kind === 'request' ? `/requests/${d.id}` : `/tasks?task=${d.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted"
                >
                  <span className="tabular w-20 shrink-0 text-xs text-muted-foreground">{f.date(`${d.date}T12:00:00`, 'short')}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      <bdi>{d.title}</bdi>
                    </p>
                    <p className="truncate text-xs text-subtle-foreground">
                      <span dir="ltr">{d.label}</span>
                      {d.kind === 'task' && d.assigneeNames.length ? ` · ${f.list(d.assigneeNames)}` : ''}
                    </p>
                  </div>
                  {d.kind === 'request' ? <PriorityBadge priority={d.priority} /> : <Badge tone="neutral">{t('nav.tasks')}</Badge>}
                </Link>
              ))
            )}
          </Card>
        </section>

        <section className="min-w-0">
          <SectionTitle title={t('operations.client360.activity')} />
          <Card className="p-2" data-testid="client-activity">
            {data.activity.length === 0 ? (
              <EmptyState
                compact
                icon={Sparkles}
                title={t('operations.client360.noActivity')}
                description={t('operations.client360.noActivityBody')}
              />
            ) : (
              <ol className="grid grid-cols-1">
                {data.activity.map((a) => {
                  const Icon = activityIcon[a.kind];
                  return (
                    <li key={a.id} className="min-w-0">
                      <Link href={a.href} className="flex items-start gap-3 rounded-md px-2 py-2.5 hover:bg-surface-muted">
                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-muted text-muted-foreground">
                          <Icon className="size-3.5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="block truncate">
                            <span className="font-medium">{activityLine(a)}</span>
                            {' · '}
                            <bdi className="text-muted-foreground">{a.title}</bdi>
                          </span>
                          <span className="block text-xs text-subtle-foreground">
                            {a.actorName ?? (a.actorSide === 'system' ? t('operations.client360.systemActor') : '')}
                            {a.actorName || a.actorSide === 'system' ? ' · ' : ''}
                            {f.relative(a.at)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
