import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import Link from 'next/link';
import { breachViews, type BreachView } from '@/modules/sla/constants';
import { SlaFilters, SlaMonitor } from '@/modules/sla/components/sla-monitor';
import { getSlaMonitor, listClientOptions } from '@/modules/sla/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('slaMonitor') };
}

const uuid = /^[0-9a-f-]{36}$/;

export default async function SlaMonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; view?: string; client?: string }>;
}) {
  const ctx = await requireAgency('operations:read');
  if (!ctx.flags['module.requests'] || !can(ctx.permissions, 'requests:read')) notFound();
  const sp = await searchParams;
  const days = sp.days === '90' ? 90 : 30;
  const view: BreachView = breachViews.includes(sp.view as BreachView) ? (sp.view as BreachView) : 'open';
  const clientId = sp.client && uuid.test(sp.client) ? sp.client : undefined;
  const t = await getTranslations();
  const [data, clients] = await Promise.all([getSlaMonitor(ctx, { days, view, clientId }), listClientOptions(ctx)]);
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('sla.monitor.title')}
        description={t('sla.monitor.description')}
        actions={
          can(ctx.permissions, 'sla:manage') ? (
            <Button asChild variant="outline">
              <Link href="/admin/sla">{t('nav.slaPolicies')}</Link>
            </Button>
          ) : null
        }
      />
      <SlaFilters days={days} clientId={clientId ?? null} clients={clients} />
      <SlaMonitor data={data} view={view} canAcknowledge />
    </div>
  );
}
