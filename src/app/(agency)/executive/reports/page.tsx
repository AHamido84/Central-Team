import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgencyAny } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { BoardReports } from '@/modules/executive/components/board-reports';
import { listSchedules } from '@/modules/executive/server/queries';

// "Send now" renders the PDF in this route's server action.
export const maxDuration = 60;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('executive.reports');
  return { title: t('title') };
}

export default async function BoardReportsPage() {
  const ctx = await requireAgencyAny(['executive:export', 'executive:schedule']);
  const canSchedule = can(ctx.permissions, 'executive:schedule');
  const [schedules, t] = await Promise.all([canSchedule ? listSchedules() : [], getTranslations('executive.reports')]);
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <BoardReports schedules={schedules} canExport={can(ctx.permissions, 'executive:export')} canSchedule={canSchedule} />
    </div>
  );
}
