import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { SalesDashboard } from '@/modules/crm/components/sales-dashboard';
import { SalesFilters } from '@/modules/crm/components/sales-filters';
import { salesPeriods, type SalesPeriod } from '@/modules/crm/constants';
import { getSalesData } from '@/modules/crm/server/dashboard';
import { getCrmOptions } from '@/modules/crm/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('salesDashboard') };
}

const uuid = /^[0-9a-f-]{36}$/;

export default async function SalesDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; owner?: string; pipeline?: string }>;
}) {
  const ctx = await requireAgency('deals:read');
  if (!ctx.flags['module.crm']) notFound();
  const sp = await searchParams;
  const period: SalesPeriod = salesPeriods.find((p) => p === sp.period) ?? 'month';
  const manageAll = can(ctx.permissions, 'crm:manage_all');
  const ownerId = manageAll && sp.owner && uuid.test(sp.owner) ? sp.owner : null;
  const [data, options, t] = await Promise.all([
    getSalesData(ctx, { period, ownerId, pipelineId: sp.pipeline && uuid.test(sp.pipeline) ? sp.pipeline : null }),
    getCrmOptions(ctx),
    getTranslations('crm.dashboard'),
  ]);
  if (!data) notFound();
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <SalesFilters
            period={period}
            ownerId={ownerId}
            pipelineId={data.pipeline.id}
            owners={manageAll ? options.owners : null}
            pipelines={data.pipelines.map((p) => ({ id: p.id, name: p.name }))}
          />
        }
      />
      <SalesDashboard data={data} showPeople={manageAll && !ownerId} />
    </div>
  );
}
