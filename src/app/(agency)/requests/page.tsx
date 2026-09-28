import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { listAgencyPeople } from '@/modules/clients/server/queries';
import { RequestsInbox } from '@/modules/requests/components/requests-inbox';
import { inboxViews, type InboxView } from '@/modules/requests/constants';
import { listRequests } from '@/modules/requests/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('requests') };
}

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireAgency('requests:read');
  if (!ctx.flags['module.requests']) notFound();
  const { view } = await searchParams;
  const t = await getTranslations('requests');
  const [requests, people] = await Promise.all([listRequests(), listAgencyPeople(ctx)]);
  return (
    <>
      <PageHeader title={t('inboxTitle')} description={t('inboxDescription')} />
      <RequestsInbox
        requests={requests}
        me={ctx.session.userId}
        people={people.map((p) => ({ id: p.id, name: p.name, avatarPath: p.avatar_path }))}
        canTriage={can(ctx.permissions, 'requests:triage')}
        initialView={inboxViews.includes(view as InboxView) ? (view as InboxView) : 'new'}
      />
    </>
  );
}
