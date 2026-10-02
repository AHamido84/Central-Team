'use client';

import { Building2, MailCheck, MailPlus, Pencil, Plus, Power, RotateCw, UserCheck, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Bdi } from '@/components/patterns';
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/overlays';
import { Avatar, Badge, NativeSelect, Skeleton, Switch } from '@/components/ui/primitives';
import type { ActionErrorCode, ActionResult } from '@/lib/actions/errors';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { type ClientRoleKey } from '@/modules/clients/constants';
import { updateClientUserAction } from '@/modules/clients/server/actions';
import {
  addExistingPortalUserAction,
  cancelPortalEmailChangeAction,
  changeInvitationEmailAction,
  changePortalUserEmailAction,
  getPortalUserAction,
} from '@/modules/clients/server/portal-user-actions';
import type { ClientOption, ClientRoleOption, PortalUserSummary } from '@/modules/clients/server/portal-users';
import { setMemberStatusAction } from '@/modules/rbac/server/actions';

export type ChangeEmailTarget =
  | { kind: 'user'; userId: string; name: string; email: string; clientId: string | null }
  | { kind: 'invitation'; invitationId: string; email: string; clientId: string };

/** Calls an action without useAction's error toast: these dialogs show the reason next to the field instead. */
export async function quietAction<I, O>(action: (input: I) => Promise<ActionResult<O>>, input: I): Promise<ActionResult<O>> {
  try {
    return await action(input);
  } catch {
    return { ok: false, error: { code: 'unknown' } };
  }
}

/**
 * Change a portal user's sign-in email (FR4.1, ADR-092). A pending invitation is re-sent to the new address; an active
 * user is changed now (direct) or after they open a link sent to the new address (confirm).
 */
