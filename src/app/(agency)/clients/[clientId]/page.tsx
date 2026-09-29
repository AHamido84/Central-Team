import { ClipboardList, FolderOpen, LayoutGrid, Megaphone, MessagesSquare, Package, Pencil, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { PageHeader, SectionTitle } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarGroup, Badge, Card } from '@/components/ui/primitives';
import { requireAgencyAny, type AgencyContext } from '@/lib/auth/context';
import { localized, type Locale } from '@/lib/i18n/localized';
import { getFormatters } from '@/lib/i18n/server-format';
import { can } from '@/lib/permissions/can';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { clientStatusTone, type ClientStatus } from '@/modules/clients/constants';
import { AccountManagerCard, CompanyInfoCard, InternalNotesCard } from '@/modules/clients/components/client-overview';
import { ClientUsersManager } from '@/modules/clients/components/client-users-manager';
import { AssignPackageDialog, RecordUsageDialog } from '@/modules/clients/components/package-dialogs';
import { PackageUsageCard } from '@/modules/clients/components/package-usage-card';
import type { PackageUsage } from '@/modules/clients/server/package-usage';
import { getClientDetail, listAgencyPeople, listClientUsers, listPackages } from '@/modules/clients/server/queries';
import { FileBrowser } from '@/modules/files/components/file-browser';
import { listClientLibrary } from '@/modules/files/server/queries';
import { ThreadsView } from '@/modules/messaging/components/threads-view';
import { getThread, listThreads } from '@/modules/messaging/server/queries';
import { CampaignList } from '@/modules/campaigns/components/campaign-list';
import { listCampaigns } from '@/modules/campaigns/server/queries';
import { Client360View } from '@/modules/operations/components/client-360';
import { getClient360 } from '@/modules/operations/server/queries';
import { RequestsInbox } from '@/modules/requests/components/requests-inbox';
import { listRequests } from '@/modules/requests/server/queries';

const tabs = [
  { key: 'overview', icon: LayoutGrid },
  { key: 'users', icon: Users },
  { key: 'package', icon: Package },
  { key: 'files', icon: FolderOpen },
  { key: 'messages', icon: MessagesSquare },
  { key: 'requests', icon: ClipboardList },
  { key: 'campaigns', icon: Megaphone },
] as const;
type Tab = (typeof tabs)[number]['key'];

