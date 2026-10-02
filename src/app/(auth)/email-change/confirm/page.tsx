import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ConfirmPortalEmail } from '@/modules/clients/components/confirm-portal-email';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.emailChange');
  return { title: t('confirmTitle') };
}

/**
 * Where an admin's "ask the user to confirm" link lands (FR4.1, ADR-092). Nothing happens on load — mail scanners
 * open links — the person presses the button.
 */
export default async function ConfirmPortalEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <ConfirmPortalEmail token={token ?? ''} />;
}
