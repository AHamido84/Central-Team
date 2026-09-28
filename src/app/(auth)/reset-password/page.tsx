import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { getSession } from '@/lib/auth/session';
import { ResetPasswordForm } from '@/modules/identity/components/password-forms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('resetTitle') };
}

export default async function ResetPasswordPage() {
  // The recovery link signs the user in through /auth/confirm; without that session the link was invalid.
  if (!(await getSession())) redirect('/login?error=link_invalid');
  return <ResetPasswordForm />;
}
