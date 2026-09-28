'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { BadgeCheck, MailPlus, MoreHorizontal, RotateCw, UserPlus, Users, XCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { Avatar, Badge, Card, NativeSelect, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { languageNames, localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { clientRoleKeys, type ClientRoleKey } from '@/modules/clients/constants';
import { updateClientUserAction } from '@/modules/clients/server/actions';
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

function InviteClientUserDialog({ clientId, roles, clientName }: { clientId: string; roles: RoleOption[]; clientName: string }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(false);
  const form = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', fullName: '', jobTitle: '', clientRoleKey: 'client_member', canApprove: false, locale },
  });
  const invite = useAction(inviteClientUserAction, { successMessage: t('admin.users.inviteSent') });
  const submit = form.handleSubmit(async (v) => {
    const res = await invite.run({ ...v, clientId, fullName: v.fullName || undefined, jobTitle: v.jobTitle || undefined });
    if (res.ok) {
      form.reset();
      setOpen(false);
    }
  });
  const roleKey = form.watch('clientRoleKey');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} data-testid="invite-client-user">
        <UserPlus />
        {t('clients.users.invite')}
      </Button>
      <DialogContent closeLabel={t('common.close')}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{t('clients.users.inviteTitle', { client: clientName })}</DialogTitle>
            <DialogDescription>{t('clients.users.inviteDescription')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('common.email')} error={form.formState.errors.email?.message} required>
                {(p) => <Input {...p} type="email" dir="ltr" {...form.register('email')} data-testid="client-invite-email" />}
              </Field>
              <Field label={t('common.name')} optional>
                {(p) => <Input {...p} {...form.register('fullName')} />}
              </Field>
            </div>
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
            <Field label={t('admin.users.emailLanguage')}>
              {(p) => (
                <NativeSelect {...p} {...form.register('locale')}>
                  <option value="ar">{languageNames.ar}</option>
                  <option value="en">{languageNames.en}</option>
                </NativeSelect>
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting} data-testid="client-invite-submit">
              <MailPlus />
              {t('admin.users.sendInvite')}
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
  meUserId,
}: {
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{t('clients.users.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('clients.users.description')}</p>
        </div>
        {canManage ? <InviteClientUserDialog clientId={clientId} roles={roles} clientName={clientName} /> : null}
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
                      {u.name}
                      {self ? <Badge>{t('common.you')}</Badge> : null}
                      {u.status === 'deactivated' ? <Badge tone="neutral">{t('common.deactivated')}</Badge> : null}
                    </p>
                    <p className="truncate text-xs text-subtle-foreground">
                      <Bdi>{u.email}</Bdi>
                      {u.jobTitle ? ` · ${u.jobTitle}` : ''}
                    </p>
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
                  {canManage && !self ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={t('common.moreActions')}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
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
                  <div className="flex gap-1">
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
