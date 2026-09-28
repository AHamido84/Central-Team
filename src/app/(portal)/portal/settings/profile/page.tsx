import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ProfileSettingsPage } from '@/modules/identity/server/settings-pages';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return { title: t('profile') };
}

export default function Page() {
  return <ProfileSettingsPage base="/portal/settings" />;
}
