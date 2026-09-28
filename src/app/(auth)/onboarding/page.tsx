import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { getSession } from '@/lib/auth/session';
import { withRls } from '@/lib/db/rls';
import { OnboardingWizard } from '@/modules/identity/components/onboarding-wizard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('onboarding');
  return { title: t('title') };
}

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const profile = await withRls(
    (tx) => tx.query.profiles.findFirst({ where: (p, { eq }) => eq(p.id, session.userId) }),
    session,
  );
  if (!profile) redirect('/auth/signout?reason=no_access');
  if (profile.onboardedAt) redirect(session.app.user_type === 'client' ? '/portal' : '/dashboard');
  const locale = await getLocale();
  return (
    <OnboardingWizard
      defaults={{
        fullName: profile.fullName,
        phone: profile.phone ?? '',
        whatsapp: profile.whatsapp ?? '',
        avatarPath: profile.avatarPath,
        locale,
        theme: (profile.theme as 'system' | 'light' | 'dark') ?? 'system',
      }}
    />
  );
}
