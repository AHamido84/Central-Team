import {
  AlarmClock,
  CheckCircle2,
  ClipboardList,
  Hourglass,
  ListTodo,
  Megaphone,
  MessageCircleWarning,
  MessageSquareReply,
  ShieldAlert,
} from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { EmptyState, SectionTitle, StatCard } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card } from '@/components/ui/primitives';
import { localized } from '@/lib/i18n/localized';
import { getFormatters } from '@/lib/i18n/server-format';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { HealthBadge } from '@/modules/campaigns/components/badges';
import { ClientHealthBadge } from '@/modules/operations/components/health';
import { ScopeSelect } from '@/modules/operations/components/scope-select';
import type { OpsOverview } from '@/modules/operations/server/queries';
import { IssueRow } from '@/modules/sla/components/sla-monitor';
import { taskReference } from '@/modules/tasks/constants';

const MAX_ISSUES = 6;

export async function OpsDashboard({ data, scopeValue, canSla }: { data: OpsOverview; scopeValue: string; canSla: boolean }) {
  const t = await getTranslations();
  const f = await getFormatters();
  const locale = f.locale;
  const clientName = (id: string) => {
    const c = data.clients.find((x) => x.id === id);
    return c ? localized(c.name, locale) : '';
  };
  const tot = data.totals;
  const rate = (r: number | null) => (r === null ? t('sla.monitor.noData') : f.percent(r));
  const attentionCount = data.issues.length + data.overdueTasks.length + data.staleApprovals.length + data.offTrackCampaigns.length;
  const shownIssues = data.issues.slice(0, MAX_ISSUES);

  return (
    <div className="space-y-8" data-testid="ops-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ScopeSelect value={scopeValue} managers={data.managers} />
        {canSla ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/sla">
              <ShieldAlert />
              {t('nav.slaMonitor')}
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="ops-tiles">
        <StatCard
          label={t('operations.tiles.openRequests')}
          value={f.number(tot.openRequests)}
          icon={ClipboardList}
          footer={t('operations.tiles.openRequestsFooter', { count: tot.awaitingTriage })}
        />
        <StatCard
          label={t('operations.tiles.sla')}
          value={f.number(tot.slaOverdue)}
          icon={AlarmClock}
          footer={t('operations.tiles.slaFooter', { count: tot.slaAtRisk })}
          className={tot.slaOverdue ? 'border-danger/40' : undefined}
        />
        <StatCard
          label={t('operations.tiles.overdueTasks')}
          value={f.number(tot.overdueTasks)}
          icon={ListTodo}
          footer={t('operations.tiles.overdueTasksFooter')}
        />
        <StatCard
          label={t('operations.tiles.clientReview')}
          value={f.number(tot.clientReview)}
          icon={Hourglass}
          footer={t('operations.tiles.clientReviewFooter', { count: tot.internalReview })}
        />
        <StatCard
          label={t('operations.tiles.campaigns')}
          value={f.number(tot.campaignsOffTrack + tot.campaignsAtRisk)}
          icon={Megaphone}
          footer={t('operations.tiles.campaignsFooter', { off: f.number(tot.campaignsOffTrack), risk: f.number(tot.campaignsAtRisk) })}
        />
        <StatCard
          label={t('operations.tiles.unanswered')}
          value={f.number(tot.unanswered)}
          icon={MessageCircleWarning}
          footer={t('operations.tiles.unansweredFooter')}
        />
        <StatCard
          label={t('operations.tiles.compliance')}
          value={rate(data.compliance.response.rate)}
          icon={MessageSquareReply}
          footer={t('operations.tiles.complianceFooter', { rate: rate(data.compliance.resolution.rate) })}
        />
        <StatCard
          label={t('operations.tiles.breaches')}
          value={f.number(data.unacknowledgedBreaches)}
          icon={ShieldAlert}
          footer={
            canSla ? (
              <Link href="/sla?view=unacknowledged" className="text-primary hover:underline">
                {t('operations.tiles.breachesFooter')}
              </Link>
            ) : null
          }
        />
      </div>

      <section className="min-w-0">
        <SectionTitle
          title={t('operations.portfolio.title')}
          action={<span className="text-xs text-subtle-foreground">{t('operations.portfolio.description')}</span>}
        />
        <Card className="overflow-hidden" data-testid="ops-portfolio">
          {data.clients.length === 0 ? (
            <EmptyState
              compact
              icon={ClipboardList}
              title={t('operations.portfolio.empty')}
              description={t('operations.portfolio.emptyBody')}
            />
          ) : (
            <>
              {/* Desktop: table. Mobile: stacked cards. */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 text-start font-medium">
                        {t('operations.portfolio.client')}
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-start font-medium">
                        {t('operations.portfolio.health')}
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-end font-medium">
                        {t('operations.portfolio.requests')}
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-end font-medium">
                        {t('operations.portfolio.sla')}
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-end font-medium">
                        {t('operations.portfolio.tasks')}
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-end font-medium">
                        {t('operations.portfolio.approvals')}
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-start font-medium">
                        {t('operations.portfolio.campaigns')}
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-end font-medium">
                        {t('operations.portfolio.lastActivity')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.clients.map((c) => (
                      <tr key={c.id} className="hover:bg-surface-muted" data-testid="ops-client-row">
                        <td className="px-4 py-3">
                          <Link href={`/clients/${c.id}`} className="flex items-center gap-3 font-medium hover:underline">
                            <Avatar name={localized(c.name, locale)} src={publicAssetUrl(c.logoPath)} size="sm" square />
                            <span className="min-w-0">
                              <span className="block truncate">{localized(c.name, locale)}</span>
                              <span className="block truncate text-xs font-normal text-subtle-foreground">
                                {c.accountManagerName ?? '—'}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <ClientHealthBadge health={c.health} score={c.score} reasons={c.reasons} signals={c.signals} />
                        </td>
                        <td className="tabular px-3 py-3 text-end">{f.number(c.openRequests)}</td>
                        <td className={cn('tabular px-3 py-3 text-end', c.signals.slaOverdue ? 'font-semibold text-danger' : '')}>
                          {f.number(c.signals.slaOverdue)}
                          {c.signals.slaAtRisk ? (
                            <Badge
                              tone="warning"
                              className="ms-1.5"
                              title={t('operations.health.reasons.slaAtRisk', { count: c.signals.slaAtRisk })}
                            >
                              {f.number(c.signals.slaAtRisk)}
                            </Badge>
                          ) : null}
                        </td>
                        <td className={cn('tabular px-3 py-3 text-end', c.signals.overdueTasks ? 'text-danger' : '')}>
                          {f.number(c.signals.overdueTasks)}
                        </td>
                        <td className="tabular px-3 py-3 text-end">{f.number(c.clientReview)}</td>
                        <td className="px-3 py-3">{c.worstCampaign ? <HealthBadge health={c.worstCampaign} /> : '—'}</td>
                        <td className="px-4 py-3 text-end text-xs text-subtle-foreground">
                          {c.lastClientActivity ? f.relative(c.lastClientActivity) : t('operations.portfolio.never')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-border md:hidden">
                {data.clients.map((c) => (
                  <li key={c.id}>
                    <Link href={`/clients/${c.id}`} className="flex items-start gap-3 px-4 py-3" data-testid="ops-client-card">
                      <Avatar name={localized(c.name, locale)} src={publicAssetUrl(c.logoPath)} size="sm" square />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-medium">{localized(c.name, locale)}</p>
                          <ClientHealthBadge health={c.health} score={c.score} reasons={c.reasons} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('operations.portfolio.requests')} {f.number(c.openRequests)} · {t('operations.portfolio.sla')}{' '}
                          {f.number(c.signals.slaOverdue)} · {t('operations.portfolio.tasks')} {f.number(c.signals.overdueTasks)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="min-w-0">
          <SectionTitle title={t('operations.attention.title')} />
          <Card className="divide-y divide-border" data-testid="ops-attention">
            {attentionCount === 0 ? (
              <EmptyState
                compact
                icon={CheckCircle2}
                title={t('operations.attention.empty')}
                description={t('operations.attention.emptyBody')}
              />
            ) : (
              <>
                {shownIssues.map((i) => (
                  <IssueRow key={`${i.requestId}-${i.kind}`} issue={i} />
                ))}
                {data.issues.length > MAX_ISSUES && canSla ? (
                  <Link href="/sla" className="block px-4 py-2 text-xs text-primary hover:underline">
                    {t('operations.attention.more', { count: data.issues.length - MAX_ISSUES })}
                  </Link>
                ) : null}
                {data.offTrackCampaigns.slice(0, 4).map((c) => (
                  <Link key={c.id} href={`/campaigns/${c.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-muted">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-muted-foreground">
                      <Megaphone className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        <bdi>{c.name}</bdi>
                      </p>
                      <p className="truncate text-xs text-subtle-foreground">{clientName(c.clientId)}</p>
                    </div>
                    <HealthBadge health={c.health} />
                  </Link>
                ))}
                {data.overdueTasks.slice(0, 5).map((task) => (
                  <Link key={task.id} href={`/tasks?task=${task.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-muted">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-danger-soft text-danger">
                      <ListTodo className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        <bdi>{task.title}</bdi>
                      </p>
                      <p className="truncate text-xs text-subtle-foreground">
                        <span dir="ltr">{taskReference(task.number)}</span> · {clientName(task.clientId)}
                        {task.assigneeNames.length ? ` · ${f.list(task.assigneeNames)}` : ''}
                      </p>
                    </div>
                    <Badge tone="danger">{t('operations.attention.overdueTask', { date: f.date(`${task.dueDate}T12:00:00`) })}</Badge>
                  </Link>
                ))}
                {data.staleApprovals.slice(0, 4).map((d) => (
                  <Link key={d.id} href={`/deliverables/${d.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-muted">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-warning-soft text-warning">
                      <Hourglass className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        <bdi>{d.title}</bdi>
                      </p>
                      <p className="truncate text-xs text-subtle-foreground">{clientName(d.clientId)}</p>
                    </div>
                    <span className="shrink-0 text-xs text-subtle-foreground">
                      {t('operations.attention.staleApproval', { when: f.relative(d.since) })}
                    </span>
                  </Link>
                ))}
              </>
            )}
          </Card>
        </section>

        <section className="min-w-0">
          <SectionTitle
            title={t('operations.workload.title')}
            action={
              <Button asChild variant="link" size="sm">
                <Link href="/team">{t('operations.workload.viewTeam')}</Link>
              </Button>
            }
          />
          <div className="grid gap-3 sm:grid-cols-2" data-testid="ops-departments">
            {data.departments.map((d) => (
              <Link key={d.id} href={`/team?department=${d.id}`} className="block">
                <Card className="h-full p-4 transition-colors hover:bg-surface-muted">
                  <p className="truncate text-sm font-medium">{localized(d.name, locale)}</p>
                  <p className="text-xs text-subtle-foreground">{t('operations.workload.members', { count: d.members })}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone="neutral">{t('operations.workload.open', { count: f.number(d.open) })}</Badge>
                    {d.overdue ? <Badge tone="danger">{t('operations.workload.overdue', { count: f.number(d.overdue) })}</Badge> : null}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
