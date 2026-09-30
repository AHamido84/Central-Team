import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { InsightList } from '@/modules/ai/components/insight-list';
import {
  insightKinds,
  insightSeverities,
  insightStatuses,
  type InsightKind,
  type InsightSeverity,
  type InsightStatus,
} from '@/modules/ai/insights-core';
import { listInsights } from '@/modules/ai/server/queries';
import { listClients } from '@/modules/clients/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('insights') };
}

const isUuid = (v?: string) => Boolean(v && /^[0-9a-f-]{36}$/.test(v));
const oneOf = <T extends string>(list: readonly T[], v?: string): T | undefined =>
  v && (list as readonly string[]).includes(v) ? (v as T) : undefined;

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; campaignId?: string; severity?: string; kind?: string; status?: string }>;
}) {
  const ctx = await requireAgency('campaigns:read');
  if (!ctx.flags['module.ai']) notFound();
  const sp = await searchParams;
  const filters = {
    clientId: isUuid(sp.clientId) ? sp.clientId : undefined,
    campaignId: isUuid(sp.campaignId) ? sp.campaignId : undefined,
    severity: oneOf<InsightSeverity>(insightSeverities, sp.severity),
    kind: oneOf<InsightKind>(insightKinds, sp.kind),
    status: sp.status === 'all' ? ('all' as const) : oneOf<InsightStatus>(insightStatuses, sp.status),
  };
  const [items, clients, t] = await Promise.all([listInsights(filters), listClients(ctx), getTranslations('ai.insights')]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <InsightList
        items={items}
        filters={{ clientId: filters.clientId, severity: filters.severity, kind: filters.kind, status: filters.status }}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
      />
    </>
  );
}
