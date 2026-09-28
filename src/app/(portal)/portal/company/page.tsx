import { Building2, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requirePortal } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import { localized, type Locale } from '@/lib/i18n/localized';
import { can } from '@/lib/permissions/can';
import { cn } from '@/lib/utils/cn';
import { CompanyInfoCard } from '@/modules/clients/components/client-overview';
import { ClientForm } from '@/modules/clients/components/client-form';
import { ClientUsersManager } from '@/modules/clients/components/client-users-manager';
import { listClientUsers } from '@/modules/clients/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('portal.company');
  return { title: t('title') };
}

export default async function CompanyPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePortal();
  const { tab: rawTab } = await searchParams;
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const canSeeTeam = can(ctx.permissions, 'portal_users:read');
  const tab = rawTab === 'team' && canSeeTeam ? 'team' : 'profile';
  const client = await withRls((tx) => tx.query.clients.findFirst({ where: (c, { eq }) => eq(c.id, ctx.client.id) }));
  if (!client) return null;
  const canEdit = can(ctx.permissions, 'portal_company:update');
  const tabs = [
    { key: 'profile', label: t('portal.company.profileTab'), icon: Building2 },
    ...(canSeeTeam ? [{ key: 'team', label: t('portal.company.teamTab'), icon: Users }] : []),
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={t('portal.company.title')}
        description={t('portal.company.description', { client: localized(client.name, locale) })}
      />
      <nav className="-mx-(--gutter) overflow-x-auto px-(--gutter)" aria-label={t('portal.company.title')}>
        <ul className="flex gap-1 border-b border-border">
          {tabs.map((x) => (
            <li key={x.key}>
              <Link
                href={x.key === 'profile' ? '/portal/company' : '/portal/company?tab=team'}
                aria-current={tab === x.key ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium',
                  tab === x.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
                data-testid={`company-tab-${x.key}`}
              >
                <x.icon className="size-4" aria-hidden />
                {x.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'profile' ? (
        canEdit ? (
          <ClientForm
            mode="portal"
            clientId={client.id}
            people={[]}
            defaults={{
              nameAr: client.name.ar ?? '',
              nameEn: client.name.en ?? '',
              industry: client.industry ?? '',
              city: client.city ?? '',
              website: client.website ?? '',
              social: client.social as Record<string, string>,
              logoPath: client.logoPath,
              status: client.status as 'active',
              accountManagerId: '',
              startDate: '',
              notes: '',
              teamIds: [],
            }}
          />
        ) : (
          <CompanyInfoCard
            industry={client.industry}
            city={client.city}
            website={client.website}
            social={client.social as Record<string, string>}
          />
        )
      ) : (
        <TeamTab
          clientId={client.id}
          clientName={localized(client.name, locale)}
          canManage={can(ctx.permissions, 'portal_users:manage')}
          meUserId={ctx.session.userId}
        />
      )}
    </div>
  );
}

async function TeamTab({
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
