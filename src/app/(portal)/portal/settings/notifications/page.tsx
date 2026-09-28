import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { NotificationSettingsPage } from '@/modules/identity/server/settings-pages';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('notificationSettings') };
}

export default function Page() {
  return <NotificationSettingsPage base="/portal/settings" />;
}
