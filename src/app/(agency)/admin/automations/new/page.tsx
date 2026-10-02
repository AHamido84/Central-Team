import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { AutomationBuilder } from '@/modules/automations/components/automation-builder';
import { webhookSigningKey } from '@/modules/automations/server/engine';
import { getBuilderOptions } from '@/modules/automations/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('automations');
  return { title: t('new') };
}

export default async function NewAutomationPage() {
  const ctx = await requireAgency('automations:manage');
  if (!ctx.flags['module.integrations']) notFound();
  const [options, t] = await Promise.all([getBuilderOptions(ctx.organization.id), getTranslations('automations')]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('new')} description={t('newDescription')} />
      <AutomationBuilder automation={null} options={options} events={[]} signingKey={webhookSigningKey(ctx.organization.id)} canManage />
    </div>
  );
}
