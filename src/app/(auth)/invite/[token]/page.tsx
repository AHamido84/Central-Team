import { Clock, LinkIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';

import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { localized } from '@/lib/i18n/localized';
import { AcceptInvitationForm } from '@/modules/invitations/components/accept-invitation-form';
import { getInvitationPreview } from '@/modules/invitations/server/accept';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('inviteTitle') };
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations('auth');
  const locale = await getLocale();
  const preview = await getInvitationPreview(token);

  if (preview.status !== 'valid') {
    const expired = preview.status === 'expired';
    return (
      <div data-testid="invite-invalid">
        <EmptyState
          icon={expired ? Clock : LinkIcon}
          title={expired ? t('inviteExpiredTitle') : t('inviteInvalidTitle')}
          description={expired ? t('inviteExpiredBody') : t('inviteInvalidBody')}
          action={
            <Button asChild variant="outline">
              <Link href="/login">{t('backToLogin')}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const org = localized(preview.organizationName, locale);
  const client = preview.clientName ? localized(preview.clientName, locale) : null;
  return (
    <div data-testid="invite-valid">
      <p className="text-sm font-medium text-primary">{client ? t('invitePortalEyebrow') : t('inviteTeamEyebrow')}</p>
      <h1 className="mt-2 text-h1 font-semibold tracking-tight text-balance">
        {client ? t('invitePortalTitle', { client }) : t('inviteTeamTitle', { org })}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {preview.inviterName ? t('invitedBy', { name: preview.inviterName, org }) : t('invitedByOrg', { org })}
      </p>
      {preview.existingAccount ? <p className="mt-3 rounded-md bg-info-soft px-3 py-2 text-sm text-info">{t('inviteExistingAccount')}</p> : null}
      <AcceptInvitationForm token={token} email={preview.email} defaultName={preview.fullName ?? ''} />
    </div>
  );
}
