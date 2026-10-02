'use client';

import { CheckCircle2, Clock, MailCheck, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { confirmPortalEmailChangeAction } from '@/modules/clients/server/portal-user-actions';

type Status = 'idle' | 'done' | 'invalid' | 'expired' | 'in_use' | 'rate_limited';

const view = {
  idle: { icon: MailCheck, tone: 'text-primary', title: 'confirmTitle', body: 'confirmBody' },
  done: { icon: CheckCircle2, tone: 'text-success', title: 'adminDoneTitle', body: 'adminDoneBody' },
  invalid: { icon: XCircle, tone: 'text-danger', title: 'invalidTitle', body: 'invalidBody' },
  expired: { icon: Clock, tone: 'text-warning', title: 'expiredTitle', body: 'expiredBody' },
  in_use: { icon: XCircle, tone: 'text-danger', title: 'inUseTitle', body: 'inUseBody' },
  rate_limited: { icon: Clock, tone: 'text-warning', title: 'invalidTitle', body: 'invalidBody' },
} as const;

export function ConfirmPortalEmail({ token }: { token: string }) {
  const t = useTranslations('auth.emailChange');
  const te = useTranslations('errors');
  const [status, setStatus] = useState<Status>(token ? 'idle' : 'invalid');
  const [pending, setPending] = useState(false);
  const v = view[status];
  const Icon = v.icon;
  return (
    <div className="text-center" data-testid="portal-email-confirm" data-status={status}>
      <Icon className={`mx-auto size-12 ${v.tone}`} aria-hidden />
      <h1 className="mt-4 text-xl font-semibold">{t(v.title)}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{status === 'rate_limited' ? te('rate_limited') : t(v.body)}</p>
      {status === 'idle' ? (
        <Button
          className="mt-6"
          loading={pending}
          onClick={async () => {
            setPending(true);
            try {
              const res = await confirmPortalEmailChangeAction({ token });
              setStatus(res.status);
            } catch {
              setStatus('invalid');
            } finally {
              setPending(false);
            }
          }}
          data-testid="portal-email-confirm-submit"
        >
          <MailCheck />
          {t('confirmCta')}
        </Button>
      ) : (
        <Button asChild className="mt-6" variant={status === 'done' ? 'primary' : 'outline'}>
          <Link href="/login">{t('toLogin')}</Link>
        </Button>
      )}
    </div>
  );
}
