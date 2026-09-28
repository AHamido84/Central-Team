import { ArrowUpRight, CheckCheck, ClipboardList, FileUp, MessageSquare, MessagesSquare, Plus, Sparkles, Upload } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { DirIcon, EmptyState, SectionTitle } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card } from '@/components/ui/primitives';
import { requirePortal } from '@/lib/auth/context';
import { localized } from '@/lib/i18n/localized';
import { getFormatters } from '@/lib/i18n/server-format';
import { can } from '@/lib/permissions/can';
import { publicAssetUrl } from '@/lib/storage';
import { AccountManagerCard } from '@/modules/clients/components/client-overview';
import { PackageUsageCard } from '@/modules/clients/components/package-usage-card';
import { listRecentFiles } from '@/modules/files/server/queries';
import { RecentFilesGrid } from '@/modules/portal/components/recent-files';
import { preview } from '@/modules/messaging/mentions';
import { getPortalHome } from '@/modules/portal/server/queries';
import { RequestRow } from '@/modules/requests/components/portal-requests';
import { openStatuses } from '@/modules/requests/constants';
import { listRequestActivity, listRequests } from '@/modules/requests/server/queries';
import { ClientRequestStatsRow, PackageUsageChart } from '@/modules/requests/components/client-dashboard';
import { RequestStatusBadge } from '@/modules/requests/components/badges';
import { clientRequestStats } from '@/modules/requests/stats';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('portalHome') };
}

function greetingKey(hour: number) {
  if (hour < 12) return 'greetingMorning' as const;
  if (hour < 17) return 'greetingAfternoon' as const;
  return 'greetingEvening' as const;
}

