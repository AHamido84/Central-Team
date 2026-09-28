import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requirePortal } from '@/lib/auth/context';
import { getLocale } from 'next-intl/server';

import { localized, type Locale } from '@/lib/i18n/localized';
import { can } from '@/lib/permissions/can';
import { ThreadsView } from '@/modules/messaging/components/threads-view';
import { getThread, listThreads } from '@/modules/messaging/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('messaging');
  return { title: t('title') };
}

export default async function PortalMessagesPage({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const ctx = await requirePortal();
  if (!ctx.flags['module.messages']) notFound();
  const { thread } = await searchParams;
  const t = await getTranslations('messaging');
  const [threads, active] = await Promise.all([
    listThreads({ clientId: ctx.client.id }),
    thread && /^[0-9a-f-]{36}$/.test(thread) ? getThread(thread) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader title={t('title')} description={t('portalDescription')} />
      <ThreadsView
        threads={threads}
        active={active && active.thread.clientId === ctx.client.id ? active : null}
        me={{ userId: ctx.session.userId }}
        side="client"
        canWrite={can(ctx.permissions, 'portal_messages:send')}
        clients={[{ id: ctx.client.id, name: localized(ctx.client.name, (await getLocale()) as Locale) }]}
        showClientName={false}
        basePath="/portal/messages?"
        height="h-[calc(100dvh-16rem)] min-h-[28rem] lg:h-[calc(100dvh-14rem)]"
      />
    </>
  );
}
