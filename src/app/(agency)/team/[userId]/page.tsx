import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { PageHeader } from '@/components/patterns';
import { Avatar, Badge } from '@/components/ui/primitives';
import { requireAgency } from '@/lib/auth/context';
import { localized } from '@/lib/i18n/localized';
import { getFormatters } from '@/lib/i18n/server-format';
import { publicAssetUrl } from '@/lib/storage';
import { TeamMemberView } from '@/modules/operations/components/team-member';
import { getTeamMember } from '@/modules/operations/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('team') };
}

export default async function TeamMemberPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(userId)) notFound();
  const ctx = await requireAgency('operations:read');
  const data = await getTeamMember(ctx, userId);
  if (!data) notFound();
  const t = await getTranslations('operations.team');
  const f = await getFormatters();
  return (
    <div className="space-y-6">
      <BreadcrumbLabel segment={userId} label={data.name} />
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar name={data.name} src={publicAssetUrl(data.avatarPath)} size="lg" />
            <span>{data.name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            {data.jobTitle ? <span>{data.jobTitle}</span> : null}
            {data.departments.map((d) => (
              <Badge key={d.id} tone="neutral">
                {localized(d.name, f.locale)}
                {d.isLead ? ` · ${t('lead')}` : ''}
              </Badge>
            ))}
          </span>
        }
      />
      <TeamMemberView data={data} />
    </div>
  );
}
