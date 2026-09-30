import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { env } from '@/lib/env';
import { CrmSettings } from '@/modules/crm/components/crm-settings';
import { getCrmOptions, getCrmSettings } from '@/modules/crm/server/queries';
import { dayInZone } from '@/modules/tasks/constants';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('crmSettings') };
}

export default async function CrmSettingsPage() {
  const ctx = await requireAgency('crm:admin');
  if (!ctx.flags['module.crm']) notFound();
  const [data, options, t] = await Promise.all([getCrmSettings(ctx), getCrmOptions(ctx), getTranslations('crm.settings')]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <CrmSettings
        data={data}
        owners={options.owners}
        appUrl={env().NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}
        thisMonth={dayInZone(new Date(), ctx.organization.defaultTimezone).slice(0, 7)}
      />
    </>
  );
}
