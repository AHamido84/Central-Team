/**
 * Phase 0 security: RLS coverage, RBAC enforcement in the database, anti-escalation, audit, notifications.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { as, attempt, sql, userId } from './helpers';

afterAll(async () => {
  await sql.end();
});

const SERVICE_ONLY = new Set(['rate_limits', 'domain_event_deliveries']);

describe('RLS coverage (meta)', () => {
  it('every public table has RLS enabled', async () => {
    const rows = await sql<
      { tablename: string; rowsecurity: boolean }[]
    >`select tablename, rowsecurity from pg_tables where schemaname = 'public'`;
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.filter((r) => !r.rowsecurity).map((r) => r.tablename)).toEqual([]);
  });

  it('every public table has at least one policy (except service-only tables)', async () => {
    const rows = await sql<{ tablename: string; n: number }[]>`
      select t.tablename, count(p.policyname)::int as n from pg_tables t
      left join pg_policies p on p.schemaname = t.schemaname and p.tablename = t.tablename
      where t.schemaname = 'public' group by t.tablename`;
    expect(rows.filter((r) => r.n === 0 && !SERVICE_ONLY.has(r.tablename)).map((r) => r.tablename)).toEqual([]);
  });

  it('anon has no privileges on any public table', async () => {
    const rows = await sql<{ table_name: string }[]>`
      select distinct table_name from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`;
    expect(rows).toEqual([]);
    const res = await attempt(null, (tx) => tx`select * from public.profiles limit 1`);
    expect(res?.code).toBe('42501');
  });
});

describe('roles & permissions are enforced by the database', () => {
  it('a Specialist cannot change role permissions', async () => {
    const [role] = await sql<
      { id: string; organization_id: string }[]
    >`select id, organization_id from public.roles where key = 'specialist'`;
    const res = await attempt(
      'khalid@ofoq.test',
      (tx) =>
        tx`insert into public.role_permissions (role_id, permission_key, organization_id) values (${role!.id}, 'roles:update', ${role!.organization_id})`,
    );
    expect(res?.code).toBe('42501');
  });

  it('an Admin cannot grant a permission they do not hold (anti-escalation)', async () => {
    const [role] = await sql<
      { id: string; organization_id: string }[]
    >`select id, organization_id from public.roles where key = 'team_lead'`;
    const res = await attempt(
      'faisal@ofoq.test',
      (tx) =>
        tx`insert into public.role_permissions (role_id, permission_key, organization_id) values (${role!.id}, 'feature_flags:manage', ${role!.organization_id})`,
    );
    expect(res?.message).toBe('cannot_grant_unheld_permission');
    // …while granting something they hold works.
    const ok = await attempt(
      'faisal@ofoq.test',
      (tx) =>
        tx`insert into public.role_permissions (role_id, permission_key, organization_id) values (${role!.id}, 'audit_log:read', ${role!.organization_id})`,
    );
    expect(ok).toBeNull();
  });

  it('an Admin cannot assign the Super Admin role', async () => {
    const [role] = await sql<
      { id: string; organization_id: string }[]
    >`select id, organization_id from public.roles where key = 'super_admin'`;
    const faisal = await userId('faisal@ofoq.test');
    const res = await attempt(
      'faisal@ofoq.test',
      (tx) =>
        tx`insert into public.user_roles (organization_id, user_id, role_id) values (${role!.organization_id}, ${faisal}, ${role!.id})`,
    );
    expect(res?.message).toBe('cannot_grant_unheld_permission');
  });

  it('the locked Super Admin role cannot lose permissions, and system roles cannot be deleted', async () => {
    const [role] = await sql<{ id: string }[]>`select id from public.roles where key = 'super_admin'`;
    const locked = await attempt('sara@ofoq.test', (tx) => tx`delete from public.role_permissions where role_id = ${role!.id}`);
    expect(locked?.message).toBe('role_locked');
    const [admin] = await sql<{ id: string }[]>`select id from public.roles where key = 'admin'`;
    const del = await attempt('sara@ofoq.test', (tx) => tx`delete from public.roles where id = ${admin!.id}`);
    expect(del?.message).toBe('system_role_not_deletable');
  });

  it('the last Super Admin cannot be removed or deactivated', async () => {
    const sara = await userId('sara@ofoq.test');
    const [role] = await sql<{ id: string }[]>`select id from public.roles where key = 'super_admin'`;
    const removed = await attempt(
      'sara@ofoq.test',
      (tx) => tx`delete from public.user_roles where user_id = ${sara} and role_id = ${role!.id}`,
    );
    expect(removed?.message).toBe('last_super_admin');
    const self = await attempt(
      'sara@ofoq.test',
      (tx) => tx`update public.organization_members set status = 'deactivated' where user_id = ${sara}`,
    );
    expect(self?.message).toBe('cannot_deactivate_self');
  });

  it('a Super Admin can edit the permission matrix', async () => {
    const [role] = await sql<
      { id: string; organization_id: string }[]
    >`select id, organization_id from public.roles where key = 'specialist'`;
    const res = await attempt(
      'sara@ofoq.test',
      (tx) =>
        tx`insert into public.role_permissions (role_id, permission_key, organization_id) values (${role!.id}, 'feature_flags:manage', ${role!.organization_id})`,
    );
    expect(res).toBeNull();
  });

  it('app.has_permission matches seeded grants', async () => {
    const [org] = await sql<{ id: string }[]>`select id from public.organizations limit 1`;
    const check = (email: string, perm: string) =>
      as(email, async (tx) => (await tx<{ ok: boolean }[]>`select app.has_permission(${org!.id}, ${perm}) as ok`)[0]!.ok);
    expect(await check('sara@ofoq.test', 'feature_flags:manage')).toBe(true);
    expect(await check('faisal@ofoq.test', 'feature_flags:manage')).toBe(false);
    expect(await check('faisal@ofoq.test', 'roles:update')).toBe(true);
    expect(await check('noura@ofoq.test', 'client_users:manage')).toBe(true);
    expect(await check('khalid@ofoq.test', 'users:update')).toBe(false);
    expect(await check('mohammed@najd.test', 'users:read')).toBe(false);
  });
});

describe('side separation', () => {
  it('client users cannot read agency-only data', async () => {
    const counts = await as('mohammed@najd.test', async (tx) => ({
      departments: (await tx`select count(*)::int as n from public.departments`)[0]!.n,
      members: (await tx`select count(*)::int as n from public.organization_members where user_type = 'agency'`)[0]!.n,
      rolePermissions: (await tx`select count(*)::int as n from public.role_permissions`)[0]!.n,
      audit: (await tx`select count(*)::int as n from public.activity_log`)[0]!.n,
      agencyRoles: (await tx`select count(*)::int as n from public.roles where side = 'agency'`)[0]!.n,
    }));
    expect(counts).toEqual({ departments: 0, members: 0, rolePermissions: 0, audit: 0, agencyRoles: 0 });
  });
});

describe('audit, events and notifications', () => {
  it('mutations are recorded in activity_log with before/after and actor', async () => {
    const sara = await userId('sara@ofoq.test');
    const row = await as('sara@ofoq.test', async (tx) => {
      const [dept] = await tx<{ id: string }[]>`select id from public.departments where key = 'design'`;
      await tx`update public.departments set color = 'rose' where id = ${dept!.id}`;
      const [log] = await tx<
        { actor_id: string; action: string; changed_fields: string[]; before: { color: string }; after: { color: string } }[]
      >`
        select actor_id, action, changed_fields, before, after from public.activity_log where table_name = 'departments' and record_id = ${dept!.id} order by id desc limit 1`;
      return log;
    });
    expect(row).toMatchObject({
      actor_id: sara,
      action: 'update',
      changed_fields: ['color'],
      before: { color: 'violet' },
      after: { color: 'rose' },
    });
  });

  it('activity_log requires audit_log:read and is append-only', async () => {
    const { n } = (await as('khalid@ofoq.test', (tx) => tx`select count(*)::int as n from public.activity_log`))[0]!;
    expect(n).toBe(0);
    const res = await attempt('sara@ofoq.test', (tx) => tx`delete from public.activity_log`);
    expect(res?.code).toBe('42501');
  });

  it('domain events can be written by members for themselves only, and never read', async () => {
    const [org] = await sql<{ id: string }[]>`select id from public.organizations limit 1`;
    const sara = await userId('sara@ofoq.test');
    const khalid = await userId('khalid@ofoq.test');
    expect(
      await attempt(
        'sara@ofoq.test',
        (tx) =>
          tx`insert into public.domain_events (organization_id, type, aggregate_type, actor_id) values (${org!.id}, 'test.happened', 'test', ${sara})`,
      ),
    ).toBeNull();
    const spoof = await attempt(
      'sara@ofoq.test',
      (tx) =>
        tx`insert into public.domain_events (organization_id, type, aggregate_type, actor_id) values (${org!.id}, 'test.happened', 'test', ${khalid})`,
    );
    expect(spoof?.code).toBe('42501');
    const { n } = (await as('sara@ofoq.test', (tx) => tx`select count(*)::int as n from public.domain_events`))[0]!;
    expect(n).toBe(0);
  });

  it('users only see and update their own notifications (read_at only)', async () => {
    const mohammed = await userId('mohammed@najd.test');
    const { others } = (
      await as('mohammed@najd.test', (tx) => tx`select count(*)::int as others from public.notifications where user_id <> ${mohammed}`)
    )[0]!;
    expect(others).toBe(0);
    const res = await attempt('mohammed@najd.test', (tx) => tx`update public.notifications set type = 'x' where user_id = ${mohammed}`);
    expect(res?.code).toBe('42501');
    expect(
      await attempt('mohammed@najd.test', (tx) => tx`update public.notifications set read_at = now() where user_id = ${mohammed}`),
    ).toBeNull();
  });

  it('invitation token hashes are never exposed in the audit trail', async () => {
    const { n } = (
      await sql<
        { n: number }[]
      >`select count(*)::int as n from public.activity_log where table_name = 'invitations' and (after ? 'token_hash' or before ? 'token_hash')`
    )[0]!;
    expect(n).toBe(0);
  });
});
