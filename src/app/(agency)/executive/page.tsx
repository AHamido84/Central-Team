import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { Badge } from '@/components/ui/primitives';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { parseViewConfig, viewSearch } from '@/modules/executive/config';
import { ExecutiveCenter } from '@/modules/executive/components/executive-center';
import { getExecutiveReport } from '@/modules/executive/server/data';
import { listNotes, listViews } from '@/modules/executive/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('executive');
  return { title: t('title') };
}

export default async function ExecutivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireAgency('executive:view');
  const config = parseViewConfig(await searchParams);
  const [report, views, notes, t] = await Promise.all([
    getExecutiveReport(ctx, config),
    listViews(),
    listNotes(),
    getTranslations('executive'),
  ]);
  const readOnly = !can(ctx.permissions, 'tasks:update') && !can(ctx.permissions, 'clients:update');
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')}>
        {readOnly ? <Badge tone="info">{t('readOnly')}</Badge> : null}
      </PageHeader>
      <ExecutiveCenter
        key={viewSearch(config)}
        report={report}
        canUseAi={Boolean(ctx.flags['module.ai']) && can(ctx.permissions, 'ai:use')}
        canExport={can(ctx.permissions, 'executive:export')}
        views={views}
        notes={notes}
        me={ctx.session.userId}
        updatedAt={new Date().toISOString()}
      />
    </div>
  );
}
