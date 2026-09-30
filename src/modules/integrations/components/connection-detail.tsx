'use client';

import { CalendarRange, Check, Copy, Inbox, Pencil, PlugZap, RefreshCw, RotateCcw, ScrollText, Unplug, Webhook } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Card, NativeSelect, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { HealthBadge, MessageStatusBadge, ModeBadge, SyncStatusBadge } from '@/modules/integrations/components/badges';
import { useOAuth, WhatsAppConnectDialog } from '@/modules/integrations/components/integrations-overview';
import { SYNC } from '@/modules/integrations/constants';
import {
  disconnectAction,
  linkCampaignAction,
  mapAccountAction,
  refreshDiscoveryAction,
  renameConnectionAction,
  requestSyncAction,
  retrySyncAction,
  setNotificationTemplateAction,
  testConnectionAction,
} from '@/modules/integrations/server/actions';
import type { ConnectionDetail } from '@/modules/integrations/server/queries';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000));

function CopyValue({ value, label }: { value: string; label: string }) {
  const t = useTranslations('common');
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code dir="ltr" className="min-w-0 flex-1 truncate rounded-md bg-surface-muted px-2 py-1.5 font-mono text-xs">
        {value}
      </code>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label={`${label} · ${t('copy')}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      </Button>
    </div>
  );
}

function RenameDialog({ id, name, open, onOpenChange }: { id: string; name: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('integrations.detail');
  const tc = useTranslations('common');
  const [value, setValue] = useState(name);
  const rename = useAction(renameConnectionAction, { successMessage: tc('saved'), onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('rename')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void rename.run({ connectionId: id, name: value });
          }}
        >
          <DialogBody>
            <Field label={t('name')} required>
              {(p) => <Input {...p} value={value} maxLength={120} onChange={(e) => setValue(e.target.value)} />}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={rename.pending} disabled={!value.trim()}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BackfillDialog({ connectionId, open, onOpenChange }: { connectionId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations('integrations.sync');
  const tc = useTranslations('common');
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(daysAgo(1));
  const [error, setError] = useState<string | undefined>();
  const run = useAction(requestSyncAction, { successMessage: t('queued'), onSuccess: () => onOpenChange(false) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('backfillTitle')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await run.run({ connectionId, accountId: null, trigger: 'backfill', from, to });
            if (!res.ok) setError(res.error.fieldErrors?.from?.[0] ?? res.error.fieldErrors?.to?.[0]);
          }}
        >
          <DialogBody className="grid gap-4">
            <p className="text-sm text-muted-foreground">{t('backfillBody', { days: SYNC.maxBackfillDays })}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('from')} error={error}>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    dir="ltr"
                    value={from}
                    max={to}
                    onChange={(e) => setFrom(e.target.value)}
                    data-testid="backfill-from"
                  />
                )}
              </Field>
              <Field label={t('to')}>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    dir="ltr"
                    value={to}
                    min={from}
                    onChange={(e) => setTo(e.target.value)}
                    data-testid="backfill-to"
                  />
                )}
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={run.pending} data-testid="backfill-submit">
              {t('backfill')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConnectionDetailView({
  data,
  hooksBaseUrl,
  canManage,
}: {
  data: ConnectionDetail;
  hooksBaseUrl: string;
  canManage: boolean;
}) {
  const t = useTranslations('integrations');
  const tc = useTranslations('common');
  const locale = useLocale() as Locale;
  const format = useFormat();
  const c = data.connection;
  const oauth = useOAuth();
  const [renameOpen, setRenameOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const test = useAction(testConnectionAction, { successMessage: t('detail.testOk') });
  const refresh = useAction(refreshDiscoveryAction, { successMessage: t('detail.refreshed') });
  const disconnect = useAction(disconnectAction, { successMessage: t('detail.disconnected') });
  const mapAccount = useAction(mapAccountAction, { successMessage: tc('saved') });
  const linkCampaign = useAction(linkCampaignAction, { successMessage: tc('saved') });
  const syncNow = useAction(requestSyncAction, { successMessage: t('sync.queued') });
  const retry = useAction(retrySyncAction, { successMessage: t('sync.queued') });
  const setTemplate = useAction(setNotificationTemplateAction, { successMessage: tc('saved') });

  const disconnected = c.health === 'disconnected';
  const needsReconnect = c.health === 'expired' || c.health === 'error' || disconnected;
  const adAccounts = data.accounts.filter((a) => a.kind === 'ad_account');
  const channelsFor = (clientId: string | null) => data.channels.filter((ch) => ch.clientId === clientId);
  const reconnect = () => (c.provider === 'whatsapp' ? setWaOpen(true) : void oauth.go(c.provider as 'meta', c.mode, c.id));
  const hookUrl = `${hooksBaseUrl}/api/hooks/${c.provider}`;
  const clientName = useMemo(() => new Map(data.clients.map((x) => [x.id, localized(x.name, locale)])), [data.clients, locale]);
  const showWhatsApp = c.provider === 'whatsapp';
  const showCampaigns = c.provider !== 'whatsapp';

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <HealthBadge health={c.health} />
              <ModeBadge mode={c.mode} />
              <span className="text-sm text-muted-foreground">{t(`providers.${c.provider}.name`)}</span>
            </div>
            {c.externalName ? (
              <p className="text-sm">
                {t('detail.authorizedAs')} <bdi className="font-medium">{c.externalName}</bdi>
              </p>
            ) : null}
            <p className="text-xs text-subtle-foreground">
              {t('detail.connectedAt', { when: format.dateTime(c.connectedAt) })}
              {c.connectedBy && data.people[c.connectedBy] ? (
                <>
                  {' '}
                  · <bdi>{data.people[c.connectedBy]}</bdi>
                </>
              ) : null}
            </p>
            {c.tokenExpiresAt && !disconnected ? (
              <p className={c.health === 'expiring' || c.health === 'expired' ? 'text-xs text-warning' : 'text-xs text-subtle-foreground'}>
                {t('detail.tokenExpires', { when: format.dateTime(c.tokenExpiresAt) })}
              </p>
            ) : null}
          </div>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              {needsReconnect && !(c.provider === 'whatsapp' && c.mode === 'sandbox') ? (
                <Button size="sm" onClick={reconnect} loading={oauth.pending} data-testid="reconnect">
                  <PlugZap aria-hidden />
                  {t('detail.reconnect')}
                </Button>
              ) : null}
              {!disconnected ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void test.run({ connectionId: c.id })}
                    loading={test.pending}
                    data-testid="test-connection"
                  >
                    <PlugZap aria-hidden />
                    {t('detail.test')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void refresh.run({ connectionId: c.id })}
                    loading={refresh.pending}
                    disabled={needsReconnect}
                    data-testid="refresh-discovery"
                  >
                    <RefreshCw aria-hidden />
                    {t('detail.refresh')}
                  </Button>
                </>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setRenameOpen(true)}>
                <Pencil aria-hidden />
                {t('detail.rename')}
              </Button>
              {!disconnected ? (
                <ConfirmDialog
                  trigger={
                    <Button size="sm" variant="ghost" className="text-danger" data-testid="disconnect">
                      <Unplug aria-hidden />
                      {t('detail.disconnect')}
                    </Button>
                  }
                  title={t('detail.disconnectTitle')}
                  description={t('detail.disconnectBody')}
                  confirmLabel={t('detail.disconnect')}
                  cancelLabel={tc('cancel')}
                  destructive
                  onConfirm={() => disconnect.run({ connectionId: c.id })}
                />
              ) : null}
            </div>
          ) : null}
        </div>
        {needsReconnect && c.lastErrorCode ? (
          <div
            role="alert"
            className="mt-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
            data-testid="connection-error"
          >
            <p className="font-medium">{t(`errors.${c.lastErrorCode as 'auth_expired'}`)}</p>
            <p className="mt-0.5 text-xs">{t('detail.reconnectHint')}</p>
          </div>
        ) : null}
      </Card>

      <Tabs defaultValue="accounts">
        <TabsList className="w-full overflow-x-auto sm:w-auto">
          <TabsTrigger value="accounts">{t('tabs.accounts')}</TabsTrigger>
          {showCampaigns ? (
            <TabsTrigger value="campaigns" data-testid="tab-campaigns">
              {t('tabs.campaigns')}
            </TabsTrigger>
          ) : null}
          {showCampaigns ? (
            <TabsTrigger value="sync" data-testid="tab-sync">
              {t('tabs.sync')}
            </TabsTrigger>
          ) : null}
          {showWhatsApp ? <TabsTrigger value="templates">{t('tabs.templates')}</TabsTrigger> : null}
          {showWhatsApp ? <TabsTrigger value="messages">{t('tabs.messages')}</TabsTrigger> : null}
          <TabsTrigger value="webhooks">{t('tabs.webhooks')}</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="mt-4">
          <Card>
            {data.accounts.length ? (
              <ul className="divide-y divide-border">
                {data.accounts.map((a) => (
                  <li
                    key={a.id}
                    className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_16rem_auto] md:items-center"
                    data-testid="account-row"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        <bdi>{a.name}</bdi>
                      </p>
                      <p className="text-xs text-subtle-foreground">
                        {t(`accountKinds.${a.kind}`)} · <bdi dir="ltr">{a.externalId}</bdi>
                        {a.currency ? (
                          <>
                            {' '}
                            · <span dir="ltr">{a.currency}</span>
                          </>
                        ) : null}
                        {a.lastSyncedAt ? <> · {t('lastSynced', { when: format.relative(a.lastSyncedAt) })}</> : null}
                      </p>
                    </div>
                    {a.kind === 'ad_account' ? (
                      <>
                        <NativeSelect
                          aria-label={t('detail.client')}
                          value={a.clientId ?? ''}
                          disabled={!canManage}
                          onChange={(e) =>
                            void mapAccount.run({ accountId: a.id, clientId: e.target.value || null, syncEnabled: !!e.target.value })
                          }
                          data-testid="account-client"
                        >
                          <option value="">{t('detail.noClient')}</option>
                          {data.clients.map((cl) => (
                            <option key={cl.id} value={cl.id}>
                              {localized(cl.name, locale)}
                            </option>
                          ))}
                        </NativeSelect>
                        <label className="flex items-center gap-2 text-sm">
                          <Switch
                            checked={a.syncEnabled}
                            disabled={!canManage || !a.clientId}
                            onCheckedChange={(v) => void mapAccount.run({ accountId: a.id, clientId: a.clientId, syncEnabled: v })}
                            data-testid="account-sync"
                          />
                          {t('detail.dailySync')}
                        </label>
                      </>
                    ) : (
                      <p className="text-xs text-subtle-foreground md:col-span-2">{t(`accountHints.${a.kind}`)}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Inbox} title={t('detail.noAccounts')} description={t('detail.noAccountsBody')} compact />
            )}
          </Card>
        </TabsContent>

        {showCampaigns ? (
          <TabsContent value="campaigns" className="mt-4 space-y-4">
            {adAccounts.length === 0 || adAccounts.every((a) => !a.clientId) ? (
              <Card>
                <EmptyState icon={CalendarRange} title={t('detail.mapFirst')} description={t('detail.mapFirstBody')} compact />
              </Card>
            ) : null}
            {adAccounts
              .filter((a) => a.clientId)
              .map((a) => {
                const links = data.links.filter((l) => l.accountId === a.id);
                const options = channelsFor(a.clientId);
                return (
                  <Card key={a.id}>
                    <div className="border-b border-border px-5 py-3">
                      <p className="text-sm font-semibold">
                        {t.rich('detail.accountForClient', {
                          account: () => <bdi>{a.name}</bdi>,
                          client: () => <bdi className="font-normal text-muted-foreground">{clientName.get(a.clientId!) ?? ''}</bdi>,
                        })}
                      </p>
                      {!options.length ? <p className="mt-1 text-xs text-warning">{t('detail.noChannels')}</p> : null}
                    </div>
                    <ul className="divide-y divide-border">
                      {links.map((l) => (
                        <li
                          key={l.id}
                          className="grid gap-2 px-5 py-3 md:grid-cols-[minmax(0,1fr)_20rem] md:items-center"
                          data-testid="campaign-link"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm">
                              <bdi>{l.name}</bdi>
                            </p>
                            <p className="text-xs text-subtle-foreground">
                              <bdi dir="ltr">{l.externalCampaignId}</bdi>
                              {l.platformStatus ? (
                                <>
                                  {' '}
                                  · <span dir="ltr">{l.platformStatus}</span>
                                </>
                              ) : null}
                            </p>
                          </div>
                          <NativeSelect
                            aria-label={t('detail.channel')}
                            value={l.channelId ?? ''}
                            disabled={!canManage}
                            onChange={(e) => void linkCampaign.run({ linkId: l.id, channelId: e.target.value || null })}
                            data-testid="campaign-channel"
                          >
                            <option value="">{t('detail.notLinked')}</option>
                            {options.map((ch) => (
                              <option key={ch.id} value={ch.id}>
                                {ch.label}
                              </option>
                            ))}
                          </NativeSelect>
                        </li>
                      ))}
                      {!links.length ? (
                        <li className="px-5 py-3 text-xs text-subtle-foreground">{t('detail.noPlatformCampaigns')}</li>
                      ) : null}
                    </ul>
                  </Card>
                );
              })}
          </TabsContent>
        ) : null}

        {showCampaigns ? (
          <TabsContent value="sync" className="mt-4 space-y-4">
            {canManage && !needsReconnect ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    void syncNow.run({
                      connectionId: c.id,
                      accountId: null,
                      trigger: 'manual',
                      from: daysAgo(SYNC.scheduledDays - 1),
                      to: daysAgo(0),
                    })
                  }
                  loading={syncNow.pending}
                  data-testid="sync-now"
                >
                  <RefreshCw aria-hidden />
                  {t('sync.now')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setBackfillOpen(true)} data-testid="backfill">
                  <CalendarRange aria-hidden />
                  {t('sync.backfill')}
                </Button>
              </div>
            ) : null}
            <p className="text-xs text-subtle-foreground">{t('sync.explain', { days: SYNC.scheduledDays })}</p>
            <Card>
              {data.runs.length ? (
                <ul className="divide-y divide-border" data-testid="sync-log">
                  {data.runs.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
                      data-testid="sync-run"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="flex flex-wrap items-center gap-2 text-sm">
                          <SyncStatusBadge status={r.status} />
                          <span>{t(`sync.triggers.${r.trigger as 'manual'}`)}</span>
                          <span className="text-muted-foreground">
                            {format.date(`${r.dateFrom}T12:00:00Z`, 'short')} – {format.date(`${r.dateTo}T12:00:00Z`, 'short')}
                          </span>
                        </p>
                        <p className="text-xs text-subtle-foreground">
                          {format.dateTime(r.createdAt)}
                          {r.requestedBy && data.people[r.requestedBy] ? (
                            <>
                              {' '}
                              · <bdi>{data.people[r.requestedBy]}</bdi>
                            </>
                          ) : null}
                          {r.status === 'succeeded' ? <> · {t('sync.result', { rows: r.rowsWritten, campaigns: r.campaigns })}</> : null}
                          {r.attempts > 1 ? <> · {t('sync.attempts', { count: r.attempts })}</> : null}
                        </p>
                        {r.status === 'failed' ? (
                          <p className="text-xs text-danger">
                            {t(`errors.${(r.errorCode ?? 'platform_error') as 'platform_error'}`)}
                            {r.nextAttemptAt ? <> · {t('sync.retryAt', { when: format.relative(r.nextAttemptAt) })}</> : null}
                          </p>
                        ) : null}
                      </div>
                      {canManage && r.status === 'failed' && !r.nextAttemptAt && !needsReconnect ? (
                        <Button size="sm" variant="outline" onClick={() => void retry.run({ runId: r.id })} loading={retry.pending}>
                          <RotateCcw aria-hidden />
                          {t('sync.retry')}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={ScrollText} title={t('sync.emptyTitle')} description={t('sync.emptyBody')} compact />
              )}
            </Card>
            <BackfillDialog connectionId={c.id} open={backfillOpen} onOpenChange={setBackfillOpen} />
          </TabsContent>
        ) : null}

        {showWhatsApp ? (
          <TabsContent value="templates" className="mt-4">
            <Card>
              {data.templates.length ? (
                <ul className="divide-y divide-border">
                  {data.templates.map((tp) => (
                    <li
                      key={tp.id}
                      className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                      data-testid="template-row"
                    >
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <bdi dir="ltr">{tp.name}</bdi>
                          <Badge tone="outline">{tp.language.toUpperCase()}</Badge>
                          <Badge tone={tp.status === 'approved' ? 'success' : tp.status === 'rejected' ? 'danger' : 'warning'}>
                            {t(`templateStatus.${tp.status as 'approved'}`)}
                          </Badge>
                          <Badge tone="neutral">{t(`templateCategory.${tp.category as 'utility'}`)}</Badge>
                        </p>
                        <p className="mt-1 text-xs whitespace-pre-line text-muted-foreground" dir={tp.language === 'ar' ? 'rtl' : 'ltr'}>
                          {tp.body}
                        </p>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={tp.isNotification}
                          disabled={!canManage || tp.status !== 'approved' || tp.paramCount < 2}
                          onCheckedChange={(v) => void setTemplate.run({ templateId: tp.id, isNotification: v })}
                          data-testid="template-notification"
                        />
                        {t('detail.useForNotifications')}
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={Inbox} title={t('detail.noTemplates')} description={t('detail.noTemplatesBody')} compact />
              )}
            </Card>
            <p className="mt-2 text-xs text-subtle-foreground">{t('detail.notificationTemplateHint')}</p>
          </TabsContent>
        ) : null}

        {showWhatsApp ? (
          <TabsContent value="messages" className="mt-4">
            <Card>
              {data.messages.length ? (
                <ul className="divide-y divide-border">
                  {data.messages.map((m) => (
                    <li key={m.id} className="px-5 py-3">
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <MessageStatusBadge status={m.status} />
                        <bdi dir="ltr">{m.toPhone}</bdi>
                        <span className="text-muted-foreground">{t(`purpose.${m.purpose as 'lead'}`)}</span>
                        <span className="text-xs text-subtle-foreground">{format.dateTime(m.createdAt)}</span>
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{m.body}</p>
                      {m.status === 'failed' && m.errorCode ? (
                        <p className="text-xs text-danger">{t(`errors.${m.errorCode as 'platform_error'}`)}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={Inbox} title={t('detail.noMessages')} compact />
              )}
            </Card>
          </TabsContent>
        ) : null}

        <TabsContent value="webhooks" className="mt-4 space-y-4">
          <Card className="space-y-2 p-5">
            <p className="text-sm font-medium">{t('webhooks.urlTitle')}</p>
            <p className="text-xs text-muted-foreground">{t(`webhooks.urlHint.${c.provider}`)}</p>
            <CopyValue value={hookUrl} label={t('webhooks.urlTitle')} />
          </Card>
          <Card>
            {data.webhooks.length ? (
              <ul className="divide-y divide-border">
                {data.webhooks.map((w) => (
                  <li
                    key={w.id}
                    className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
                    data-testid="webhook-row"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge
                          tone={
                            w.status === 'processed' ? 'success' : w.status === 'failed' || w.status === 'rejected' ? 'danger' : 'neutral'
                          }
                        >
                          {t(`webhooks.status.${w.status as 'processed'}`)}
                        </Badge>
                        <span>{t(`webhooks.topics.${w.topic as 'lead'}`)}</span>
                        <span className="text-xs text-subtle-foreground">{format.dateTime(w.receivedAt)}</span>
                      </p>
                      {w.error ? (
                        <p className="text-xs text-subtle-foreground">
                          {t.has(`webhooks.reasons.${w.error}` as never) ? t(`webhooks.reasons.${w.error}` as never) : w.error}
                        </p>
                      ) : null}
                    </div>
                    {w.leadId ? (
                      <Link href={`/crm/leads/${w.leadId}`} className="text-sm text-primary hover:underline">
                        {t('webhooks.openLead')}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Webhook} title={t('webhooks.emptyTitle')} description={t('webhooks.emptyBody')} compact />
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <RenameDialog id={c.id} name={c.name} open={renameOpen} onOpenChange={setRenameOpen} />
      {c.provider === 'whatsapp' ? <WhatsAppConnectDialog open={waOpen} onOpenChange={setWaOpen} connectionId={c.id} /> : null}
    </div>
  );
}
