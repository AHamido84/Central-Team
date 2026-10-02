'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { BadgeCheck, Info, MailPlus, MoreHorizontal, Pencil, RotateCw, Trash2, UserCheck, UserPlus, Users, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Bdi, EmptyState } from '@/components/patterns';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { Avatar, Badge, Card, NativeSelect, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { languageNames, localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { clientRoleKeys, type ClientRoleKey } from '@/modules/clients/constants';
import {
  ChangeEmailDialog,
  PendingEmailNotice,
  PortalUserDrawer,
  quietAction,
  type ChangeEmailTarget,
} from '@/modules/clients/components/portal-user-dialogs';
import { updateClientUserAction } from '@/modules/clients/server/actions';
import {
  addExistingPortalUserAction,
  lookupPortalEmailAction,
  searchPortalUsersAction,
} from '@/modules/clients/server/portal-user-actions';
import type { EmailLookup, PortalUserSummary } from '@/modules/clients/server/portal-users';
import { DeleteDialog } from '@/modules/data/components/delete-dialog';
import type { ClientInvitation, ClientPortalUser } from '@/modules/clients/server/queries';
import { inviteClientUserAction, resendInvitationAction, revokeInvitationAction } from '@/modules/invitations/server/actions';

type RoleOption = { id: string; key: string; name: LocalizedText; description: LocalizedText };

const inviteSchema = z.object({
  email: z.email({ message: 'invalid_email' }),
  fullName: z.string().max(120),
  jobTitle: z.string().max(80),
  clientRoleKey: z.enum(clientRoleKeys),
  canApprove: z.boolean(),
  locale: z.enum(['ar', 'en']),
});