export default async function PortalHomePage() {
  const ctx = await requirePortal();
  const t = await getTranslations();
  const f = await getFormatters();
  const requestsLive = Boolean(ctx.flags['module.requests']);
  const [home, recentFiles, requests, requestActivity] = await Promise.all([
    getPortalHome(ctx),
    listRecentFiles(ctx.client.id, 4),
    requestsLive ? listRequests({ clientId: ctx.client.id }) : Promise.resolve([]),
    requestsLive ? listRequestActivity(ctx.client.id, 6) : Promise.resolve([]),
  ]);
  const activeRequests = requests
    .filter((r) => openStatuses.includes(r.status))
    .sort(
      (a, b) => Number(b.status === 'needs_info') - Number(a.status === 'needs_info') || b.lastActivityAt.localeCompare(a.lastActivityAt),
    );
  const stats = clientRequestStats(requests, ctx.profile.timezone);
  const canRequest = requestsLive && can(ctx.permissions, 'portal_requests:create');
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: ctx.profile.timezone }).format(new Date()),
  );
  const firstName = ctx.profile.fullName.split(' ')[0] ?? '';
  const clientName = localized(home.client.name, f.locale);
  const approvalsLive = Boolean(ctx.flags['module.approvals']);

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-primary px-6 py-8 text-primary-foreground sm:px-8 sm:py-10">
        <div
          aria-hidden
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(circle at 85% 20%, rgb(255 255 255 / 0.35) 0, transparent 35%), radial-gradient(circle at 10% 110%, rgb(255 255 255 / 0.25) 0, transparent 40%)',
          }}
        />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-primary-foreground/80">
              {t('dashboard.todayLine', { weekday: f.weekday(new Date()), date: f.date(new Date(), 'long') })}
            </p>
            <h1 className="mt-1 text-h1 font-semibold text-balance sm:text-display" data-testid="portal-greeting">
              {t(`dashboard.${greetingKey(hour)}`, { name: firstName })}
            </h1>
            <p className="mt-2 max-w-xl text-primary-foreground/85">
              {t('portal.heroBody', { client: clientName, agency: localized(ctx.organization.name, f.locale) })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {can(ctx.permissions, 'portal_messages:send') ? (
              <Button asChild variant="secondary" className="bg-white text-primary hover:bg-white/90">
                <Link href="/portal/messages">
                  <MessageSquare />
                  {t('portal.sendMessage')}
                  {home.unreadMessages ? <Badge tone="danger">{home.unreadMessages}</Badge> : null}
                </Link>
              </Button>
            ) : null}
            {can(ctx.permissions, 'portal_files:upload') ? (
              <Button asChild variant="ghost" className="text-primary-foreground hover:bg-white/15">
                <Link href="/portal/files">
                  <Upload />
                  {t('portal.uploadFiles')}
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {requestsLive ? <ClientRequestStatsRow stats={stats} /> : null}

      <div className="lg:hidden">
        <AccountManagerCard manager={home.accountManager} title={t('portal.yourAccountManager')} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-8">
          {/* Phase 3 slot: approvals */}
          <section data-testid="slot-approvals">
            <SectionTitle
              title={t('portal.waitingApproval')}
              action={
                approvalsLive ? (
                  <Button asChild variant="link" size="sm">
                    <Link href="/portal/approvals">{t('common.viewAll')}</Link>
                  </Button>
                ) : null
              }
            />
            <Card>
              <EmptyState
                compact
                icon={CheckCheck}
                title={approvalsLive ? t('portal.noApprovals') : t('portal.approvalsSoonTitle')}
                description={approvalsLive ? t('portal.noApprovalsBody') : t('portal.approvalsSoonBody')}
              />
            </Card>
          </section>

          {/* Phase 2 slot: requests */}
          <section data-testid="slot-requests">
            <SectionTitle
              title={t('portal.activeRequests')}
              action={
                requestsLive ? (
                  <Button asChild variant="link" size="sm">
                    <Link href="/portal/requests">{t('common.viewAll')}</Link>
                  </Button>
                ) : null
              }
            />
            {requestsLive && activeRequests.length ? (
              <Card className="overflow-hidden">
                <ul className="divide-y divide-border" data-testid="home-requests">
                  {activeRequests.slice(0, 4).map((r) => (
                    <li key={r.id}>
                      <RequestRow r={r} href={`/portal/requests/${r.id}`} />
                    </li>
                  ))}
                </ul>
                {canRequest ? (
                  <div className="border-t border-border p-3">
                    <Button asChild variant="ghost" size="sm">
                      <Link href="/portal/requests/new">
                        <Plus />
                        {t('requests.newRequest')}
                      </Link>
                    </Button>
                  </div>
                ) : null}
              </Card>
            ) : (
              <Card>
                <EmptyState
                  compact
                  icon={ClipboardList}
                  title={requestsLive ? t('portal.noRequests') : t('portal.requestsSoonTitle')}
                  description={requestsLive ? t('portal.noRequestsBody') : t('portal.requestsSoonBody')}
                  action={
                    canRequest ? (
                      <Button asChild size="sm">
                        <Link href="/portal/requests/new" data-testid="home-new-request">
                          <Plus />
                          {t('requests.newRequest')}
                        </Link>
                      </Button>
                    ) : !requestsLive && can(ctx.permissions, 'portal_messages:send') ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href="/portal/messages">
                          <MessagesSquare />
                          {t('portal.messageInstead')}
                        </Link>
                      </Button>
                    ) : null
                  }
                />
              </Card>
            )}
          </section>

          <section>
            <SectionTitle title={t('portal.yourPackage')} />
            {requestsLive ? <PackageUsageChart usage={home.usage} /> : <PackageUsageCard usage={home.usage} compact />}
          </section>

          <section>
            <SectionTitle
              title={t('files.recentFiles')}
              action={
                <Button asChild variant="link" size="sm">
                  <Link href="/portal/files">{t('common.viewAll')}</Link>
                </Button>
              }
            />
            <RecentFilesGrid files={recentFiles} />
          </section>
        </div>

        <aside className="space-y-6">
          <div className="hidden lg:block">
            <AccountManagerCard manager={home.accountManager} title={t('portal.yourAccountManager')} />
          </div>
          {requestsLive ? (
            <section>
              <SectionTitle title={t('requests.dashboard.updates')} />
              <Card className="p-4" data-testid="request-activity">
                {requestActivity.length === 0 ? (
                  <EmptyState compact icon={ClipboardList} title={t('requests.dashboard.noUpdates')} />
                ) : (
                  <ol className="grid gap-3">
                    {requestActivity.map((a) => (
                      <li key={a.id}>
                        <Link href={`/portal/requests/${a.requestId}`} className="block rounded-md text-sm hover:underline">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-medium">
                              <bdi>{a.title}</bdi>
                            </span>
                            <RequestStatusBadge status={a.to} />
                          </span>
                          <span className="block text-xs text-subtle-foreground">
                            <span dir="ltr">{a.reference}</span> · {f.relative(a.at)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </section>
          ) : null}
          <section>
            <SectionTitle title={t('portal.recentActivity')} />
            <Card className="p-2" data-testid="portal-activity">
              {home.activity.length === 0 ? (
                <EmptyState compact icon={Sparkles} title={t('portal.noActivity')} />
              ) : (
                <ul>
                  {home.activity.map((a) => (
                    <li key={`${a.kind}-${a.id}`}>
                      <Link
                        href={
                          a.kind === 'file'
                            ? `/portal/files${a.folderId ? `?folder=${a.folderId}` : ''}`
                            : a.requestId
                              ? `/portal/requests/${a.requestId}`
                              : `/portal/messages?thread=${a.threadId}`
                        }
                        className="flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-surface-muted"
                      >
                        <span className="relative">
                          <Avatar name={a.actorName ?? '?'} src={publicAssetUrl(a.actorAvatar)} size="sm" />
                          <span className="absolute -end-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-surface text-primary ring-2 ring-surface">
                            {a.kind === 'file' ? (
                              <FileUp className="size-3" aria-hidden />
                            ) : (
                              <MessageSquare className="size-3" aria-hidden />
                            )}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="font-medium">{a.actorName}</span>{' '}
                          <span className="text-muted-foreground">
                            {a.kind === 'file'
                              ? t.rich('portal.activityFile', {
                                  file: a.fileName,
                                  b: (c) => <bdi className="font-medium text-foreground">{c}</bdi>,
                                })
                              : t.rich('portal.activityMessage', {
                                  thread: a.threadTitle,
                                  b: (c) => <bdi className="font-medium text-foreground">{c}</bdi>,
                                })}
                          </span>
                          {a.kind === 'message' ? (
                            <span className="mt-0.5 line-clamp-1 block text-xs text-subtle-foreground">{preview(a.body, 70)}</span>
                          ) : null}
                          <span className="block text-xs text-subtle-foreground">{f.relative(a.at)}</span>
                        </span>
                        <DirIcon icon={ArrowUpRight} className="mt-1 size-3.5 text-subtle-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </aside>
      </div>
    </div>
  );
}
