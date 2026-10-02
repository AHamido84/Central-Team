import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { requireAgencyAny } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { AutomationBuilder } from '@/modules/automations/components/automation-builder';
import { webhookSigningKey } from '@/modules/automations/server/engine';
import { getAutomation, getBuilderOptions, recentEvents } from '@/modules/automations/server/queries';

const uuid = /^[0-9a-f-]{36}$/;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('automations') };
}

export default async function AutomationPage({
  params,
  searchParams,
}: {
  params: Promise<{ automationId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ automationId }, { tab }] = await Promise.all([params, searchParams]);
  if (!uuid.test(automationId)) notFound();
  const ctx = await requireAgencyAny(['automations:read', 'automations:manage']);
  if (!ctx.flags['module.integrations']) notFound();
  const automation = await getAutomation(automationId);
  if (!automation) notFound();
  const canManage = can(ctx.permissions, 'automations:manage');
  const [options, events, t] = await Promise.all([
    getBuilderOptions(ctx.organization.id),
    canManage ? recentEvents(ctx.organization.id, automation.triggerType) : Promise.resolve([]),
    getTranslations('automations'),
  ]);
  return (
    <div className="mx-auto max-w-4xl">
      <BreadcrumbLabel segment={automationId} label={automation.name} />
      <PageHeader
        title={<bdi>{automation.name}</bdi>}
        description={t('stats', { runs: automation.runCount, failures: automation.failureCount })}
      />
      <AutomationBuilder
        automation={automation}
        options={options}
        events={events}
        signingKey={canManage ? webhookSigningKey(ctx.organization.id) : ''}
        canManage={canManage}
        initialTab={tab === 'runs' || tab === 'test' ? tab : 'rule'}
      />
    </div>
  );
}
