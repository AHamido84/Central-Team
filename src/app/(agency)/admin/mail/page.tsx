import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { MailSettings } from '@/modules/mail/components/mail-settings';
import { DevMailNotice, MailTabs } from '@/modules/mail/components/mail-tabs';
import { getMailOverview } from '@/modules/mail/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('mailSettings') };
}

export default async function MailPage() {
  const ctx = await requireAgency('mail:manage');
  const [overview, t] = await Promise.all([getMailOverview(ctx), getTranslations('mail')]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <MailTabs />
      {overview.devMode ? <DevMailNotice mailbox="http://localhost:54324" /> : null}
      <MailSettings overview={overview} me={ctx.profile.email} />
    </>
  );
}
