import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { AiCredentials } from '@/modules/ai/components/ai-credentials';
import { AiSettings } from '@/modules/ai/components/ai-settings';
import { getIndexStatus } from '@/modules/ai/server/indexer';
import { getAiAdmin } from '@/modules/ai/server/queries';

// Server Actions on this page call AI models (ADR-089): the provider timeout (90 s, one retry) and the assistant's
// 200 s deadline end slow calls inside the function's 300 s limit (the Vercel maximum with fluid compute).
export const maxDuration = 300;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('aiSettings') };
}

export default async function AiSettingsPage() {
  const ctx = await requireAgency('ai:manage');
  if (!ctx.flags['module.ai']) notFound();
  // Index counts come from the service connection: they cover the whole organization, not only what this admin can read.
  const [view, index, t] = await Promise.all([
    getAiAdmin(ctx.organization.id),
    getIndexStatus(ctx.organization.id),
    getTranslations('ai.admin'),
  ]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="grid gap-6">
        <AiCredentials credentials={view.credentials} sources={view.sources} envKeys={view.envKeys} />
        <AiSettings view={view} index={index} />
      </div>
    </>
  );
}
