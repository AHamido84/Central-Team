import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { Assistant } from '@/modules/ai/components/assistant';
import { listConversations } from '@/modules/ai/server/assistant';
import { getAiAvailability } from '@/modules/ai/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('assistant') };
}

export default async function AssistantPage() {
  const ctx = await requireAgency('ai:use');
  if (!ctx.flags['module.ai']) notFound();
  const [conversations, ai, t] = await Promise.all([listConversations(), getAiAvailability(ctx), getTranslations('ai.assistant')]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <Assistant conversations={conversations} conversation={null} usable={ai.usable} />
    </>
  );
}
