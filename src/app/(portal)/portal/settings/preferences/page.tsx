import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PreferencesSettingsPage } from '@/modules/identity/server/settings-pages';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('preferences') };
}

export default function Page() {
  return <PreferencesSettingsPage base="/portal/settings" />;
}