export async function generateMetadata({ params }: { params: Promise<{ clientId: string }> }): Promise<Metadata> {
  const { clientId } = await params;
  const detail = /^[0-9a-f-]{36}$/.test(clientId) ? await getClientDetail(clientId) : null;
  const locale = (await getLocale()) as Locale;
  return { title: detail ? localized(detail.client.name, locale) : undefined };
}

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ tab?: string; thread?: string }>;
}) {
  const { clientId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(clientId)) notFound();
  const ctx = await requireAgencyAny(['clients:read_all', 'clients:read_assigned']);
  const detail = await getClientDetail(clientId);
  if (!detail) notFound();
  const t = await getTranslations();
  const f = await getFormatters();
  const locale = f.locale;
  const tab: Tab = tabs.some((x) => x.key === sp.tab) ? (sp.tab as Tab) : 'overview';
  const c = detail.client;
  const name = localized(c.name, locale);
  const canEdit = can(ctx.permissions, 'clients:update');
  const c360 = tab === 'overview' && can(ctx.permissions, 'operations:read') ? await getClient360(ctx, clientId) : null;

  return (
    <div className="space-y-6">
      <BreadcrumbLabel segment={clientId} label={name} />
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar name={name} src={publicAssetUrl(c.logoPath)} size="lg" square />
            <span>{name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={clientStatusTone[c.status as ClientStatus]} dot>
              {t(`clients.statuses.${c.status as ClientStatus}`)}
            </Badge>
            {detail.accountManager ? <span>{t('clients.managedBy', { name: detail.accountManager.name })}</span> : null}
          </span>
        }
        actions={
          canEdit ? (
            <Button asChild variant="outline">
              <Link href={`/clients/${clientId}/edit`} data-testid="edit-client">
                <Pencil />
                {t('common.edit')}
              </Link>
            </Button>
          ) : null
        }
      />

      <nav aria-label={t('clients.sections')} className="-mx-(--gutter) overflow-x-auto px-(--gutter)">
        <ul className="flex gap-1 border-b border-border">
          {tabs
            .filter((x) => x.key !== 'requests' || (ctx.flags['module.requests'] && can(ctx.permissions, 'requests:read')))
            .filter((x) => x.key !== 'campaigns' || (ctx.flags['module.campaigns'] && can(ctx.permissions, 'campaigns:read')))
            .map((x) => (
              <li key={x.key}>
                <Link
                  href={x.key === 'overview' ? `/clients/${clientId}` : `/clients/${clientId}?tab=${x.key}`}
                  scroll={false}
                  aria-current={tab === x.key ? 'page' : undefined}
                  className={cn(
                    '-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap',
                    tab === x.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                  data-testid={`client-tab-${x.key}`}
                >
                  <x.icon className="size-4" aria-hidden />
                  {t(`clients.tabs.${x.key}`)}
                </Link>
              </li>
            ))}
        </ul>
      </nav>

      {tab === 'overview' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-6">
            {c360 ? (
              <Client360View data={c360} canSla={Boolean(ctx.flags['module.requests']) && can(ctx.permissions, 'requests:read')} />
            ) : null}
            <PackageUsageCard usage={detail.usage} compact />
            <section>
              <SectionTitle title={t('clients.company')} />
              <CompanyInfoCard
                industry={c.industry}
                city={c.city}
                website={c.website}
                social={c.social as Record<string, string>}
                startDate={c.startDate}
              />
            </section>
          </div>
          <aside className="space-y-6">
            <AccountManagerCard manager={detail.accountManager} />
            <section>
              <SectionTitle title={t('clients.team')} />
              <Card className="p-4">
                {detail.team.length ? (
                  <ul className="space-y-3">
                    {detail.team.map((m) => (
                      <li key={m.userId} className="flex items-center gap-3">
                        <Avatar name={m.name} src={publicAssetUrl(m.avatarPath)} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{m.name}</span>
                          <span className="block truncate text-xs text-subtle-foreground">{m.jobTitle}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('clients.noTeam')}</p>
                )}
                {detail.team.length > 0 ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <AvatarGroup people={detail.team.map((m) => ({ id: m.userId, name: m.name, src: publicAssetUrl(m.avatarPath) }))} />
                  </div>
                ) : null}
              </Card>
            </section>
            <InternalNotesCard notes={detail.notes} />
          </aside>
        </div>
      ) : null}

      {tab === 'users' ? (
        <UsersTab
          clientId={clientId}
          clientName={name}
          canManage={can(ctx.permissions, 'client_users:manage')}
          meUserId={ctx.session.userId}
        />
      ) : null}

      {tab === 'package' ? (
        <PackageTab
          clientId={clientId}
          canAssign={can(ctx.permissions, 'packages:assign')}
          usage={detail.usage}
          history={detail.packageHistory.map((h) => ({
            ...h,
            label: localized(h.packageName, locale),
            range: `${f.date(h.periodStart)} – ${f.date(h.periodEnd)}`,
          }))}
          ctx={ctx}
        />
      ) : null}

      {tab === 'files' ? (
        <FilesTab clientId={clientId} canUpload={can(ctx.permissions, 'files:upload')} canManage={can(ctx.permissions, 'files:manage')} />
      ) : null}

      {tab === 'messages' ? (
        <MessagesTab
          clientId={clientId}
          clientName={name}
          threadId={sp.thread}
          meUserId={ctx.session.userId}
          canWrite={can(ctx.permissions, 'messages:send')}
        />
      ) : null}
      {tab === 'requests' && ctx.flags['module.requests'] && can(ctx.permissions, 'requests:read') ? (
        <RequestsTab ctx={ctx} clientId={clientId} />
      ) : null}
      {tab === 'campaigns' && ctx.flags['module.campaigns'] && can(ctx.permissions, 'campaigns:read') ? (
        <CampaignList campaigns={await listCampaigns({ clientId })} showClient={false} showSummary={false} />
      ) : null}
    </div>
  );
}

async function RequestsTab({ ctx, clientId }: { ctx: AgencyContext; clientId: string }) {
  const [requests, people] = await Promise.all([listRequests({ clientId }), listAgencyPeople(ctx)]);
  return (
    <RequestsInbox
      requests={requests}
      me={ctx.session.userId}
      people={people.map((p) => ({ id: p.id, name: p.name, avatarPath: p.avatar_path }))}
      canTriage={can(ctx.permissions, 'requests:triage')}
      showClient={false}
      initialView="all"
    />
  );
}

async function UsersTab({
  clientId,
  clientName,
  canManage,
  meUserId,
}: {
  clientId: string;
  clientName: string;
  canManage: boolean;
  meUserId: string;
}) {
  const data = await listClientUsers(clientId);
  return (
    <ClientUsersManager
      clientId={clientId}
      clientName={clientName}
      users={data.users}
      invitations={data.invitations}
      roles={data.roles}
      canManage={canManage}
      meUserId={meUserId}
    />
  );
}

async function PackageTab({
  clientId,
  canAssign,
  usage,
  history,
  ctx,
}: {
  clientId: string;
  canAssign: boolean;
  usage: PackageUsage | null;
  history: { id: string; label: string; range: string }[];
  ctx: Parameters<typeof listPackages>[0];
}) {
  const t = await getTranslations('clients');
  const packages = canAssign ? await listPackages(ctx) : [];
  return (
    <div className="space-y-6">
      <PackageUsageCard
        usage={usage}
        action={
          canAssign && usage ? (
            <RecordUsageDialog clientId={clientId} clientPackageId={usage.clientPackageId} itemTypes={usage.items.map((i) => i.itemType)} />
          ) : null
        }
        emptyAction={canAssign ? <AssignPackageDialog clientId={clientId} packages={packages} /> : null}
      />
      <section>
        <SectionTitle
          title={t('packageHistory')}
          action={canAssign ? <AssignPackageDialog clientId={clientId} packages={packages} /> : null}
        />
        <Card className="divide-y divide-border">
          {history.length ? (
            history.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="font-medium">{h.label}</span>
                <span className="tabular text-muted-foreground">{h.range}</span>
              </div>
            ))
          ) : (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('noPackageHistory')}</p>
          )}
        </Card>
      </section>
    </div>
  );
}

async function FilesTab({ clientId, canUpload, canManage }: { clientId: string; canUpload: boolean; canManage: boolean }) {
  const library = await listClientLibrary(clientId);
  return (
    <FileBrowser
      clientId={clientId}
      folders={library.folders}
      files={library.files}
      side="agency"
      canUpload={canUpload}
      canManage={canManage}
    />
  );
}

async function MessagesTab({
  clientId,
  clientName,
  threadId,
  meUserId,
  canWrite,
}: {
  clientId: string;
  clientName: string;
  threadId?: string;
  meUserId: string;
  canWrite: boolean;
}) {
  const threads = await listThreads({ clientId });
  const active = threadId && /^[0-9a-f-]{36}$/.test(threadId) ? await getThread(threadId) : null;
  return (
    <ThreadsView
      threads={threads}
      active={active && active.thread.clientId === clientId ? active : null}
      me={{ userId: meUserId }}
      side="agency"
      canWrite={canWrite}
      clients={[{ id: clientId, name: clientName }]}
      showClientName={false}
      basePath={`/clients/${clientId}?tab=messages&`}
      height="h-[calc(100dvh-18rem)] min-h-[32rem]"
    />
  );
}
