import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ConnectionsSettingsPage } from '@/modules/identity/server/settings-pages';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('myConnections') };
}

export default function Page() {
  return <ConnectionsSettingsPage />;
}
