'use client';

import { Link2, PlugZap, Plus, RefreshCw, Unplug, UserRoundCog } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { HealthBadge, ModeBadge } from '@/modules/integrations/components/badges';
import { personalProviderKeys, type PersonalProviderKey } from '@/modules/integrations/constants';
import {
  connectPersonalAction,
  disconnectPersonalAction,
  fetchCampaignsAction,
  mapPersonalAccountAction,
  reassignConnectionAction,
  testPersonalConnectionAction,
} from '@/modules/integrations/server/personal-actions';
import type { PersonalConnection } from '@/modules/integrations/server/queries';

type Option = { id: string; name: string };

/**
 * "My connected accounts" (FR1.6 / ADR-086): the signed-in person's own platform connections. Tokens are pasted once
 * and live in Vault; the list shows only a masked hint and the expiry.
 */
export function MyConnections({
  connections,
  clients,
  sandbox,
}: {
  connections: PersonalConnection[];
  clients: Option[];
  sandbox: boolean;
}) {
  const t = useTranslations('integrations.personal');
  const [adding, setAdding] = useState(false);
  return (
    <Card data-testid="my-connections">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="size-4" aria-hidden />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        <Button size="sm" onClick={() => setAdding(true)} data-testid="personal-connect">
          <Plus />
          {t('connect')}
        </Button>
      </CardHeader>
      <CardContent>
        {connections.length === 0 ? (
          <EmptyState compact icon={Link2} title={t('emptyTitle')} description={t('emptyBody')} />
        ) : (
          <ul className="grid gap-3">
            {connections.map((c) => (
              <ConnectionRow key={c.id} connection={c} clients={clients} />
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent closeLabel={t('cancel')}>
          {adding ? <ConnectForm sandbox={sandbox} onDone={() => setAdding(false)} /> : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ConnectionMeta({ connection: c }: { connection: PersonalConnection }) {
  const t = useTranslations('integrations.personal');
  const f = useFormat();
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {t('token')}:{' '}
      <bdi dir="ltr" className="font-mono" data-testid="personal-token-hint">
        {c.tokenHint ?? '••••'}
      </bdi>
      {' · '}
      {c.tokenExpiresAt ? t('expires', { when: f.relative(c.tokenExpiresAt) }) : t('noExpiry')}
    </p>
  );
}

function ConnectionRow({ connection: c, clients }: { connection: PersonalConnection; clients: Option[] }) {
  const t = useTranslations('integrations.personal');
  const tp = useTranslations('integrations.providers');
  const te = useTranslations('integrations.errors');
  const [confirming, setConfirming] = useState(false);
  const [campaigns, setCampaigns] = useState<Record<string, { id: string; name: string }[]>>({});
  const test = useAction(testPersonalConnectionAction);
  const fetchCampaigns = useAction(fetchCampaignsAction);
  const map = useAction(mapPersonalAccountAction, { successMessage: t('mapped') });
  const disconnect = useAction(disconnectPersonalAction, { successMessage: t('disconnected') });
  const live = c.health !== 'disconnected';

  return (
    <li className="rounded-lg border border-border p-3" data-testid="personal-connection">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="truncate">{c.name}</span>
            <span className="text-xs text-muted-foreground">{tp(`${c.provider}.name`)}</span>
            <HealthBadge health={c.health} />
            <ModeBadge mode={c.mode} />
          </p>
          <ConnectionMeta connection={c} />
          {c.lastErrorCode ? (
            <p className="mt-1 text-xs text-danger">
              {te.has(c.lastErrorCode as 'platform_error') ? te(c.lastErrorCode as 'platform_error') : te('platform_error')}
            </p>
          ) : null}
        </div>
        {live ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              loading={test.pending}
              onClick={async () => {
                const res = await test.run({ connectionId: c.id });
                if (res.ok) toast.success(t('testOk', { count: res.data.accounts }));
              }}
              data-testid="personal-test"
            >
              <PlugZap />
              {t('test')}
            </Button>
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirming(true)} data-testid="personal-disconnect">
              <Unplug />
              {t('disconnect')}
            </Button>
          </div>
        ) : null}
      </div>
      {live ? (
        c.accounts.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('noAccounts')}</p>
        ) : (
          <ul className="mt-3 grid gap-2 border-t border-border pt-3">
            {c.accounts.map((a) => (
              <li key={a.id} className="grid gap-2" data-testid="personal-account">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <bdi dir="ltr">{a.externalId}</bdi>
                      {a.currency ? ` · ${a.currency}` : ''} · {t('campaigns', { count: campaigns[a.id]?.length ?? a.campaigns })}
                    </p>
                  </div>
                  <NativeSelect
                    aria-label={t('client')}
                    className="sm:w-56"
                    value={a.clientId ?? ''}
                    disabled={map.pending}
                    onChange={(e) => void map.run({ accountId: a.id, clientId: e.target.value || null })}
                    data-testid="personal-account-client"
                  >
                    <option value="">{t('noClient')}</option>
                    {clients.map((cl) => (
                      <option key={cl.id} value={cl.id}>
                        {cl.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={fetchCampaigns.pending}
                    onClick={async () => {
                      const res = await fetchCampaigns.run({ accountId: a.id });
                      if (res.ok) {
                        setCampaigns((prev) => ({ ...prev, [a.id]: res.data.campaigns }));
                        toast.success(t('fetched', { count: res.data.campaigns.length }));
                      }
                    }}
                    data-testid="personal-fetch-campaigns"
                  >
                    <RefreshCw />
                    {t('fetch')}
                  </Button>
                </div>
                {campaigns[a.id]?.length ? (
                  <ul className="flex flex-wrap gap-1.5" data-testid="personal-campaigns">
                    {campaigns[a.id]!.map((cp) => (
                      <li key={cp.id} className="bg-muted rounded-md px-2 py-0.5 text-xs">
                        {cp.name}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('disconnectTitle')}
        description={t('disconnectBody')}
        confirmLabel={t('disconnect')}
        cancelLabel={t('cancel')}
        destructive
        onConfirm={() => disconnect.run({ connectionId: c.id }).then(() => setConfirming(false))}
      />
    </li>
  );
}

function ConnectForm({ sandbox, onDone }: { sandbox: boolean; onDone: () => void }) {
  const t = useTranslations('integrations.personal');
  const tp = useTranslations('integrations.providers');
  const tv = useTranslations('validation');
  const [provider, setProvider] = useState<PersonalProviderKey>('meta');
  const [mode, setMode] = useState<'live' | 'sandbox'>(sandbox ? 'sandbox' : 'live');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [refresh, setRefresh] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [customerId, setCustomerId] = useState('');
  const connect = useAction(connectPersonalAction, { successMessage: t('connected') });
  const tokenValid = token.trim() === '' || token.trim().length >= 8;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await connect.run({
          provider,
          mode,
          name: name.trim() || undefined,
          accessToken: token.trim(),
          refreshToken: refresh.trim() || undefined,
          expiresAt: expiresAt || null,
          customerId: provider === 'google' && customerId.trim() ? customerId.trim() : undefined,
        });
        if (res.ok) onDone();
      }}
      data-testid="personal-connect-form"
    >
      <DialogHeader>
        <DialogTitle>{t('connectTitle')}</DialogTitle>
        <DialogDescription>{t('connectBody')}</DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('provider')}>
            {(p) => (
              <NativeSelect
                {...p}
                value={provider}
                onChange={(e) => setProvider(e.target.value as PersonalProviderKey)}
                data-testid="personal-provider"
              >
                {personalProviderKeys.map((k) => (
                  <option key={k} value={k}>
                    {tp(`${k}.name`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {sandbox ? (
            <Field label={t('mode')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'live' | 'sandbox')}
                  data-testid="personal-mode"
                >
                  <option value="sandbox">{t('modes.sandbox')}</option>
                  <option value="live">{t('modes.live')}</option>
                </NativeSelect>
              )}
            </Field>
          ) : null}
        </div>
        <Field label={t('name')} optional>
          {(p) => <Input {...p} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} data-testid="personal-name" />}
        </Field>
        <Field label={t('accessToken')} required error={tokenValid ? undefined : tv('invalid_token')}>
          {(p) => (
            <Input
              {...p}
              type="password"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              data-testid="personal-token"
            />
          )}
        </Field>
        <Field label={t('refreshToken')} optional>
          {(p) => (
            <Input
              {...p}
              type="password"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={refresh}
              onChange={(e) => setRefresh(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('expiresAt')} optional>
            {(p) => (
              <Input
                {...p}
                type="date"
                dir="ltr"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                data-testid="personal-expires"
              />
            )}
          </Field>
          {provider === 'google' ? (
            <Field label={t('customerId')} optional>
              {(p) => <Input {...p} dir="ltr" inputMode="numeric" value={customerId} onChange={(e) => setCustomerId(e.target.value)} />}
            </Field>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={token.trim().length < 8} loading={connect.pending} data-testid="personal-save">
          {t('save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Admin view (FR1.6): everyone's personal connections, masked, with reassign. */
export function PeopleConnections({
  connections,
  members,
  canManage,
}: {
  connections: PersonalConnection[];
  members: Option[];
  canManage: boolean;
}) {
  const t = useTranslations('integrations.personal');
  const tp = useTranslations('integrations.providers');
  const [target, setTarget] = useState<PersonalConnection | null>(null);
  const [owner, setOwner] = useState('');
  const reassign = useAction(reassignConnectionAction, { successMessage: t('admin.reassigned') });
  return (
    <Card className="mt-6" data-testid="people-connections">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRoundCog className="size-4" aria-hidden />
          {t('admin.title')}
        </CardTitle>
        <CardDescription>{t('admin.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('admin.empty')}</p>
        ) : (
          <ul className="grid gap-2">
            {connections.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center"
                data-testid="people-connection"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{tp(`${c.provider}.name`)}</span>
                    <HealthBadge health={c.health} />
                    <ModeBadge mode={c.mode} />
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('owner')}: <span data-testid="people-connection-owner">{c.owner?.name}</span>
                  </p>
                  <ConnectionMeta connection={c} />
                </div>
                {canManage && c.health !== 'disconnected' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setTarget(c);
                      setOwner('');
                    }}
                    data-testid="people-connection-reassign"
                  >
                    <UserRoundCog />
                    {t('admin.reassign')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={Boolean(target)} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent closeLabel={t('cancel')}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!target || !owner) return;
              const res = await reassign.run({ connectionId: target.id, ownerId: owner });
              if (res.ok) setTarget(null);
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('admin.reassignTitle')}</DialogTitle>
              <DialogDescription>{t('admin.reassignBody')}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Field label={t('admin.newOwner')} required>
                {(p) => (
                  <NativeSelect
                    {...p}
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    data-testid="people-connection-owner-select"
                  >
                    <option value="" disabled>
                      —
                    </option>
                    {members
                      .filter((m) => m.id !== target?.owner?.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </NativeSelect>
                )}
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTarget(null)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={!owner} loading={reassign.pending} data-testid="people-connection-reassign-save">
                {t('admin.reassign')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
