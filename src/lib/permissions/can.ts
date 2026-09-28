import type { Permission } from '@/lib/permissions/catalog';

/**
 * Serializable set of effective permissions for the current user. Built from
 * `app.effective_permissions()` / `app.client_effective_permissions()` so it mirrors the
 * database exactly; the DB (RLS) remains the enforcement point (ADR-002).
 */
export type PermissionSet = ReadonlySet<string>;

export function toPermissionSet(keys: Iterable<string>): PermissionSet {
  return new Set(keys);
}

export function can(perms: PermissionSet | readonly string[], permission: Permission): boolean {
  return Array.isArray(perms) ? perms.includes(permission) : (perms as PermissionSet).has(permission);
}

export function canAny(perms: PermissionSet | readonly string[], permissions: readonly Permission[]): boolean {
  return permissions.some((p) => can(perms, p));
}

export function canAll(perms: PermissionSet | readonly string[], permissions: readonly Permission[]): boolean {
  return permissions.every((p) => can(perms, p));
}

export type RoleGrant = { permissionKeys: readonly string[]; isLocked?: boolean };
export type Override = { permissionKey: string; effect: 'grant' | 'deny' };

/**
 * Pure re-implementation of `app.has_permission` used by the permission-matrix preview and unit tests:
 * effective = (roles ∪ grants) − denies; a locked (Super Admin) role holds every permission.
 */
export function computeEffectivePermissions(
  roles: readonly RoleGrant[],
  overrides: readonly Override[],
  universe: readonly string[],
): Set<string> {
  if (roles.some((r) => r.isLocked)) return new Set(universe);
  const result = new Set<string>();
  for (const role of roles) for (const key of role.permissionKeys) result.add(key);
  for (const o of overrides) if (o.effect === 'grant') result.add(o.permissionKey);
  for (const o of overrides) if (o.effect === 'deny') result.delete(o.permissionKey);
  return new Set([...result].filter((k) => universe.includes(k)));
}

/** Mirrors `app.assert_can_grant`: a non-super-admin can only grant permissions they hold. */
export function ungrantablePermissions(
  granter: PermissionSet,
  granterIsSuperAdmin: boolean,
  requested: readonly string[],
): string[] {
  if (granterIsSuperAdmin) return [];
  return requested.filter((k) => !granter.has(k));
}
