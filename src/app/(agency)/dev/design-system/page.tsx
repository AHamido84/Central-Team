import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { requireAgency } from '@/lib/auth/context';
import { DesignSystemShowcase, type PanelStrings } from '@/modules/design-system/components/showcase';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('designSystem') };
}

async function panelStrings(locale: 'ar' | 'en'): Promise<PanelStrings> {
  const t = await getTranslations({ locale, namespace: 'designSystem' });
  return {
    title: t('panelTitle'),
    body: t('panelBody'),
    primary: t('panelPrimary'),
    secondary: t('panelSecondary'),
    input: t('placeholder'),
    badge: t('panelBadge'),
    stat: t('panelStat'),
  };
}

export default async function DesignSystemPage() {
  const ctx = await requireAgency('design_system:view');
  if (!ctx.flags['dev.design_system']) notFound();
  const [ar, en] = await Promise.all([panelStrings('ar'), panelStrings('en')]);
  return <DesignSystemShowcase panels={{ ar, en }} />;
}
