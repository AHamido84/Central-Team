import { CheckCircle2, MailCheck, XCircle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { getSession } from '@/lib/auth/session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth.emailChange');
  return { title: t('title') };
}

const states = {
  done: { icon: CheckCircle2, tone: 'text-success' },
  pending: { icon: MailCheck, tone: 'text-primary' },
  invalid: { icon: XCircle, tone: 'text-danger' },
} as const;
type Status = keyof typeof states;

/** Where both email-change links land (ADR-087): the change is complete, or waits for the other address, or failed. */
export default async function EmailChangePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: raw } = await searchParams;
  const status: Status = raw && raw in states ? (raw as Status) : 'invalid';
  const [t, session] = await Promise.all([getTranslations('auth.emailChange'), getSession()]);
  const { icon: Icon, tone } = states[status];
  const profile = session ? (session.app.user_type === 'client' ? '/portal/settings/profile' : '/settings/profile') : null;
  return (
    <div className="text-center" data-testid="email-change-landing" data-status={status}>
      <Icon className={`mx-auto size-12 ${tone}`} aria-hidden />
      <h1 className="mt-4 text-xl font-semibold">{t(`${status}Title`)}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t(`${status}Body`)}</p>
      <Button asChild className="mt-6">
        <Link href={profile ?? '/login'}>{profile ? t('toSettings') : t('toLogin')}</Link>
      </Button>
    </div>
  );
}
