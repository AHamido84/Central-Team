'use client';

import { AlertTriangle, ChevronRight, FlaskConical, Link2, MessageCircle, Plug, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { DirIcon, EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Card } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { HealthBadge, ModeBadge } from '@/modules/integrations/components/badges';
import type { ConnectionMode, ProviderKey } from '@/modules/integrations/constants';
import { connectWhatsAppAction, startOAuthAction } from '@/modules/integrations/server/actions';
import type { IntegrationsOverview, ProviderCard } from '@/modules/integrations/server/queries';

/** OAuth: ask the server for the consent URL (state + nonce cookie), then leave for the platform. */
export function useOAuth() {
  const start = useAction(startOAuthAction, { refresh: false });
  return {
    pending: start.pending,
    go: async (provider: Exclude<ProviderKey, 'whatsapp'>, mode: ConnectionMode, connectionId: string | null = null) => {
      const res = await start.run({ provider, mode, connectionId });
      if (res.ok) window.location.assign(res.data.url);
    },
  };
}

export function WhatsAppConnectDialog({
  open,
  onOpenChange,
  connectionId = null,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  connectionId?: string | null;
}) {
  const t = useTranslations('integrations.whatsappConnect');
  const tc = useTranslations('common');
  const router = useRouter();
  const [values, setValues] = useState({ accessToken: '', phoneNumberId: '', wabaId: '' });
  const connect = useAction(connectWhatsAppAction, {
    successMessage: t('connected'),
    onSuccess: (r) => {
      onOpenChange(false);
      router.push(`/admin/integrations/${r.connectionId}`);
    },
  });
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues({ ...values, [k]: e.target.value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void connect.run({ mode: 'live', connectionId, ...values });
          }}
        >
          <DialogBody className="grid gap-4">
            <Field label={t('phoneNumberId')} hint={t('phoneNumberIdHint')} required>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="numeric"
                  value={values.phoneNumberId}
                  onChange={set('phoneNumberId')}
                  autoComplete="off"
                />
              )}
            </Field>
            <Field label={t('wabaId')} required>
              {(p) => <Input {...p} dir="ltr" inputMode="numeric" value={values.wabaId} onChange={set('wabaId')} autoComplete="off" />}
            </Field>
            <Field label={t('accessToken')} hint={t('accessTokenHint')} required>
              {(p) => (
                <Input {...p} dir="ltr" type="password" value={values.accessToken} onChange={set('accessToken')} autoComplete="off" />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={connect.pending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProviderSection({ card, sandbox }: { card: ProviderCard; sandbox: boolean }) {
  const t = useTranslations('integrations');
  const format = useFormat();
  const oauth = useOAuth();
  const router = useRouter();
  const [waOpen, setWaOpen] = useState(false);
  const sandboxWa = useAction(connectWhatsAppAction, {
    successMessage: t('whatsappConnect.connected'),
    onSuccess: (r) => router.push(`/admin/integrations/${r.connectionId}`),
  });
  const configured = card.missingEnv.length === 0;
  const connectLive = () => (card.key === 'whatsapp' ? setWaOpen(true) : void oauth.go(card.key, 'live'));
  const connectSandbox = () =>
    card.key === 'whatsapp'
      ? void sandboxWa.run({ mode: 'sandbox', connectionId: null, accessToken: '', phoneNumberId: '', wabaId: '' })
      : void oauth.go(card.key, 'sandbox');

  return (
    <Card className="flex flex-col" data-testid={`provider-${card.key}`}>
      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
            {card.key === 'whatsapp' ? <MessageCircle className="size-5" aria-hidden /> : <Plug className="size-5" aria-hidden />}
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">{t(`providers.${card.key}.name`)}</h2>
            <p className="text-sm text-muted-foreground">{t(`providers.${card.key}.description`)}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {card.capabilities.map((c) => (
                <Badge key={c} tone="outline">
                  {t(`capabilities.${c as 'ads'}`)}
                </Badge>
              ))}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button size="sm" onClick={connectLive} disabled={!configured} loading={oauth.pending} data-testid={`connect-${card.key}`}>
            <Link2 aria-hidden />
            {t('connect')}
          </Button>
          {sandbox ? (
            <Button
              size="sm"
              variant="outline"
              onClick={connectSandbox}
              loading={sandboxWa.pending}
              data-testid={`connect-sandbox-${card.key}`}
            >
              <FlaskConical aria-hidden />
              {t('connectSandbox')}
            </Button>
          ) : null}
        </div>
      </div>
      {!configured ? (
        <div className="mx-5 mb-4 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {t('notConfigured')}{' '}
            <bdi dir="ltr" className="font-mono">
              {card.missingEnv.join(', ')}
            </bdi>
          </span>
        </div>
      ) : null}
      {card.connections.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {card.connections.map((c) => (
            <li key={c.id}>
              <Link
                href={`/admin/integrations/${c.id}`}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
                data-testid="connection-row"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <bdi className="truncate">{c.name}</bdi>
                    <HealthBadge health={c.health} />
                    <ModeBadge mode={c.mode} />
                  </p>
                  <p className="mt-0.5 text-xs text-subtle-foreground">
                    {t('accountsMapped', { mapped: c.mappedAccounts, total: c.accounts })}
                    {' · '}
                    {c.lastSyncedAt ? t('lastSynced', { when: format.relative(c.lastSyncedAt) }) : t('neverSynced')}
                  </p>
                  {c.health === 'expired' || c.health === 'error' ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-danger">
                      <TriangleAlert className="size-3.5" aria-hidden />
                      {t(`errors.${(c.lastErrorCode ?? 'auth_expired') as 'auth_expired'}`)}
                    </p>
                  ) : null}
                </div>
                <DirIcon icon={ChevronRight} className="size-4 text-subtle-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-border px-5 py-3 text-xs text-subtle-foreground">{t('noConnections')}</p>
      )}
      {card.key === 'whatsapp' ? <WhatsAppConnectDialog open={waOpen} onOpenChange={setWaOpen} /> : null}
    </Card>
  );
}

const callbackErrors = ['oauth_state', 'oauth_denied', 'oauth_failed', 'forbidden', 'validation'] as const;

export function IntegrationsOverviewView({ data }: { data: IntegrationsOverview }) {
  const t = useTranslations('integrations');
  const params = useSearchParams();
  const error = params.get('error');
  const errorText = error
    ? (callbackErrors as readonly string[]).includes(error)
      ? t(`callbackErrors.${error as (typeof callbackErrors)[number]}`)
      : t.has(`errors.${error}` as never)
        ? t(`errors.${error}` as never)
        : t('callbackErrors.oauth_failed')
    : null;
  const total = data.providers.reduce((s, p) => s + p.connections.length, 0);
  return (
    <div className="space-y-6">
      {errorText ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {errorText}
        </div>
      ) : null}
      {data.sandbox ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm text-muted-foreground">
          <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('sandboxNotice')}
        </div>
      ) : null}
      {total === 0 ? (
        <Card>
          <EmptyState icon={Plug} title={t('emptyTitle')} description={t('emptyBody')} compact />
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.providers.map((p) => (
          <ProviderSection key={p.key} card={p} sandbox={data.sandbox} />
        ))}
      </div>
    </div>
  );
}
