import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgencyAny } from '@/lib/auth/context';
import { localized, type Locale } from '@/lib/i18n/localized';
import { can } from '@/lib/permissions/can';
import { listClients } from '@/modules/clients/server/queries';
import { ThreadsView } from '@/modules/messaging/components/threads-view';
import { getThread, listThreads } from '@/modules/messaging/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('messages') };
}

export default async function AgencyMessagesPage({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const ctx = await requireAgencyAny(['clients:read_all', 'clients:read_assigned']);
  const { thread } = await searchParams;
  const t = await getTranslations('messaging');
  const locale = (await getLocale()) as Locale;
  const [threads, clients, active] = await Promise.all([
    listThreads(),
    listClients(ctx),
    thread && /^[0-9a-f-]{36}$/.test(thread) ? getThread(thread) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader title={t('title')} description={t('agencyDescription')} />
      <ThreadsView
        threads={threads}
        active={active}
        me={{ userId: ctx.session.userId }}
        side="agency"
        canWrite={can(ctx.permissions, 'messages:send')}
        clients={clients.filter((c) => c.status !== 'archived').map((c) => ({ id: c.id, name: localized(c.name, locale) }))}
        showClientName
        basePath="/messages?"
      />
    </>
  );
}