function InviteClientUserDialog({
  clientId,
  roles,
  clientName,
  side,
  open,
  onOpenChange,
  initialEmail,
}: {
  clientId: string;
  roles: RoleOption[];
  clientName: string;
  side: 'agency' | 'client';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialEmail: string;
}) {
  const t = useTranslations();
  const te = useTranslations('errors');
  const locale = useLocale() as Locale;
  const f = useFormat();
  const router = useRouter();
  const form = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: initialEmail, fullName: '', jobTitle: '', clientRoleKey: 'client_member', canApprove: false, locale },
  });
  const [lookup, setLookup] = useState<EmailLookup | null>(null);
  const [suggestions, setSuggestions] = useState<PortalUserSummary[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const email = form.watch('email');

  const check = async (address: string) => {
    const value = address.trim().toLowerCase();
    if (!z.email().safeParse(value).success) {
      setLookup(null);
      return null;
    }
    const res = await quietAction(lookupPortalEmailAction, { clientId, email: value });
    const found = res.ok ? res.data : null;
    setLookup(found);
    return found;
  };

  // Opened from "add that user instead": check the address straight away.
  useEffect(() => {
    if (open && initialEmail) {
      form.setValue('email', initialEmail);
      void check(initialEmail);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialEmail]);

  // Agency side: existing portal users by name or email while typing (FR4.2). A Client Owner only gets the
  // per-address check on blur — they must not browse other clients' people.
  useEffect(() => {
    if (side !== 'agency' || !open) return;
    const q = email.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      void quietAction(searchPortalUsersAction, { query: q }).then((res) => {
        setSuggestions(res.ok ? res.data : []);
      });
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [email, side, open]);

  const close = () => {
    form.reset({ email: '', fullName: '', jobTitle: '', clientRoleKey: 'client_member', canApprove: false, locale });
    setLookup(null);
    setSuggestions([]);
    onOpenChange(false);
  };

  const existing = lookup?.kind === 'portal_user' && !lookup.inClient ? lookup : null;
  const blocked = lookup?.kind === 'agency_member' || (lookup?.kind === 'portal_user' && lookup.inClient);

  const submit = form.handleSubmit(async (v) => {
    const address = v.email.trim().toLowerCase();
    if (existing) {
      const res = await quietAction(addExistingPortalUserAction, {
        clientId,
        email: address,
        roleKey: v.clientRoleKey,
        canApprove: v.clientRoleKey === 'client_viewer' ? false : v.canApprove,
        jobTitle: v.jobTitle || null,
      });
      if (!res.ok) {
        toast.error(te(res.error.code));
        return;
      }
      toast.success(t('clients.users.added', { name: existing.summary?.name ?? address, client: clientName }));
      router.refresh();
      close();
      return;
    }
    const res = await quietAction(inviteClientUserAction, {
      ...v,
      email: address,
      clientId,
      fullName: v.fullName || undefined,
      jobTitle: v.jobTitle || undefined,
    });
    if (res.ok) {
      toast.success(t('admin.users.inviteSent'));
      router.refresh();
      close();
      return;
    }
    // The address turned out to have an account: switch the dialog to "add them" instead of failing.
    if (
      res.error.code === 'existing_portal_user' ||
      res.error.code === 'email_used_by_team_member' ||
      res.error.code === 'already_member'
    ) {
      await check(address);
      return;
    }
    toast.error(te(res.error.code));
  });

  const roleKey = form.watch('clientRoleKey');
  const existingClients =
    existing?.summary?.memberships.filter((m) => m.status === 'active').map((m) => localized(m.clientName, locale)) ?? [];
  const emailField = form.register('email');
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent closeLabel={t('common.close')}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{t('clients.users.inviteTitle', { client: clientName })}</DialogTitle>
            <DialogDescription>{t('clients.users.inviteDescription')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="relative">
                <Field
                  label={t('common.email')}
                  error={form.formState.errors.email?.message}
                  hint={side === 'agency' ? t('clients.users.searchHint') : undefined}
                  required
                >
                  {(p) => (
                    <Input
                      {...p}
                      type="email"
                      dir="ltr"
                      autoComplete="off"
                      role={side === 'agency' ? 'combobox' : undefined}
                      aria-expanded={side === 'agency' ? showSuggestions && suggestions.length > 0 : undefined}
                      aria-controls={side === 'agency' ? 'portal-user-suggestions' : undefined}
                      {...emailField}
                      onChange={(e) => {
                        void emailField.onChange(e);
                        setLookup(null);
                        setShowSuggestions(true);
                      }}
                      onBlur={(e) => {
                        void emailField.onBlur(e);
                        // Let a click on a suggestion land before the list closes.
                        setTimeout(() => {
                          setShowSuggestions(false);
                        }, 150);
                        void check(e.target.value);
                      }}
                      data-testid="client-invite-email"
                    />
                  )}
                </Field>
                {side === 'agency' && showSuggestions && suggestions.length > 0 ? (
                  <ul
                    id="portal-user-suggestions"
                    role="listbox"
                    aria-label={t('clients.users.searchResults')}
                    className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface-raised p-1 shadow-lg sm:w-[min(28rem,80vw)]"
                    data-testid="portal-user-suggestions"
                  >
                    {suggestions.map((s) => (
                      <li key={s.userId} role="option" aria-selected={false}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-start hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none"
                          onMouseDown={(e) => {
                            e.preventDefault();
                          }}
                          onClick={() => {
                            form.setValue('email', s.email, { shouldValidate: true });
                            setShowSuggestions(false);
                            void check(s.email);
                          }}
                          data-testid="portal-user-suggestion"
                        >
                          <Avatar name={s.name} src={publicAssetUrl(s.avatarPath)} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{s.name}</span>
                            <span className="block truncate text-xs text-subtle-foreground">
                              <Bdi>{s.email}</Bdi>
                            </span>
                            {s.memberships.length ? (
                              <span className="block truncate text-xs text-subtle-foreground">
                                {f.list(s.memberships.filter((m) => m.status === 'active').map((m) => localized(m.clientName, locale)))}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {existing ? null : (
                <Field label={t('common.name')} optional>
                  {(p) => <Input {...p} {...form.register('fullName')} />}
                </Field>
              )}
            </div>
            {lookup?.kind === 'agency_member' ? (
              <p
                className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
                role="alert"
                data-testid="invite-team-member"
              >
                {t('clients.users.teamMember')}
              </p>
            ) : null}
            {lookup?.kind === 'portal_user' && lookup.inClient ? (
              <p
                className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning"
                role="alert"
                data-testid="invite-already-here"
              >
                {t('clients.users.alreadyHere')}
              </p>
            ) : null}
            {existing ? (
              <div className="flex gap-3 rounded-lg border border-info/30 bg-info-soft p-3 text-sm" data-testid="invite-existing">
                <UserCheck className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                <div>
                  <p className="font-medium">{t('clients.users.existingTitle')}</p>
                  <p className="text-muted-foreground">
                    {existingClients.length
                      ? t('clients.users.existingBody', {
                          name: existing.summary?.name ?? email,
                          clients: f.list(existingClients),
                          client: clientName,
                        })
                      : t('clients.users.existingBodyNoClients', { name: existing.summary?.name ?? email, client: clientName })}
                  </p>
                </div>
              </div>
            ) : null}
            <Field label={t('admin.users.jobTitle')} optional>
              {(p) => <Input {...p} {...form.register('jobTitle')} />}
            </Field>
            <Controller
              control={form.control}
              name="clientRoleKey"
              render={({ field }) => (
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium">{t('common.role')}</legend>
                  {roles.map((r) => (
                    <label
                      key={r.id}
                      className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${field.value === r.key ? 'border-primary bg-primary-soft/40' : 'border-border hover:bg-surface-muted'}`}
                    >
                      <input
                        type="radio"
                        name="clientRoleKey"
                        value={r.key}
                        checked={field.value === r.key}
                        onChange={() => {
                          field.onChange(r.key);
                          if (r.key === 'client_viewer') form.setValue('canApprove', false);
                        }}
                        className="mt-1 accent-[var(--primary)]"
                        data-testid={`client-role-${r.key}`}
                      />
                      <span>
                        <span className="block text-sm font-medium">{localized(r.name, locale)}</span>
                        <span className="block text-xs text-subtle-foreground">{localized(r.description, locale)}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
            />
            <Controller
              control={form.control}
              name="canApprove"
              render={({ field }) => (
                <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <span>
                    <span className="block text-sm font-medium">{t('clients.users.canApprove')}</span>
                    <span className="block text-xs text-subtle-foreground">{t('clients.users.canApproveHint')}</span>
                  </span>
                  <Switch checked={field.value} onCheckedChange={field.onChange} disabled={roleKey === 'client_viewer'} />
                </label>
              )}
            />
            {existing ? null : (
              <Field label={t('admin.users.emailLanguage')}>
                {(p) => (
                  <NativeSelect {...p} {...form.register('locale')}>
                    <option value="ar">{languageNames.ar}</option>
                    <option value="en">{languageNames.en}</option>
                  </NativeSelect>
                )}
              </Field>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting} disabled={blocked} data-testid="client-invite-submit">
              {existing ? <UserCheck /> : <MailPlus />}
              {existing ? t('clients.users.addExisting', { client: clientName }) : t('admin.users.sendInvite')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Portal users of a client — used on the agency client page (with `client_users:manage`) and by the
 * Client Owner in the portal (with `portal_users:manage`). The database enforces the same rules.
 */
export function ClientUsersManager({
  clientId,
  clientName,
  users,
  invitations,
  roles,
  canManage,
  canDelete = false,
  meUserId,
  side = 'agency',
  canChangeEmail = false,
  canDeactivateAccount = false,
}: {
  side?: 'agency' | 'client';
  /** `client_users:update_email` (FR4.1). */
  canChangeEmail?: boolean;
  /** `users:deactivate`: the whole portal account, separate from this client's membership (FR4.2). */
  canDeactivateAccount?: boolean;
  /** Agency side only: portal users go to the Trash (ADR-080). */
  canDelete?: boolean;
  clientId: string;
  clientName: string;
  users: ClientPortalUser[];
  invitations: ClientInvitation[];
  roles: RoleOption[];
  canManage: boolean;
  meUserId: string;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const update = useAction(updateClientUserAction, { successMessage: t('common.saved') });
  const resend = useAction(resendInvitationAction, { successMessage: t('admin.users.inviteResent') });
  const revoke = useAction(revokeInvitationAction, { successMessage: t('admin.users.inviteRevoked') });
  const [confirm, setConfirm] = useState<ClientPortalUser | null>(null);
  const [deleting, setDeleting] = useState<ClientPortalUser | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [drawerUserId, setDrawerUserId] = useState<string | null>(null);
  const [emailTarget, setEmailTarget] = useState<ChangeEmailTarget | null>(null);
  const addExistingInstead = (address: string) => {
    setInviteEmail(address);
    setInviteOpen(true);
  };
  const roleName = (key: string) => localized(roles.find((r) => r.key === key)?.name, locale);

  const change = (u: ClientPortalUser, patch: Partial<{ roleKey: ClientRoleKey; canApprove: boolean; status: 'active' | 'deactivated' }>) =>
    update.run({
      clientUserId: u.clientUserId,
      clientId,
      roleKey: (patch.roleKey ?? u.roleKey) as ClientRoleKey,
      canApprove: patch.roleKey === 'client_viewer' ? false : (patch.canApprove ?? u.canApprove),
      status: patch.status ?? u.status,
    });

  return (
    <div className="space-y-6" data-testid="client-users">
      {deleting ? <DeleteDialog type="client_user" id={deleting.clientUserId} open onOpenChange={(o) => !o && setDeleting(null)} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t('clients.users.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('clients.users.description')}</p>
        </div>
        {canManage ? (
          <>
            <Button
              onClick={() => {
                setInviteEmail('');
                setInviteOpen(true);
              }}
              data-testid="invite-client-user"
            >
              <UserPlus />
              {t('clients.users.invite')}
            </Button>
            <InviteClientUserDialog
              clientId={clientId}
              roles={roles}
              clientName={clientName}
              side={side}
              open={inviteOpen}
              onOpenChange={setInviteOpen}
              initialEmail={inviteEmail}
            />
          </>
        ) : null}
      </div>

      <Card className="divide-y divide-border">
        {users.length === 0 ? (
          <EmptyState
            compact
            icon={Users}
            title={t('clients.users.empty')}
            description={canManage ? t('clients.users.emptyBody') : undefined}
          />
        ) : (
          users.map((u) => {
            const self = u.userId === meUserId;
            return (
              <div key={u.clientUserId} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center" data-testid="client-user-row">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={u.name} src={publicAssetUrl(u.avatarPath)} size="md" />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate font-medium">
                      {canManage ? (
                        <button
                          type="button"
                          className="truncate text-start hover:underline focus-visible:underline focus-visible:outline-none"
                          onClick={() => setDrawerUserId(u.userId)}
                          data-testid="client-user-open"
                        >
                          {u.name}
                        </button>
                      ) : (
                        u.name
                      )}
                      {self ? <Badge>{t('common.you')}</Badge> : null}
                      {u.status === 'deactivated' ? <Badge tone="neutral">{t('common.deactivated')}</Badge> : null}
                    </p>
                    <p className="truncate text-xs text-subtle-foreground">
                      <Bdi>{u.email}</Bdi>
                      {u.jobTitle ? ` · ${u.jobTitle}` : ''}
                    </p>
                    {u.pendingEmail ? (
                      <div className="mt-1">
                        <PendingEmailNotice userId={u.userId} email={u.pendingEmail} canCancel={canChangeEmail} />
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canManage && !self ? (
                    <NativeSelect
                      aria-label={t('common.role')}
                      value={u.roleKey}
                      onChange={(e) => void change(u, { roleKey: e.target.value as ClientRoleKey })}
                      className="h-9 w-40"
                      disabled={u.status === 'deactivated'}
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.key}>
                          {localized(r.name, locale)}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <Badge tone="brand">{roleName(u.roleKey)}</Badge>
                  )}
                  {canManage && !self ? (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        checked={u.canApprove}
                        disabled={u.roleKey === 'client_viewer' || u.status === 'deactivated'}
                        onCheckedChange={(v) => void change(u, { canApprove: v })}
                        aria-label={t('clients.users.canApprove')}
                      />
                      {t('clients.users.approver')}
                    </label>
                  ) : u.canApprove ? (
                    <Badge tone="success">
                      <BadgeCheck />
                      {t('clients.users.approver')}
                    </Badge>
                  ) : null}
                  {(canManage || canDelete) && !self ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={t('common.moreActions')} data-testid="client-user-menu">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {canManage ? (
                          <DropdownMenuItem onSelect={() => setDrawerUserId(u.userId)} data-testid="client-user-details">
                            <Info />
                            {t('clients.users.details')}
                          </DropdownMenuItem>
                        ) : null}
                        {canChangeEmail ? (
                          <DropdownMenuItem
                            onSelect={() => setEmailTarget({ kind: 'user', userId: u.userId, name: u.name, email: u.email, clientId })}
                            data-testid="client-user-change-email"
                          >
                            <Pencil />
                            {t('clients.users.changeEmail')}
                          </DropdownMenuItem>
                        ) : null}
                        {canManage || canChangeEmail ? <DropdownMenuSeparator /> : null}
                        {u.status === 'active' ? (
                          <DropdownMenuItem destructive onSelect={() => setConfirm(u)}>
                            <XCircle />
                            {t('clients.users.deactivate')}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onSelect={() => void change(u, { status: 'active' })}>
                            <RotateCw />
                            {t('admin.users.reactivate')}
                          </DropdownMenuItem>
                        )}
                        {canDelete ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive onSelect={() => setDeleting(u)} data-testid="client-user-delete">
                              <Trash2 />
                              {t('common.delete')}
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </Card>

      {invitations.length ? (
        <section>
          <h3 className="mb-3 text-sm font-semibold">{t('clients.users.pendingInvitations')}</h3>
          <Card className="divide-y divide-border">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="client-invitation-row">
                <Avatar name={inv.fullName ?? inv.email} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.fullName ?? inv.email}</p>
                  <p className="truncate text-xs text-subtle-foreground">
                    <Bdi>{inv.email}</Bdi> · {roleName(roles.find((r) => r.id === inv.roleId)?.key ?? '')}
                  </p>
                </div>
                <Badge tone={inv.status === 'expired' ? 'warning' : 'info'}>
                  {inv.status === 'expired' ? t('common.expired') : t('admin.users.expiresIn', { when: f.relative(inv.expiresAt) })}
                </Badge>
                {canManage ? (
                  <div className="flex flex-wrap gap-1">
                    {canChangeEmail ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEmailTarget({ kind: 'invitation', invitationId: inv.id, email: inv.email, clientId })}
                        data-testid="invitation-change-email"
                      >
                        <Pencil />
                        {t('clients.users.changeEmail')}
                      </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => void resend.run({ invitationId: inv.id })} loading={resend.pending}>
                      <RotateCw />
                      {t('admin.users.resend')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void revoke.run({ invitationId: inv.id })}>
                      <XCircle />
                      {t('admin.users.revoke')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      <ChangeEmailDialog
        target={emailTarget}
        onOpenChange={(o) => !o && setEmailTarget(null)}
        onAddExisting={canManage ? addExistingInstead : undefined}
      />
      {canManage ? (
        <PortalUserDrawer
          userId={drawerUserId}
          onOpenChange={(o) => !o && setDrawerUserId(null)}
          side={side}
          canChangeEmail={canChangeEmail}
          canDeactivateAccount={canDeactivateAccount}
          meUserId={meUserId}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('clients.users.deactivateTitle', { name: confirm?.name ?? '' })}
        description={t('clients.users.deactivateBody')}
        confirmLabel={t('clients.users.deactivate')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={async () => {
          if (confirm) await change(confirm, { status: 'deactivated' });
          setConfirm(null);
        }}
      />
    </div>
  );
}
