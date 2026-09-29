import { ArrowUpRight, Briefcase, MailPlus, MessageCircleWarning, MessagesSquare, Sparkles, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { DirIcon, EmptyState, PageHeader, SectionTitle, StatCard } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarGroup, Badge, Card } from '@/components/ui/primitives';
import { requireAgency } from '@/lib/auth/context';
import { localized } from '@/lib/i18n/localized';
import { getFormatters } from '@/lib/i18n/server-format';
import { can } from '@/lib/permissions/can';
import { publicAssetUrl } from '@/lib/storage';
import { getAgencyDashboard } from '@/modules/dashboard/server/queries';
import { OpsDashboard } from '@/modules/operations/components/ops-dashboard';
import { getOpsOverview, type OpsScope } from '@/modules/operations/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('dashboard') };
}

function greetingKey(hour: number) {
  if (hour < 12) return 'greetingMorning' as const;
  if (hour < 17) return 'greetingAfternoon' as const;
  return 'greetingEvening' as const;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const ctx = await requireAgency();
  const t = await getTranslations();
  const f = await getFormatters();
  const { scope: scopeParam } = await searchParams;
  const ops = can(ctx.permissions, 'operations:read');
  const scope: OpsScope =
    scopeParam === 'mine'
      ? { kind: 'mine' }
      : scopeParam && /^[0-9a-f-]{36}$/.test(scopeParam)
        ? { kind: 'manager', userId: scopeParam }
        : { kind: 'all' };
  const [data, opsData] = await Promise.all([getAgencyDashboard(ctx), ops ? getOpsOverview(ctx, scope) : null]);
  const firstName = ctx.profile.fullName.split(' ')[0] ?? '';
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: ctx.profile.timezone }).format(new Date()),
  );
  const canSeeClients = can(ctx.permissions, 'clients:read_all') || can(ctx.permissions, 'clients:read_assigned');

  return (
    <div className="space-y-8">
      <PageHeader
        title={t(`dashboard.${greetingKey(hour)}`, { name: firstName })}
        description={t('dashboard.todayLine', { weekday: f.weekday(new Date()), date: f.date(new Date(), 'long') })}
        actions={
          can(ctx.permissions, 'clients:create') ? (
            <Button asChild>
              <Link href="/clients/new">
                <Briefcase />
                {t('dashboard.newClient')}
              </Link>
            </Button>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          {data.myRoles.map((r) => (
            <Badge key={r.key} tone="brand">
              {localized(r.name, f.locale)}
            </Badge>
          ))}
          {data.myDepartments.map((d) => (
            <Badge key={localized(d.name, 'en')} tone="neutral">
              {localized(d.name, f.locale)}
              {d.isLead ? ` · ${t('dashboard.lead')}` : ''}
            </Badge>
          ))}
        </div>
      </PageHeader>

      {opsData ? (
        <OpsDashboard
          data={opsData}
          scopeValue={scope.kind === 'manager' ? scope.userId : scope.kind}
          canSla={Boolean(ctx.flags['module.requests']) && can(ctx.permissions, 'requests:read')}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {canSeeClients ? (
            <StatCard
              label={t('dashboard.statClients')}
              value={f.number(data.clients.filter((c) => c.status !== 'archived').length)}
              icon={Briefcase}
              footer={t('dashboard.statClientsFooter', { count: data.myClients.length })}
            />
          ) : null}
          <StatCard
            label={t('dashboard.statTeam')}
            value={f.number(data.teamCount)}
            icon={Users}
            footer={t('dashboard.statTeamFooter', { count: data.team.length })}
          />
          {canSeeClients ? (
            <StatCard
              label={t('dashboard.statWaiting')}
              value={f.number(data.waitingOnUs)}
              icon={MessageCircleWarning}
              footer={t('dashboard.statWaitingFooter')}
            />
          ) : null}
          {data.pendingInvitations ? (
            <StatCard
              label={t('dashboard.statInvitations')}
              value={f.number(data.pendingInvitations.length)}
              icon={MailPlus}
              footer={t('dashboard.statInvitationsFooter')}
            />
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {canSeeClients ? (
            <section>
              <SectionTitle
                title={t('dashboard.recentConversations')}
                action={
                  <Button asChild variant="link" size="sm">
                    <Link href="/messages">{t('common.viewAll')}</Link>
                  </Button>
                }
              />
              <Card className="divide-y divide-border">
                {data.recentThreads.length === 0 ? (
                  <EmptyState
                    compact
                    icon={MessagesSquare}
                    title={t('dashboard.noConversations')}
                    description={t('dashboard.noConversationsBody')}
                  />
                ) : (
                  data.recentThreads.map((th) => {
                    const client = data.clients.find((c) => c.id === th.clientId);
                    return (
                      <Link
                        key={th.id}
                        href={`/messages?thread=${th.id}`}
                        className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-surface-muted"
                      >
                        <Avatar
                          name={client ? localized(client.name, f.locale) : '?'}
                          src={publicAssetUrl(client?.logoPath)}
                          size="sm"
                          square
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium">{client ? localized(client.name, f.locale) : ''}</p>
                            <span className="text-xs text-subtle-foreground">·</span>
                            <p className="truncate text-sm text-muted-foreground">{th.title}</p>
                            {th.visibility === 'internal' ? <Badge tone="warning">{t('common.internal')}</Badge> : null}
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                            {th.lastAuthor ? <span className="font-medium text-foreground">{th.lastAuthor}: </span> : null}
                            {th.preview}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-xs text-subtle-foreground">{f.relative(th.lastCommentAt)}</span>
                          {th.lastAuthorSide === 'client' ? (
                            <Badge tone="info" dot>
                              {t('dashboard.awaitingReply')}
                            </Badge>
                          ) : null}
                        </div>
                      </Link>
                    );
                  })
                )}
              </Card>
            </section>
          ) : null}

          <section>
            <SectionTitle title={t('dashboard.teamAtGlance')} />
            <div className="grid gap-3 sm:grid-cols-2">
              {data.team.map((d) => (
                <Card key={d.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{localized(d.name, f.locale)}</p>
                    <p className="text-xs text-subtle-foreground">{t('dashboard.members', { count: d.members.length })}</p>
                  </div>
                  <AvatarGroup
                    size="xs"
                    max={4}
                    people={d.members.map((m) => ({ id: m.userId, name: m.name, src: publicAssetUrl(m.avatarPath) }))}
                  />
                </Card>
              ))}
            </div>
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          {data.myClients.length > 0 ? (
            <section>
              <SectionTitle title={t('dashboard.myClients')} />
              <Card className="divide-y divide-border">
                {data.myClients.map((c) => (
                  <Link
                    key={c.id}
                    href={`/clients/${c.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
                  >
                    <Avatar name={localized(c.name, f.locale)} src={publicAssetUrl(c.logoPath)} size="sm" square />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{localized(c.name, f.locale)}</span>
                    <DirIcon icon={ArrowUpRight} className="size-4 text-subtle-foreground" />
                  </Link>
                ))}
              </Card>
            </section>
          ) : null}

          {data.pendingInvitations ? (
            <section>
              <SectionTitle
                title={t('dashboard.pendingInvitations')}
                action={
                  <Button asChild variant="link" size="sm">
                    <Link href="/admin/users?tab=invitations">{t('common.viewAll')}</Link>
                  </Button>
                }
              />
              <Card className="divide-y divide-border">
                {data.pendingInvitations.length === 0 ? (
                  <EmptyState compact icon={MailPlus} title={t('dashboard.noInvitations')} />
                ) : (
                  data.pendingInvitations.map((inv) => (
                    <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                      <Avatar name={inv.fullName ?? inv.email} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{inv.fullName ?? inv.email}</p>
                        <p className="truncate text-xs text-subtle-foreground" dir="ltr">
                          {inv.email}
                        </p>
                      </div>
                      <span className="text-xs text-subtle-foreground">{t('dashboard.expires', { when: f.relative(inv.expiresAt) })}</span>
                    </div>
                  ))
                )}
              </Card>
            </section>
          ) : null}

          {data.recentActivity ? (
            <section>
              <SectionTitle
                title={t('dashboard.recentActivity')}
                action={
                  <Button asChild variant="link" size="sm">
                    <Link href="/admin/audit">{t('common.viewAll')}</Link>
                  </Button>
                }
              />
              <Card className="p-2">
                {data.recentActivity.length === 0 ? (
                  <EmptyState compact icon={Sparkles} title={t('dashboard.noActivity')} />
                ) : (
                  <ul>
                    {data.recentActivity.map((a) => (
                      <li key={a.id} className="flex items-start gap-3 rounded-md px-2 py-2.5">
                        <Avatar name={a.actorName ?? '?'} src={publicAssetUrl(a.actorAvatar)} size="xs" />
                        <p className="min-w-0 flex-1 text-sm">
                          <span className="font-medium">{a.actorName}</span>{' '}
                          <span className="text-muted-foreground">
                            {t(`admin.audit.actions.${a.action as 'insert' | 'update' | 'delete'}`)}{' '}
                            {t.has(`admin.audit.tables.${a.tableName}` as never)
                              ? t(`admin.audit.tables.${a.tableName}` as never)
                              : a.tableName}
                          </span>
                          <span className="block text-xs text-subtle-foreground">{f.relative(a.createdAt)}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
