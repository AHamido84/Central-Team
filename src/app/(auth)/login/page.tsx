import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { LoginForm } from '@/modules/identity/components/login-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('loginTitle') };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const t = await getTranslations('auth');
  const initialError = error === 'link_invalid' ? t('linkInvalid') : error === 'no_access' ? t('noAccess') : undefined;
  return <LoginForm next={next} initialError={initialError} />;
}
