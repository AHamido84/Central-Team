import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { TeamTable } from '@/modules/operations/components/team-table';
import { getTeamOverview } from '@/modules/operations/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('team') };
}

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ department?: string }> }) {
  const ctx = await requireAgency('operations:read');
  const { department } = await searchParams;
  const t = await getTranslations('operations.team');
  const data = await getTeamOverview(ctx);
  const valid = data.departments.some((d) => d.id === department) ? department! : null;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <TeamTable data={data} department={valid} />
    </>
  );
}
