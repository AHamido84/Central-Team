import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { LeadsTable } from '@/modules/crm/components/leads-table';
import { getCrmOptions, listLeads } from '@/modules/crm/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('leads') };
}

export default async function LeadsPage() {
  const ctx = await requireAgency('leads:read');
  if (!ctx.flags['module.crm']) notFound();
  const t = await getTranslations('crm.leads');
  const [leads, options] = await Promise.all([listLeads(ctx), getCrmOptions(ctx)]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <LeadsTable
        leads={leads}
        owners={options.owners}
        me={ctx.session.userId}
        canManage={can(ctx.permissions, 'leads:manage')}
        canManageAll={can(ctx.permissions, 'crm:manage_all')}
        canDelete={can(ctx.permissions, 'leads:delete')}
      />
    </>
  );
}
