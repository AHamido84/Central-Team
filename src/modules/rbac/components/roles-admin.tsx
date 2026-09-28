'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Lock, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { SectionTitle } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { Badge, Card, Label, NativeSelect, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { PermissionMatrix } from '@/modules/rbac/components/permission-matrix';
import { createRoleAction, deleteRoleAction, updateRoleAction } from '@/modules/rbac/server/actions';
import type { PermissionRow, RoleSummary } from '@/modules/rbac/server/queries';

const roleSchema = z
  .object({
    nameAr: z.string().trim().max(60),
    nameEn: z.string().trim().max(60),
    descriptionAr: z.string().trim().max(200),
    descriptionEn: z.string().trim().max(200),
    copyFrom: z.string(),
  })
  .refine((v) => v.nameAr || v.nameEn, { message: 'required_one_language', path: ['nameAr'] });

function RoleDialog({
  role,
  roles,
  open,
  onOpenChange,
}: {
  role: RoleSummary | null;
  roles: RoleSummary[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const form = useForm<z.infer<typeof roleSchema>>({
    resolver: zodResolver(roleSchema),
    values: {
      nameAr: role?.name.ar ?? '',
      nameEn: role?.name.en ?? '',
      descriptionAr: role?.description.ar ?? '',
      descriptionEn: role?.description.en ?? '',
      copyFrom: '',
    },
  });
  const create = useAction(createRoleAction, { successMessage: t('admin.roles.created') });
  const update = useAction(updateRoleAction, { successMessage: t('common.saved') });
  const submit = form.handleSubmit(async (v) => {
    const payload = { name: { ar: v.nameAr, en: v.nameEn }, description: { ar: v.descriptionAr, en: v.descriptionEn } };
    const res = role
      ? await update.run({ ...payload, roleId: role.id })
      : await create.run({ ...payload, copyFromRoleId: v.copyFrom || null });
    if (res.ok) onOpenChange(false);
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{role ? t('admin.roles.editRole') : t('admin.roles.newRole')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('admin.nameAr')} error={form.formState.errors.nameAr?.message}>
                {(p) => <Input {...p} dir="rtl" lang="ar" {...form.register('nameAr')} data-testid="role-name-ar" />}
              </Field>
              <Field label={t('admin.nameEn')}>
                {(p) => <Input {...p} dir="ltr" lang="en" {...form.register('nameEn')} data-testid="role-name-en" />}
              </Field>
            </div>
            <Field label={t('admin.descriptionAr')} optional>
              {(p) => <Textarea {...p} dir="rtl" lang="ar" rows={2} {...form.register('descriptionAr')} />}
            </Field>
            <Field label={t('admin.descriptionEn')} optional>
              {(p) => <Textarea {...p} dir="ltr" lang="en" rows={2} {...form.register('descriptionEn')} />}
            </Field>
            {!role ? (
              <div className="grid gap-1.5">
                <Label htmlFor="copy-from">{t('admin.roles.copyFrom')}</Label>
                <NativeSelect id="copy-from" {...form.register('copyFrom')}>
                  <option value="">{t('admin.roles.startEmpty')}</option>
                  {roles
                    .filter((r) => r.side === 'agency' && !r.isLocked)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {localized(r.name, locale)}
                      </option>
                    ))}
                </NativeSelect>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting} data-testid="role-submit">
              {role ? t('common.saveChanges') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RolesAdmin({
  roles,
  permissions,
  me,
}: {
  roles: RoleSummary[];
  permissions: PermissionRow[];
  me: { isSuperAdmin: boolean; permissions: string[] };
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const search = useSearchParams();
  const [editing, setEditing] = useState<RoleSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<RoleSummary | null>(null);
  const remove = useAction(deleteRoleAction, { successMessage: t('admin.roles.deleted') });
  const can = (p: string) => me.permissions.includes(p);
  const tab = search.get('tab') === 'matrix' ? 'matrix' : 'roles';

  const roleCard = (r: RoleSummary) => {
    const total = permissions.filter((p) => p.side === r.side).length;
    const count = r.isLocked ? total : r.permissionKeys.length;
    return (
      <Card key={r.id} className="flex flex-col gap-3 p-5" data-testid={`role-card-${r.key}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold">
              {localized(r.name, locale)}
              {r.isLocked ? <Lock className="size-3.5 text-subtle-foreground" aria-label={t('common.locked')} /> : null}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{localized(r.description, locale) || '—'}</p>
          </div>
          {can('roles:update') || (can('roles:delete') && !r.isSystem) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t('common.moreActions')}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {can('roles:update') ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(r);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil />
                    {t('common.edit')}
                  </DropdownMenuItem>
                ) : null}
                {can('roles:delete') && !r.isSystem ? (
                  <DropdownMenuItem destructive onSelect={() => setDeleting(r)}>
                    <Trash2 />
                    {t('common.delete')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 text-xs">
          <Badge tone={r.isSystem ? 'neutral' : 'accent'}>{r.isSystem ? t('common.systemRole') : t('common.custom')}</Badge>
          <Badge tone="outline">
            <ShieldCheck />
            {t('admin.roles.permissionCount', { count, total })}
          </Badge>
          <Badge tone="outline">
            <Users />
            {t('admin.roles.memberCount', { count: r.memberCount })}
          </Badge>
        </div>
      </Card>
    );
  };

  return (
    <>
      <Tabs value={tab} onValueChange={(v) => router.replace(v === 'matrix' ? '?tab=matrix' : '?', { scroll: false })}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="roles">{t('admin.roles.rolesTab')}</TabsTrigger>
            <TabsTrigger value="matrix" data-testid="tab-matrix">
              {t('admin.roles.matrixTab')}
            </TabsTrigger>
          </TabsList>
          {can('roles:create') ? (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              data-testid="new-role"
            >
              <Plus />
              {t('admin.roles.newRole')}
            </Button>
          ) : null}
        </div>
        <TabsContent value="roles" className="space-y-8">
          <section>
            <SectionTitle title={t('admin.roles.agencyRoles')} />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{roles.filter((r) => r.side === 'agency').map(roleCard)}</div>
          </section>
          <section>
            <SectionTitle title={t('admin.roles.clientRoles')} />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{roles.filter((r) => r.side === 'client').map(roleCard)}</div>
          </section>
        </TabsContent>
        <TabsContent value="matrix">
          <PermissionMatrix roles={roles} permissions={permissions} me={{ ...me, canEdit: can('roles:update') }} />
        </TabsContent>
      </Tabs>
      <RoleDialog role={editing} roles={roles} open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('admin.roles.deleteTitle')}
        description={t('admin.roles.deleteBody', { name: deleting ? localized(deleting.name, locale) : '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={async () => {
          if (deleting) await remove.run({ roleId: deleting.id });
          setDeleting(null);
        }}
      />
    </>
  );
}
