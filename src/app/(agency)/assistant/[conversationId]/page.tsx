import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { requireAgency } from '@/lib/auth/context';
import { Assistant } from '@/modules/ai/components/assistant';
import { getConversation, listConversations } from '@/modules/ai/server/assistant';
import { getAiAvailability } from '@/modules/ai/server/queries';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('assistant') };
}

export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  if (!isUuid(conversationId)) notFound();
  const ctx = await requireAgency('ai:use');
  if (!ctx.flags['module.ai']) notFound();
  const [conversation, conversations, ai, t] = await Promise.all([
    getConversation(conversationId),
    listConversations(),
    getAiAvailability(ctx),
    getTranslations('ai.assistant'),
  ]);
  if (!conversation) notFound();
  return (
    <>
      <BreadcrumbLabel segment={conversationId} label={conversation.title} />
      <PageHeader title={t('title')} description={t('description')} />
      <Assistant conversations={conversations} conversation={conversation} usable={ai.usable} />
    </>
  );
}
