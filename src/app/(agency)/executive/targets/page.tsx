import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgencyAny } from '@/lib/auth/context';
import { TargetsForm } from '@/modules/executive/components/targets-form';
import { listTargets } from '@/modules/executive/server/queries';
import { dayInZone } from '@/modules/tasks/constants';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('executive.targets');
  return { title: t('title') };
}

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const ctx = await requireAgencyAny(['executive:schedule', 'organization:update']);
  const current = Number(dayInZone(new Date(), ctx.organization.defaultTimezone).slice(0, 4));
  const asked = Number((await searchParams).year);
  const year = Number.isInteger(asked) && asked >= current - 5 && asked <= current + 2 ? asked : current;
  const [rows, t] = await Promise.all([listTargets(ctx, year), getTranslations('executive.targets')]);
  const years = Array.from({ length: 8 }, (_, i) => current + 2 - i);
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <TargetsForm key={year} year={year} years={years} rows={rows} />
    </div>
  );
}
