import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { ReportCreateDialog } from '@/modules/campaigns/components/report-create-dialog';
import { ReportList } from '@/modules/campaigns/components/report-list';
import { SchedulesPanel } from '@/modules/campaigns/components/schedules-panel';
import { listCampaignOptions, listReports, listSchedules } from '@/modules/campaigns/server/queries';
import { listClients } from '@/modules/clients/server/queries';
import { dayInZone } from '@/modules/tasks/constants';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('reports') };
}

export default async function ReportsPage() {
  const ctx = await requireAgency('campaigns:read');
  if (!ctx.flags['module.campaigns']) notFound();
  const t = await getTranslations('reports');
  const canManage = can(ctx.permissions, 'reports:manage');
  const [reports, schedules, clients, campaigns] = await Promise.all([
    listReports(),
    listSchedules(),
    listClients(ctx),
    listCampaignOptions(),
  ]);
  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canManage ? (
            <ReportCreateDialog
              trigger={
                <Button data-testid="new-report">
                  <Plus aria-hidden />
                  {t('list.new')}
                </Button>
              }
              clients={clientOptions}
              campaigns={campaigns}
              today={dayInZone(new Date(), ctx.organization.defaultTimezone)}
            />
          ) : null
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <ReportList reports={reports} hrefBase="/reports" emptyBody={t('list.emptyBody')} />
        <SchedulesPanel schedules={schedules} clients={clientOptions} campaigns={campaigns} canManage={canManage} />
      </div>
    </>
  );
}
