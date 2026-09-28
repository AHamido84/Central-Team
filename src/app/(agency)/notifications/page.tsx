import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requireAgency } from '@/lib/auth/context';
import { NotificationsInbox } from '@/modules/notifications/components/notifications-inbox';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notifications');
  return { title: t('inboxTitle') };
}

export default async function NotificationsPage() {
  const ctx = await requireAgency();
  return <NotificationsInbox userId={ctx.session.userId} />;
}
