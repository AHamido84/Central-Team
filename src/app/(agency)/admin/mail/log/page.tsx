import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { emailKinds, outboxStatuses, type EmailKind, type OutboxStatus } from '@/modules/mail/constants';
import { EmailLog } from '@/modules/mail/components/email-log';
import { MailTabs } from '@/modules/mail/components/mail-tabs';
import { EMAIL_LOG_PAGE, listEmailLog } from '@/modules/mail/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('mail.log');
  return { title: t('title') };
}

export default async function EmailLogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; kind?: string; q?: string; page?: string }>;
}) {
  const ctx = await requireAgency('mail:manage');
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = (outboxStatuses as readonly string[]).includes(sp.status ?? '') ? (sp.status as OutboxStatus) : 'all';
  const kind = (emailKinds as readonly string[]).includes(sp.kind ?? '') ? (sp.kind as EmailKind) : 'all';
  const [log, t] = await Promise.all([listEmailLog(ctx, { status, kind, q: sp.q, page }), getTranslations('mail')]);
  return (
    <>
      <PageHeader title={t('title')} description={t('log.description')} />
      <MailTabs />
      <EmailLog rows={log.rows} total={log.total} page={page} pageSize={EMAIL_LOG_PAGE} />
    </>
  );
}
