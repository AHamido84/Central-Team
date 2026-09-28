'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, Crown, Network, Pencil, Plus, UsersRound } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/overlays';
import { Avatar, AvatarGroup, Badge, Card, Checkbox, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { departmentColorClass, departmentColors, type DepartmentColor } from '@/modules/departments/constants';
import { createDepartmentAction, setDepartmentMembersAction, updateDepartmentAction } from '@/modules/departments/server/actions';

export type DepartmentView = {
  id: string;
  name: LocalizedText;
  color: DepartmentColor;
  isArchived: boolean;
  members: { userId: string; isLead: boolean }[];
};
export type PersonView = { userId: string; name: string; avatarPath: string | null; jobTitle: string | null };

const schema = z
  .object({
    nameAr: z.string().trim().max(60),
    nameEn: z.string().trim().max(60),
    color: z.enum(departmentColors),
    isArchived: z.boolean(),
  })
  .refine((v) => v.nameAr || v.nameEn, { message: 'required_one_language', path: ['nameAr'] });

function DepartmentDialog({
  department,
  open,
  onOpenChange,
}: {
  department: DepartmentView | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations();
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    values: {
      nameAr: department?.name.ar ?? '',
      nameEn: department?.name.en ?? '',
      color: department?.color ?? 'primary',
      isArchived: department?.isArchived ?? false,
    },
  });
  const create = useAction(createDepartmentAction, { successMessage: t('admin.departments.created') });
  const update = useAction(updateDepartmentAction, { successMessage: t('common.saved') });
  const submit = form.handleSubmit(async (v) => {
    const name = { ar: v.nameAr, en: v.nameEn };
    const res = department
      ? await update.run({ departmentId: department.id, name, color: v.color, isArchived: v.isArchived })
      : await create.run({ name, color: v.color });
    if (res.ok) onOpenChange(false);
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{department ? t('admin.departments.edit') : t('admin.departments.new')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label={t('admin.nameAr')} error={form.formState.errors.nameAr?.message}>
              {(p) => <Input {...p} dir="rtl" lang="ar" {...form.register('nameAr')} />}
            </Field>
            <Field label={t('admin.nameEn')}>{(p) => <Input {...p} dir="ltr" lang="en" {...form.register('nameEn')} />}</Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t('admin.departments.color')}</legend>
              <Controller
                control={form.control}
                name="color"
                render={({ field }) => (
                  <div className="flex flex-wrap gap-2">
                    {departmentColors.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => field.onChange(c)}
                        aria-pressed={field.value === c}
                        aria-label={c}
                        className={cn(
                          'size-8 rounded-full ring-offset-2 ring-offset-surface',
                          departmentColorClass[c],
                          field.value === c && 'ring-2 ring-ring',
                        )}
                      />
                    ))}
                  </div>
                )}
              />
            </fieldset>
            {department ? (
              <Controller
                control={form.control}
                name="isArchived"
                render={({ field }) => (
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <span>
                      <span className="block text-sm font-medium">{t('admin.departments.archived')}</span>
                      <span className="block text-xs text-subtle-foreground">{t('admin.departments.archivedHint')}</span>
                    </span>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </label>
                )}
              />
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {department ? t('common.saveChanges') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MembersSheet({
  department,
  people,
  onOpenChange,
}: {
  department: DepartmentView | null;
  people: PersonView[];
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [members, setMembers] = useState<{ userId: string; isLead: boolean }[]>(department?.members ?? []);
  const save = useAction(setDepartmentMembersAction, { successMessage: t('common.saved') });
  if (!department) return <Sheet open={false} onOpenChange={onOpenChange} />;
  const toggle = (userId: string, on: boolean) =>
    setMembers((m) => (on ? [...m, { userId, isLead: false }] : m.filter((x) => x.userId !== userId)));
  const setLead = (userId: string, isLead: boolean) => setMembers((m) => m.map((x) => (x.userId === userId ? { ...x, isLead } : x)));
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent closeLabel={t('common.close')} className="flex flex-col">
        <div className="border-b border-border p-5 pe-12">
          <SheetTitle>{localized(department.name, locale)}</SheetTitle>
          <SheetDescription>{t('admin.departments.membersHint')}</SheetDescription>
        </div>
        <ul className="flex-1 divide-y divide-border overflow-y-auto">
          {people.map((p) => {
            const m = members.find((x) => x.userId === p.userId);
            return (
              <li key={p.userId} className="flex items-center gap-3 px-5 py-3">
                <Checkbox checked={Boolean(m)} onCheckedChange={(v) => toggle(p.userId, v === true)} aria-label={p.name} />
                <Avatar name={p.name} src={publicAssetUrl(p.avatarPath)} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-subtle-foreground">{p.jobTitle}</span>
                </span>
                {m ? (
                  <Button
                    type="button"
                    size="sm"
                    variant={m.isLead ? 'soft' : 'ghost'}
                    onClick={() => setLead(p.userId, !m.isLead)}
                    aria-pressed={m.isLead}
                  >
                    <Crown />
                    {t('dashboard.lead')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={save.pending}
            onClick={async () => {
              const res = await save.run({ departmentId: department.id, members });
              if (res.ok) onOpenChange(false);
            }}
          >
            {t('common.saveChanges')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function DepartmentsAdmin({ departments, people }: { departments: DepartmentView[]; people: PersonView[] }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [editing, setEditing] = useState<DepartmentView | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [membersFor, setMembersFor] = useState<DepartmentView | null>(null);
  const person = (id: string) => people.find((p) => p.userId === id);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus />
          {t('admin.departments.new')}
        </Button>
      </div>
      {departments.length === 0 ? (
        <Card>
          <EmptyState icon={Network} title={t('admin.departments.empty')} />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {departments.map((d) => {
            const leads = d.members
              .filter((m) => m.isLead)
              .map((m) => person(m.userId)?.name)
              .filter(Boolean) as string[];
            return (
              <Card key={d.id} className={cn('flex flex-col gap-4 p-5', d.isArchived && 'opacity-60')}>
                <div className="flex items-start gap-3">
                  <span className={cn('flex size-10 items-center justify-center rounded-lg', departmentColorClass[d.color])}>
                    <Network className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{localized(d.name, locale)}</p>
                    <p className="text-xs text-subtle-foreground">
                      {leads.length ? t('admin.departments.ledBy', { names: leads.join(' · ') }) : t('admin.departments.noLead')}
                    </p>
                  </div>
                  {d.isArchived ? (
                    <Badge>
                      <Archive />
                      {t('admin.departments.archived')}
                    </Badge>
                  ) : null}
                </div>
                <AvatarGroup
                  max={6}
                  people={d.members.map((m) => ({
                    id: m.userId,
                    name: person(m.userId)?.name ?? '',
                    src: publicAssetUrl(person(m.userId)?.avatarPath),
                  }))}
                />
                <div className="mt-auto flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setMembersFor(d)}>
                    <UsersRound />
                    {t('admin.departments.manageMembers', { count: d.members.length })}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(d);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil />
                    {t('common.edit')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <DepartmentDialog department={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <MembersSheet
        key={membersFor?.id ?? 'none'}
        department={membersFor}
        people={people}
        onOpenChange={(o) => !o && setMembersFor(null)}
      />
    </>
  );
}
