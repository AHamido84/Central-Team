import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { InsightDetail } from '@/modules/ai/components/insight-detail';
import { getAiAvailability, getInsight } from '@/modules/ai/server/queries';
import { listAgencyPeople } from '@/modules/clients/server/queries';
import { addDays, dayInZone } from '@/modules/tasks/constants';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('insights') };
}

export default async function InsightPage({ params }: { params: Promise<{ insightId: string }> }) {
  const { insightId } = await params;
  if (!isUuid(insightId)) notFound();
  const ctx = await requireAgency('campaigns:read');
  if (!ctx.flags['module.ai']) notFound();
  const insight = await getInsight(insightId);
  if (!insight) notFound();
  const canManage = can(ctx.permissions, 'campaigns:manage');
  const [ai, people, t] = await Promise.all([
    getAiAvailability(ctx),
    canManage ? listAgencyPeople(ctx) : Promise.resolve([]),
    getTranslations('ai'),
  ]);
  return (
    <>
      <BreadcrumbLabel segment={insightId} label={t(`kind.${insight.kind}`)} />
      <InsightDetail
        insight={insight}
        canManage={canManage}
        canCreateTasks={can(ctx.permissions, 'tasks:create')}
        aiUsable={ai.usable}
        people={people.map((p) => ({ id: p.id, name: p.name }))}
        defaultDue={addDays(dayInZone(new Date(), ctx.organization.defaultTimezone), 3)}
      />
    </>
  );
}
