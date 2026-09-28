'use client';

import { Lock, RotateCcw, Save } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Fragment, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Badge, Card, Checkbox, Tooltip } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import { saveRolePermissionsAction } from '@/modules/rbac/server/actions';
import type { PermissionRow, RoleSummary } from '@/modules/rbac/server/queries';

type Grants = Record<string, Set<string>>;

const toGrants = (roles: RoleSummary[]): Grants => Object.fromEntries(roles.map((r) => [r.id, new Set(r.permissionKeys)]));

/**
 * Roles × permissions editor (UI.md §5). Changes are staged locally, summarized as a diff and saved
 * atomically; the database enforces locked roles and anti-escalation regardless of the UI.
 */
export function PermissionMatrix({
  roles,
  permissions,
  me,
}: {
  roles: RoleSummary[];
  permissions: PermissionRow[];
  me: { isSuperAdmin: boolean; permissions: string[]; canEdit: boolean };
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [grants, setGrants] = useState<Grants>(() => toGrants(roles));
  const [confirm, setConfirm] = useState(false);
  const original = useMemo(() => toGrants(roles), [roles]);
  const save = useAction(saveRolePermissionsAction, { successMessage: t('admin.roles.matrixSaved') });

  const changes = roles
    .map((r) => {
      const before = original[r.id] ?? new Set<string>();
      const after = grants[r.id] ?? new Set<string>();
      return {
        roleId: r.id,
        add: [...after].filter((k) => !before.has(k)),
        remove: [...before].filter((k) => !after.has(k)),
      };
    })
    .filter((c) => c.add.length || c.remove.length);
  const changeCount = changes.reduce((n, c) => n + c.add.length + c.remove.length, 0);

  const canToggle = (role: RoleSummary, key: string, adding: boolean) => {
    if (!me.canEdit || role.isLocked) return false;
    if (adding && role.side === 'agency' && !me.isSuperAdmin && !me.permissions.includes(key)) return false;
    return true;
  };

  const toggle = (role: RoleSummary, keys: string[], value: boolean) =>
    setGrants((g) => {
      const next = new Set(g[role.id]);
      for (const k of keys) {
        if (!canToggle(role, k, value)) continue;
        if (value) next.add(k);
        else next.delete(k);
      }
      return { ...g, [role.id]: next };
    });

  const sections = (['agency', 'client'] as const).map((side) => ({
    side,
    roles: roles.filter((r) => r.side === side),
    modules: [...new Set(permissions.filter((p) => p.side === side).map((p) => p.module))].map((mod) => ({
      mod,
      perms: permissions.filter((p) => p.side === side && p.module === mod),
    })),
  }));

  return (
    <div className="space-y-6" data-testid="permission-matrix">
      {sections.map((section) => (
        <Card key={section.side} className="overflow-hidden">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-semibold">{t(`admin.roles.${section.side}Roles`)}</h2>
            <p className="text-sm text-muted-foreground">{t(`admin.roles.${section.side}RolesHint`)}</p>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky start-0 top-0 z-20 min-w-60 border-b border-border bg-surface px-4 py-3 text-start text-xs font-medium text-muted-foreground">
                    {t('admin.roles.permission')}
                  </th>
                  {section.roles.map((r) => (
                    <th key={r.id} className="sticky top-0 z-10 min-w-28 border-b border-border bg-surface px-2 py-3 text-center text-xs font-medium">
                      <span className="inline-flex items-center gap-1">
                        {localized(r.name, locale)}
                        {r.isLocked ? <Lock className="size-3 text-subtle-foreground" aria-label={t('common.locked')} /> : null}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.modules.map(({ mod, perms }) => (
                  <Fragment key={mod}>
                    <tr className="bg-surface-muted/60">
                      <th className="sticky start-0 z-10 bg-surface-muted px-4 py-2 text-start text-xs font-semibold">{t(`admin.modules.${mod}` as never)}</th>
                      {section.roles.map((r) => {
                        const keys = perms.map((p) => p.key);
                        const held = keys.filter((k) => grants[r.id]?.has(k)).length;
                        return (
                          <td key={r.id} className="px-2 py-2 text-center">
                            <Checkbox
                              aria-label={`${t(`admin.modules.${mod}` as never)} · ${localized(r.name, locale)}`}
                              checked={r.isLocked || held === keys.length ? true : held > 0 ? 'indeterminate' : false}
                              disabled={!me.canEdit || r.isLocked}
                              onCheckedChange={(v) => toggle(r, keys, v === true)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                    {perms.map((p) => (
                      <tr key={p.key} className="hover:bg-surface-muted/40">
                        <th scope="row" className="sticky start-0 z-10 border-b border-border bg-surface px-4 py-2.5 text-start font-normal">
                          <span className="block">{localized(p.label, locale)}</span>
                          <code className="text-[0.6875rem] text-subtle-foreground" dir="ltr">
                            {p.key}
                          </code>
                        </th>
                        {section.roles.map((r) => {
                          const checked = r.isLocked || Boolean(grants[r.id]?.has(p.key));
                          const changed = !r.isLocked && checked !== Boolean(original[r.id]?.has(p.key));
                          const disabled = !canToggle(r, p.key, !checked);
                          const cell = (
                            <span className={cn('inline-flex rounded p-1', changed && 'bg-warning-soft ring-1 ring-warning/40')}>
                              <Checkbox
                                aria-label={`${localized(p.label, locale)} · ${localized(r.name, locale)}`}
                                checked={checked}
                                disabled={disabled}
                                onCheckedChange={(v) => toggle(r, [p.key], v === true)}
                                data-testid={`matrix-${r.key}-${p.key}`}
                              />
                            </span>
                          );
                          return (
                            <td key={r.id} className="border-b border-border px-2 py-2 text-center">
                              {disabled && me.canEdit && !r.isLocked ? <Tooltip content={t('admin.roles.cannotGrant')}>{cell}</Tooltip> : cell}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {changeCount > 0 ? (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-raised p-3 shadow-lg animate-fade-in">
          <Badge tone="warning">{t('admin.roles.pendingChanges', { count: changeCount })}</Badge>
          <div className="ms-auto flex gap-2">
            <Button variant="ghost" onClick={() => setGrants(toGrants(roles))}>
              <RotateCcw />
              {t('admin.roles.discard')}
            </Button>
            <Button onClick={() => setConfirm(true)} loading={save.pending} data-testid="matrix-save">
              <Save />
              {t('admin.roles.review')}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('admin.roles.confirmTitle')}
        description={
          <span className="block max-h-64 space-y-2 overflow-y-auto">
            {changes.map((c) => {
              const role = roles.find((r) => r.id === c.roleId)!;
              const label = (k: string) => localized(permissions.find((p) => p.key === k)?.label, locale);
              return (
                <span key={c.roleId} className="block">
                  <span className="font-medium text-foreground">{localized(role.name, locale)}</span>
                  {c.add.map((k) => (
                    <span key={`a${k}`} className="block text-success">
                      + {label(k)}
                    </span>
                  ))}
                  {c.remove.map((k) => (
                    <span key={`r${k}`} className="block text-danger">
                      − {label(k)}
                    </span>
                  ))}
                </span>
              );
            })}
          </span>
        }
        confirmLabel={t('common.saveChanges')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => save.run({ changes })}
      />
    </div>
  );
}
