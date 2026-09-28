'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { UserPlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/overlays';
import { Checkbox, Label, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type LocalizedText } from '@/lib/i18n/localized';
import { inviteTeamMemberAction } from '@/modules/invitations/server/actions';

const schema = z.object({
  email: z.email({ message: 'invalid_email' }),
  fullName: z.string().max(120).optional(),
  roleIds: z.array(z.string()).min(1, { message: 'min_one' }),
  departmentId: z.string(),
  locale: z.enum(['ar', 'en']),
});

export function InviteTeamDialog({
  roles,
  departments,
  grantable,
}: {
  roles: { id: string; name: LocalizedText; description: LocalizedText }[];
  departments: { id: string; name: LocalizedText }[];
  /** Role ids the current user may grant (anti-escalation mirrored from the database). */
  grantable: string[];
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', fullName: '', roleIds: [], departmentId: '', locale: locale === 'en' ? 'en' : 'ar' },
  });
  const { run } = useAction(inviteTeamMemberAction, { successMessage: t('admin.users.inviteSent') });
  const submit = form.handleSubmit(async (values) => {
    const res = await run({ ...values, departmentId: values.departmentId || null, fullName: values.fullName || undefined });
    if (res.ok) {
      form.reset();
      setOpen(false);
    }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="invite-team-open">
          <UserPlus />
          {t('admin.users.invite')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('common.close')}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{t('admin.users.inviteTitle')}</DialogTitle>
            <DialogDescription>{t('admin.users.inviteDescription')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('common.email')} error={form.formState.errors.email?.message} required>
                {(p) => <Input {...p} type="email" dir="ltr" {...form.register('email')} data-testid="invite-email" />}
              </Field>
              <Field label={t('common.name')} optional>
                {(p) => <Input {...p} {...form.register('fullName')} />}
              </Field>
            </div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">
                {t('common.roles')}
                <span className="ms-0.5 text-danger" aria-hidden>
                  *
                </span>
              </legend>
              <Controller
                control={form.control}
                name="roleIds"
                render={({ field }) => (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {roles.map((r) => {
                      const disabled = !grantable.includes(r.id);
                      const checked = field.value.includes(r.id);
                      return (
                        <label key={r.id} className={`flex gap-3 rounded-lg border border-border p-3 ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-surface-muted'} ${checked ? 'border-primary bg-primary-soft/40' : ''}`}>
                          <Checkbox
                            checked={checked}
                            disabled={disabled}
                            onCheckedChange={(v) => field.onChange(v ? [...field.value, r.id] : field.value.filter((x) => x !== r.id))}
                            data-testid={`invite-role-${r.id}`}
                          />
                          <span className="grid gap-0.5">
                            <span className="text-sm font-medium">{localized(r.name, locale as 'ar' | 'en')}</span>
                            <span className="text-xs text-subtle-foreground">{localized(r.description, locale as 'ar' | 'en')}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              />
              {form.formState.errors.roleIds ? <p className="text-xs font-medium text-danger">{t('validation.min_one')}</p> : null}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="invite-dept">{t('common.department')}</Label>
                <NativeSelect id="invite-dept" {...form.register('departmentId')}>
                  <option value="">{t('common.none')}</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {localized(d.name, locale as 'ar' | 'en')}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="invite-locale">{t('admin.users.emailLanguage')}</Label>
                <NativeSelect id="invite-locale" {...form.register('locale')}>
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </NativeSelect>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting} data-testid="invite-submit">
              {t('admin.users.sendInvite')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