export function ChangeEmailDialog({
  target,
  onOpenChange,
  onAddExisting,
}: {
  target: ChangeEmailTarget | null;
  onOpenChange: (open: boolean) => void;
  /** Offered when the new address already belongs to another portal user of the organization. */
  onAddExisting?: (email: string) => void;
}) {
  const t = useTranslations('clients.users');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const tv = useTranslations('validation');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<'direct' | 'confirm'>('direct');
  const [error, setError] = useState<{ code: ActionErrorCode | 'invalid_email' } | null>(null);
  const [pending, setPending] = useState(false);
  const close = () => {
    setEmail('');
    setMode('direct');
    setError(null);
    onOpenChange(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError({ code: 'invalid_email' });
      return;
    }
    setPending(true);
    setError(null);
    const res =
      target.kind === 'invitation'
        ? await quietAction(changeInvitationEmailAction, { invitationId: target.invitationId, email: address })
        : await quietAction(changePortalUserEmailAction, { userId: target.userId, email: address, mode, clientId: target.clientId });
    setPending(false);
    if (!res.ok) {
      setError({ code: res.error.code });
      return;
    }
    toast.success(
      target.kind === 'invitation'
        ? t('inviteEmailChanged', { email: address })
        : mode === 'confirm'
          ? t('confirmSent', { email: address })
          : t('emailChanged', { email: address }),
    );
    router.refresh();
    close();
  };

  const errorText = error ? (error.code === 'invalid_email' ? tv('invalid_email') : te(error.code)) : null;
  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent closeLabel={tc('close')}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col" data-testid="change-email-dialog">
          <DialogHeader>
            <DialogTitle>
              {target?.kind === 'invitation' ? t('changeInviteEmailTitle') : t('changeEmailTitle', { name: target?.name ?? '' })}
            </DialogTitle>
            {target?.kind === 'invitation' ? <DialogDescription>{t('changeInviteEmailBody')}</DialogDescription> : null}
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <div className="grid gap-1 text-sm">
              <span className="text-xs text-subtle-foreground">{t('currentEmail')}</span>
              <Bdi className="font-medium">{target?.email}</Bdi>
            </div>
            <Field label={t('newEmail')} required>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  dir="ltr"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  data-testid="change-email-input"
                />
              )}
            </Field>
            {errorText ? (
              <div
                className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
                role="alert"
                data-testid="change-email-error"
              >
                <p>{errorText}</p>
                {error?.code === 'email_used_by_portal_user' && onAddExisting && target?.clientId ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      const address = email.trim().toLowerCase();
                      close();
                      onAddExisting(address);
                    }}
                    data-testid="change-email-add-existing"
                  >
                    <UserCheck />
                    {t('addThatUserInstead')}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {target?.kind === 'user' ? (
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">{t('modeLabel')}</legend>
                {(['direct', 'confirm'] as const).map((m) => (
                  <label
                    key={m}
                    className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${mode === m ? 'border-primary bg-primary-soft/40' : 'border-border hover:bg-surface-muted'}`}
                  >
                    <input
                      type="radio"
                      name="emailChangeMode"
                      value={m}
                      checked={mode === m}
                      onChange={() => setMode(m)}
                      className="mt-1 accent-[var(--primary)]"
                      data-testid={`change-email-mode-${m}`}
                    />
                    <span>
                      <span className="block text-sm font-medium">{m === 'direct' ? t('modeDirect') : t('modeConfirm')}</span>
                      <span className="block text-xs text-subtle-foreground">
                        {m === 'direct' ? t('modeDirectHint') : t('modeConfirmHint')}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {tc('cancel')}
            </Button>
            <Button type="submit" loading={pending} data-testid="change-email-submit">
              {target?.kind === 'user' && mode === 'confirm' ? <MailPlus /> : <MailCheck />}
              {target?.kind === 'invitation' ? t('saveEmail') : mode === 'confirm' ? t('sendConfirm') : t('saveEmail')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A small "waiting for the new address" line with a cancel button (FR4.1 confirm mode). */
export function PendingEmailNotice({ userId, email, canCancel }: { userId: string; email: string; canCancel: boolean }) {
  const t = useTranslations('clients.users');
  const cancel = useAction(cancelPortalEmailChangeAction, { successMessage: t('pendingEmailCancelled') });
  return (
    // Inside clickable table rows: cancelling must not also open the row.
    <span
      className="inline-flex flex-wrap items-center gap-1.5"
      data-testid="pending-email"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Badge tone="info">
        <MailPlus />
        <span>{t.rich('pendingEmail', { email, b: (chunks) => <Bdi>{chunks}</Bdi> })}</span>
      </Badge>
      {canCancel ? (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" loading={cancel.pending} onClick={() => void cancel.run({ userId })}>
          {t('cancelPendingEmail')}
        </Button>
      ) : null}
    </span>
  );
}

type DrawerData = { user: PortalUserSummary; clients: ClientOption[]; roles: ClientRoleOption[] };

/**
 * Portal user drawer (FR4.2): every client membership the caller may see (RLS — a Client Owner sees only their own
 * client), per-client role / approval / removal, adding to another client, and — separately — the whole account.
 */
export function PortalUserDrawer({
  userId,
  onOpenChange,
  side,
  canChangeEmail,
  canDeactivateAccount,
  meUserId,
}: {
  userId: string | null;
  onOpenChange: (open: boolean) => void;
  side: 'agency' | 'client';
  canChangeEmail: boolean;
  canDeactivateAccount: boolean;
  meUserId: string;
}) {
  const t = useTranslations('clients.users');
  const tc = useTranslations('common');
  const locale = useLocale() as Locale;
  const f = useFormat();
  const router = useRouter();
  const [loaded, setLoaded] = useState<DrawerData | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [emailTarget, setEmailTarget] = useState<ChangeEmailTarget | null>(null);
  const [removing, setRemoving] = useState<PortalUserSummary['memberships'][number] | null>(null);
  const [accountConfirm, setAccountConfirm] = useState(false);
  const [addClientId, setAddClientId] = useState('');
  const [addRole, setAddRole] = useState<ClientRoleKey>('client_member');
  const [addApprove, setAddApprove] = useState(false);

  const load = useCallback((id: string) => {
    void quietAction(getPortalUserAction, { userId: id }).then((res) => {
      if (res.ok) {
        setLoaded(res.data);
        setFailedFor(null);
      } else {
        setFailedFor(id);
      }
    });
  }, []);

  useEffect(() => {
    if (!userId) return;
    void quietAction(getPortalUserAction, { userId }).then((res) => {
      if (res.ok) {
        setLoaded(res.data);
        setFailedFor(null);
      } else {
        setFailedFor(userId);
      }
    });
  }, [userId]);

  // Only the opened person's data counts: a previous person's stays hidden while the next one loads.
  const data = loaded && loaded.user.userId === userId ? loaded : null;
  const failed = failedFor === userId;

  const reload = () => {
    if (userId) load(userId);
  };
  const update = useAction(updateClientUserAction, { successMessage: tc('saved'), onSuccess: reload });
  const add = useAction(addExistingPortalUserAction, { onSuccess: reload });
  const status = useAction(setMemberStatusAction, { onSuccess: reload });

  const user = data?.user;
  const self = user?.userId === meUserId;
  const activeClientIds = new Set(user?.memberships.filter((m) => m.status === 'active').map((m) => m.clientId));
  const addable = data?.clients.filter((c) => !activeClientIds.has(c.id)) ?? [];
  const clientName = (m: { clientName: PortalUserSummary['memberships'][number]['clientName'] }) => localized(m.clientName, locale);

  const change = (
    m: PortalUserSummary['memberships'][number],
    patch: Partial<{ roleKey: ClientRoleKey; canApprove: boolean; status: 'active' | 'deactivated' }>,
  ) => {
    const roleKey = (patch.roleKey ?? m.roleKey) as ClientRoleKey;
    return update.run({
      clientUserId: m.clientUserId,
      clientId: m.clientId,
      roleKey,
      canApprove: roleKey === 'client_viewer' ? false : (patch.canApprove ?? m.canApprove),
      status: patch.status ?? m.status,
    });
  };

  return (
    <Sheet open={Boolean(userId)} onOpenChange={onOpenChange}>
      <SheetContent closeLabel={tc('close')} className="w-[min(96vw,34rem)]" data-testid="portal-user-drawer">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {!user ? (
            <div className="space-y-4 p-6">
              <SheetTitle className="sr-only">{t('details')}</SheetTitle>
              {failed ? (
                <p className="text-sm text-danger" role="alert">
                  {t('loadFailed')}
                </p>
              ) : (
                <>
                  <Skeleton className="h-12 w-2/3" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </>
              )}
            </div>
          ) : (
            <>
              <header className="flex items-start gap-3 border-b border-border p-6 pe-12">
                <Avatar name={user.name} src={publicAssetUrl(user.avatarPath)} size="lg" />
                <div className="min-w-0 flex-1 space-y-1">
                  <SheetTitle className="flex flex-wrap items-center gap-2">
                    {user.name}
                    {user.accountStatus === 'deactivated' ? <Badge tone="neutral">{tc('deactivated')}</Badge> : null}
                  </SheetTitle>
                  <SheetDescription asChild>
                    <div className="space-y-1">
                      <span className="block truncate text-sm" data-testid="portal-user-email">
                        <Bdi>{user.email}</Bdi>
                      </span>
                      {user.pendingEmail ? (
                        <PendingEmailNotice userId={user.userId} email={user.pendingEmail.to} canCancel={canChangeEmail} />
                      ) : null}
                    </div>
                  </SheetDescription>
                  {canChangeEmail && !self ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() =>
                        setEmailTarget({ kind: 'user', userId: user.userId, name: user.name, email: user.email, clientId: null })
                      }
                      data-testid="drawer-change-email"
                    >
                      <Pencil />
                      {t('changeEmail')}
                    </Button>
                  ) : null}
                </div>
              </header>

              <section className="space-y-3 p-6" aria-labelledby="portal-user-clients">
                <div>
                  <h3 id="portal-user-clients" className="font-semibold">
                    {t('clientsTitle')}
                  </h3>
                  <p className="text-sm text-muted-foreground">{side === 'client' ? t('onlyThisClient') : t('clientsDescription')}</p>
                </div>
                <ul className="divide-y divide-border rounded-lg border border-border" data-testid="portal-user-memberships">
                  {user.memberships.map((m) => (
                    <li key={m.clientUserId} className="space-y-3 p-3" data-testid="portal-user-membership" data-client-id={m.clientId}>
                      <div className="flex items-center gap-3">
                        <Avatar name={clientName(m)} src={publicAssetUrl(m.clientLogoPath)} size="sm" square />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{clientName(m)}</p>
                          <p className="text-xs text-subtle-foreground">{t('addedOn', { date: f.date(m.createdAt) })}</p>
                        </div>
                        {m.status === 'active' ? (
                          <Badge tone="success">{tc('active')}</Badge>
                        ) : (
                          <Badge tone="neutral">{t('removed')}</Badge>
                        )}
                      </div>
                      {self ? null : (
                        <div className="flex flex-wrap items-center gap-2">
                          <NativeSelect
                            aria-label={tc('role')}
                            value={m.roleKey}
                            onChange={(e) => void change(m, { roleKey: e.target.value as ClientRoleKey })}
                            className="h-9 w-40"
                            disabled={m.status === 'deactivated'}
                            data-testid="membership-role"
                          >
                            {data.roles.map((r) => (
                              <option key={r.id} value={r.key}>
                                {localized(r.name, locale)}
                              </option>
                            ))}
                          </NativeSelect>
                          <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Switch
                              checked={m.canApprove}
                              disabled={m.roleKey === 'client_viewer' || m.status === 'deactivated'}
                              onCheckedChange={(v) => void change(m, { canApprove: v })}
                              aria-label={t('canApprove')}
                              data-testid="membership-approve"
                            />
                            {t('approver')}
                          </label>
                          {m.status === 'active' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="ms-auto text-danger"
                              onClick={() => setRemoving(m)}
                              data-testid="membership-remove"
                            >
                              <XCircle />
                              {t('removeFromClient')}
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" className="ms-auto" onClick={() => void change(m, { status: 'active' })}>
                              <RotateCw />
                              {t('restoreToClient')}
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>

                {side === 'agency' ? (
                  <div className="space-y-3 rounded-lg border border-dashed border-border p-3" data-testid="membership-add">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Building2 className="size-4 text-subtle-foreground" aria-hidden />
                      {t('addClient')}
                    </p>
                    {addable.length === 0 ? (
                      <p className="text-xs text-subtle-foreground">{t('noMoreClients')}</p>
                    ) : (
                      <div className="flex flex-wrap items-end gap-2">
                        <NativeSelect
                          aria-label={t('chooseClient')}
                          value={addClientId}
                          onChange={(e) => setAddClientId(e.target.value)}
                          className="h-9 min-w-40 flex-1"
                          data-testid="membership-add-client"
                        >
                          <option value="">{t('chooseClientPlaceholder')}</option>
                          {addable.map((c) => (
                            <option key={c.id} value={c.id}>
                              {localized(c.name, locale)}
                            </option>
                          ))}
                        </NativeSelect>
                        <NativeSelect
                          aria-label={tc('role')}
                          value={addRole}
                          onChange={(e) => {
                            setAddRole(e.target.value as ClientRoleKey);
                            if (e.target.value === 'client_viewer') setAddApprove(false);
                          }}
                          className="h-9 w-36"
                          data-testid="membership-add-role"
                        >
                          {data.roles.map((r) => (
                            <option key={r.id} value={r.key}>
                              {localized(r.name, locale)}
                            </option>
                          ))}
                        </NativeSelect>
                        <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                          <Switch
                            checked={addApprove}
                            disabled={addRole === 'client_viewer'}
                            onCheckedChange={setAddApprove}
                            aria-label={t('canApprove')}
                          />
                          {t('approver')}
                        </label>
                        <Button
                          size="sm"
                          disabled={!addClientId}
                          loading={add.pending}
                          onClick={async () => {
                            const target = data.clients.find((c) => c.id === addClientId);
                            const res = await add.run({
                              clientId: addClientId,
                              email: user.email,
                              roleKey: addRole,
                              canApprove: addApprove,
                            });
                            if (res.ok) {
                              toast.success(t('added', { name: user.name, client: localized(target?.name, locale) }));
                              setAddClientId('');
                            }
                          }}
                          data-testid="membership-add-submit"
                        >
                          <Plus />
                          {t('addClientSubmit')}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : null}
              </section>

              {canDeactivateAccount && side === 'agency' && !self ? (
                <section className="space-y-2 border-t border-border p-6" aria-labelledby="portal-user-account">
                  <h3 id="portal-user-account" className="font-semibold">
                    {t('accountTitle')}
                  </h3>
                  <p className="text-sm text-muted-foreground">{t('accountBody')}</p>
                  {user.accountStatus === 'active' ? (
                    <Button
                      variant="outline"
                      className="text-danger"
                      onClick={() => setAccountConfirm(true)}
                      data-testid="account-deactivate"
                    >
                      <Power />
                      {t('deactivateAccount')}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      loading={status.pending}
                      onClick={async () => {
                        const res = await status.run({ userId: user.userId, status: 'active' });
                        if (res.ok) toast.success(t('accountReactivated'));
                      }}
                      data-testid="account-reactivate"
                    >
                      <RotateCw />
                      {t('reactivateAccount')}
                    </Button>
                  )}
                </section>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>

      <ChangeEmailDialog
        target={emailTarget}
        onOpenChange={(o) => {
          if (!o) {
            setEmailTarget(null);
            reload();
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('removeFromClientTitle', { name: user?.name ?? '', client: removing ? clientName(removing) : '' })}
        description={t('removeFromClientBody', { client: removing ? clientName(removing) : '' })}
        confirmLabel={t('removeFromClient')}
        cancelLabel={tc('cancel')}
        destructive
        onConfirm={async () => {
          if (removing) await change(removing, { status: 'deactivated' });
          setRemoving(null);
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={accountConfirm}
        onOpenChange={setAccountConfirm}
        title={t('deactivateAccountTitle', { name: user?.name ?? '' })}
        description={t('deactivateAccountBody')}
        confirmLabel={t('deactivateAccount')}
        cancelLabel={tc('cancel')}
        destructive
        onConfirm={async () => {
          if (user) {
            const res = await status.run({ userId: user.userId, status: 'deactivated' });
            if (res.ok) toast.success(t('accountDeactivated'));
          }
          setAccountConfirm(false);
        }}
      />
    </Sheet>
  );
}
