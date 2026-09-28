import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { can, canAll, canAny, computeEffectivePermissions, toPermissionSet, ungrantablePermissions } from '@/lib/permissions/can';
import { agencyPermissions, allPermissions, clientPermissions } from '@/lib/permissions/catalog';

const universe = [...agencyPermissions];

describe('can()', () => {
  it('checks membership in a set or array', () => {
    const perms = toPermissionSet(['users:read', 'roles:read']);
    expect(can(perms, 'users:read')).toBe(true);
    expect(can(perms, 'roles:update')).toBe(false);
    expect(can(['portal:access'], 'portal:access')).toBe(true);
  });

  it('supports any / all', () => {
    const perms = toPermissionSet(['clients:read_assigned']);
    expect(canAny(perms, ['clients:read_all', 'clients:read_assigned'])).toBe(true);
    expect(canAll(perms, ['clients:read_all', 'clients:read_assigned'])).toBe(false);
  });
});

describe('computeEffectivePermissions (mirrors app.has_permission)', () => {
  it('unions role permissions and grants', () => {
    const eff = computeEffectivePermissions(
      [{ permissionKeys: ['users:read'] }, { permissionKeys: ['roles:read'] }],
      [{ permissionKey: 'clients:read_all', effect: 'grant' }],
      universe,
    );
    expect([...eff].sort()).toEqual(['clients:read_all', 'roles:read', 'users:read']);
  });

  it('deny always wins over roles and grants', () => {
    const eff = computeEffectivePermissions(
      [{ permissionKeys: ['users:read', 'roles:read'] }],
      [
        { permissionKey: 'roles:read', effect: 'deny' },
        { permissionKey: 'users:read', effect: 'grant' },
        { permissionKey: 'users:read', effect: 'deny' },
      ],
      universe,
    );
    expect([...eff]).toEqual([]);
  });

  it('a locked (Super Admin) role holds every permission and ignores denies', () => {
    const eff = computeEffectivePermissions(
      [{ permissionKeys: [], isLocked: true }],
      [{ permissionKey: 'roles:update', effect: 'deny' }],
      universe,
    );
    expect(eff.size).toBe(universe.length);
    expect(eff.has('roles:update')).toBe(true);
  });

  it('ignores permissions outside the universe (side mismatch)', () => {
    const eff = computeEffectivePermissions([{ permissionKeys: ['portal:access', 'users:read'] }], [], universe);
    expect([...eff]).toEqual(['users:read']);
  });
});

describe('ungrantablePermissions (mirrors app.assert_can_grant)', () => {
  it('blocks granting permissions the granter lacks', () => {
    expect(ungrantablePermissions(toPermissionSet(['users:read']), false, ['users:read', 'feature_flags:manage'])).toEqual([
      'feature_flags:manage',
    ]);
  });
  it('super admins can grant anything', () => {
    expect(ungrantablePermissions(toPermissionSet([]), true, ['feature_flags:manage'])).toEqual([]);
  });
});

describe('permission catalog', () => {
  it('matches the keys seeded by the migrations', () => {
    const dir = path.resolve(__dirname, '../../supabase/migrations');
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');
    const seeded = [...sql.matchAll(/^\s*\('([a-z_]+:[a-z_]+)',\s*'[a-z_]+',\s*'[a-z_]+',\s*'(agency|client)'/gm)].map((m) => ({
      key: m[1],
      side: m[2],
    }));
    expect(seeded.map((s) => s.key).sort()).toEqual([...allPermissions].sort());
    for (const s of seeded) {
      expect(s.side === 'agency' ? (agencyPermissions as readonly string[]) : (clientPermissions as readonly string[])).toContain(s.key);
    }
  });

  it('uses resource:action keys', () => {
    for (const key of allPermissions) expect(key).toMatch(/^[a-z_]+:[a-z_]+$/);
  });
});
