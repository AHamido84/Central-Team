'use client';

import { Ban, CheckCircle2, Lock, Mail, Phone, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Bdi } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog, Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/overlays';
import { Avatar, Badge, Checkbox, Label, NativeSelect, Separator } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { computeEffectivePermissions } from '@/lib/permissions/can';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import {
  setMemberRolesAction,
  setMemberStatusAction,
  setPermissionOverrideAction,
  updateMemberAction,
} from '@/modules/rbac/server/actions';
import type { PermissionRow, RoleSummary, TeamMember } from '@/modules/rbac/server/queries';

export function MemberSheet({
  member,
  onOpenChange,
  roles,
  departments,
  permissions,
  me,
  grantable,
}: {
  member: TeamMember | null;
  onOpenChange: (open: boolean) => void;
  roles: RoleSummary[];
  departments: { id: string; name: LocalizedText }[];
  permissions: PermissionRow[];
  me: { userId: string; isSuperAdmin: boolean; permissions: string[] };
  grantable: string[];
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const can = (p: string) => me.permissions.includes(p);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [jobTitle, setJobTitle] = useState('');
  const [confirmStatus, setConfirmStatus] = useState(false);

  useEffect(() => {
    setRoleIds(member?.roleIds ?? []);
    setJobTitle(member?.jobTitle ?? '');
  }, [member]);

  const saveRoles = useAction(setMemberRolesAction, { successMessage: t('admin.users.rolesSaved') });
  const saveMember = useAction(updateMemberAction, { successMessage: t('common.saved') });
  const setStatus = useAction(setMemberStatusAction);
  const setOverride = useAction(setPermissionOverrideAction, { successMessage: t('common.saved') });

  if (!member) return <Sheet open={false} onOpenChange={onOpenChange} />;

  const isSelf = member.userId === me.userId;
  const rolesDirty = [...roleIds].sort().join() !== [...member.roleIds].sort().join();
  const effective = computeEffectivePermissions(
    roles.filter((r) => member.roleIds.includes(r.id)).map((r) => ({ permissionKeys: r.permissionKeys, isLocked: r.isLocked })),
    member.overrides,
    permissions.map((p) => p.key),
  );
  const fromRoles = new Set(roles.filter((r) => member.roleIds.includes(r.id)).flatMap((r) => (r.isLocked ? permissions.map((p) => p.key) : r.permissionKeys)));
  const modules = [...new Set(permissions.map((p) => p.module))];

  return (
    <Sheet open={Boolean(member)} onOpenChange={onOpenChange}>
      <SheetContent closeLabel={t('common.close')} className="w-[min(100vw,34rem)] overflow-y-auto" data-testid="member-sheet">
        <div className="flex items-center gap-4 border-b border-border p-5 pe-12">
          <Avatar name={member.name} src={publicAssetUrl(member.avatarPath)} size="lg" />
          <div className="min-w-0">
            <SheetTitle className="truncate">{member.name}</SheetTitle>
            <SheetDescription className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1">
                <Mail className="size-3.5" aria-hidden />
                <Bdi>{member.email}</Bdi>
              </span>
              {member.phone ? (
                <span className="inline-flex items-center gap-1">
                  <Phone className="size-3.5" aria-hidden />
                  <Bdi>{member.phone}</Bdi>
                </span>
              ) : null}
            </SheetDescription>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {member.status === 'active' ? <Badge tone="success" dot>{t('common.active')}</Badge> : <Badge dot>{t('common.deactivated')}</Badge>}
              <Badge>{t('admin.users.joinedOn', { date: f.date(member.joinedAt) })}</Badge>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-5">
          <section className="grid gap-2">
            <Label htmlFor="member-title">{t('admin.users.jobTitle')}</Label>
            <div className="flex gap-2">
              <Input id="member-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} disabled={!can('users:update')} />
              {can('users:update') && jobTitle !== (member.jobTitle ?? '') ? (
                <Button onClick={() => void saveMember.run({ userId: member.userId, jobTitle })} loading={saveMember.pending}>
                  {t('common.save')}
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-subtle-foreground">
              {t('admin.users.departments')}: {f.list(member.departmentIds.map((id) => localized(departments.find((d) => d.id === id)?.name, locale))) || '—'}
            </p>
          </section>

          <Separator />

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t('common.roles')}</h3>
              {rolesDirty ? (
                <Button size="sm" onClick={() => void saveRoles.run({ userId: member.userId, roleIds })} loading={saveRoles.pending} data-testid="member-roles-save">
                  {t('common.saveChanges')}
                </Button>
              ) : null}
            </div>
            <div className="grid gap-2">
              {roles.map((r) => {
                const disabled = !can('roles:assign') || !grantable.includes(r.id) || (isSelf && !me.isSuperAdmin);
                const checked = roleIds.includes(r.id);
                return (
                  <label
                    key={r.id}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border border-border p-3 transition-colors',
                      checked && 'border-primary/60 bg-primary-soft/40',
                      disabled ? 'opacity-60' : 'cursor-pointer hover:bg-surface-muted',
                    )}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(v) => setRoleIds((ids) => (v ? [...ids, r.id] : ids.filter((x) => x !== r.id)))}
                      data-testid={`member-role-${r.key}`}
                    />
                    <span className="grid gap-0.5">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {localized(r.name, locale)}
                        {r.isLocked ? <Lock className="size-3.5 text-subtle-foreground" aria-label={t('common.locked')} /> : null}
                      </span>
                      <span className="text-xs text-subtle-foreground">{localized(r.description, locale)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="text-sm font-semibold">{t('admin.users.effectivePermissions')}</h3>
            <p className="mt-1 text-xs text-subtle-foreground">{t('admin.users.overridesHint')}</p>
            <div className="mt-3 space-y-4">
              {modules.map((mod) => (
                <div key={mod}>
                  <p className="mb-1.5 text-xs font-medium text-subtle-foreground">{t(`admin.modules.${mod}` as never)}</p>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {permissions
                      .filter((p) => p.module === mod)
                      .map((p) => {
                        const override = member.overrides.find((o) => o.permissionKey === p.key);
                        const has = effective.has(p.key);
                        return (
                          <li key={p.key} className="flex items-center gap-3 px-3 py-2">
                            {has ? (
                              <CheckCircle2 className="size-4 shrink-0 text-success" aria-label={t('admin.users.granted')} />
                            ) : (
                              <Ban className="size-4 shrink-0 text-subtle-foreground" aria-label={t('admin.users.notGranted')} />
                            )}
                            <span className="min-w-0 flex-1 text-sm">
                              {localized(p.label, locale)}
                              {fromRoles.has(p.key) && !override ? <span className="ms-1.5 text-xs text-subtle-foreground">({t('admin.users.viaRole')})</span> : null}
                            </span>
                            {can('permissions:override') && !isSelf ? (
                              <NativeSelect
                                aria-label={t('admin.users.override')}
                                className="h-8 w-32 text-xs sm:h-8"
                                value={override?.effect ?? 'none'}
                                onChange={(e) =>
                                  void setOverride.run({ userId: member.userId, permissionKey: p.key, effect: e.target.value as 'grant' | 'deny' | 'none', reason: undefined })
                                }
                              >
                                <option value="none">{t('admin.users.inherit')}</option>
                                <option value="grant" disabled={!me.isSuperAdmin && !can(p.key)}>
                                  {t('admin.users.grant')}
                                </option>
                                <option value="deny">{t('admin.users.deny')}</option>
                              </NativeSelect>
                            ) : override ? (
                              <Badge tone={override.effect === 'grant' ? 'success' : 'danger'}>{t(`admin.users.${override.effect}`)}</Badge>
                            ) : null}
                          </li>
                        );
                      })}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {can('users:deactivate') && !isSelf ? (
            <>
              <Separator />
              <section className="flex items-center justify-between gap-3 rounded-lg border border-border p-4">
                <div>
                  <p className="text-sm font-medium">{member.status === 'active' ? t('admin.users.deactivate') : t('admin.users.reactivate')}</p>
                  <p className="text-xs text-subtle-foreground">{member.status === 'active' ? t('admin.users.deactivateHint') : t('admin.users.reactivateHint')}</p>
                </div>
                <Button variant={member.status === 'active' ? 'destructive' : 'outline'} size="sm" onClick={() => setConfirmStatus(true)} data-testid="member-status-toggle">
                  <ShieldCheck />
                  {member.status === 'active' ? t('admin.users.deactivate') : t('admin.users.reactivate')}
                </Button>
              </section>
              <ConfirmDialog
                open={confirmStatus}
                onOpenChange={setConfirmStatus}
                title={member.status === 'active' ? t('admin.users.deactivateTitle', { name: member.name }) : t('admin.users.reactivateTitle', { name: member.name })}
                description={member.status === 'active' ? t('admin.users.deactivateBody') : t('admin.users.reactivateBody')}
                confirmLabel={member.status === 'active' ? t('admin.users.deactivate') : t('admin.users.reactivate')}
                cancelLabel={t('common.cancel')}
                destructive={member.status === 'active'}
                onConfirm={() => setStatus.run({ userId: member.userId, status: member.status === 'active' ? 'deactivated' : 'active' })}
              />
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
