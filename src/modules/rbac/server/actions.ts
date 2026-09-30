'use server';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import { organizationMembers, rolePermissions, roles, userPermissionOverrides, userRoles } from '@/lib/db/schema';
import { withRls } from '@/lib/db/rls';
import { emitEvent } from '@/lib/events/emit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { localizedText, optionalText } from '@/lib/validation';
import { emailChangeFailure } from '@/modules/identity/server/email-change';

/* -------------------------------------------------------------------------- */
/* Members                                                                    */
/* -------------------------------------------------------------------------- */

export const setMemberRolesAction = defineAction({
  input: z.object({ userId: z.uuid(), roleIds: z.array(z.uuid()) }),
  side: 'agency',
  permission: 'roles:assign',
  async handler({ input, tx, ctx }) {
    if (input.userId === ctx.session.userId && !ctx.isSuperAdmin) throw new ActionFailure('cannot_modify_self');
    const current = await tx
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, input.userId), eq(userRoles.organizationId, ctx.organization.id)));
    const currentIds = current.map((r) => r.roleId);
    const added = input.roleIds.filter((id) => !currentIds.includes(id));
    const removed = currentIds.filter((id) => !input.roleIds.includes(id));
    // Add first so removing the last Super Admin role is caught by the trigger with a clear error.
    for (const roleId of added) {
      await tx
        .insert(userRoles)
        .values({ organizationId: ctx.organization.id, userId: input.userId, roleId, assignedBy: ctx.session.userId });
    }
    if (removed.length) {
      await tx.delete(userRoles).where(and(eq(userRoles.userId, input.userId), inArray(userRoles.roleId, removed)));
    }
    await emitEvent(tx, {
      type: 'user.roles_changed',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'user', id: input.userId },
      payload: { userId: input.userId, added, removed },
    });
    return { changed: added.length + removed.length > 0 };
  },
  revalidate: ['/admin/users', '/admin/roles'],
});

export const updateMemberAction = defineAction({
  input: z.object({ userId: z.uuid(), jobTitle: optionalText(80) }),
  side: 'agency',
  permission: 'users:update',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .update(organizationMembers)
      .set({ jobTitle: input.jobTitle })
      .where(and(eq(organizationMembers.userId, input.userId), eq(organizationMembers.organizationId, ctx.organization.id)))
      .returning({ id: organizationMembers.id });
    if (!row) throw new ActionFailure('not_found');
    return null;
  },
  revalidate: ['/admin/users'],
});

/**
 * An admin sets a team member's email directly (FR1.7 / ADR-087): no confirmation emails, the user is notified at both
 * addresses by the `user.email_changed` consumer. The database decides (`users:update`, and only a Super Admin changes
 * a Super Admin); GoTrue's admin API runs after commit.
 */
export const changeMemberEmailAction = defineAction({
  input: z.object({ userId: z.uuid(), email: z.email({ message: 'invalid_email' }).trim().toLowerCase().max(254) }),
  side: 'agency',
  permission: 'users:update',
  rateLimit: { key: 'admin_email_change', max: 20, windowSeconds: 600 },
  async handler({ input, tx, ctx }) {
    const [row] = await tx.execute<{ email: string; allowed: boolean; protected: boolean; in_use: boolean }>(sql`
      select p.email,
        app.has_permission(m.organization_id, 'users:update') as allowed,
        exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
          where ur.user_id = m.user_id and ur.organization_id = m.organization_id and r.is_locked) as protected,
        exists (select 1 from public.profiles o where lower(o.email) = ${input.email} and o.id <> m.user_id) as in_use
      from public.organization_members m join public.profiles p on p.id = m.user_id
      where m.organization_id = ${ctx.organization.id}::uuid and m.user_id = ${input.userId}::uuid and m.user_type = 'agency'`);
    if (!row) throw new ActionFailure('not_found');
    if (!row.allowed || (row.protected && !ctx.isSuperAdmin)) throw new ActionFailure('forbidden');
    if (row.email.toLowerCase() === input.email) throw new ActionFailure('email_same');
    if (row.in_use) throw new ActionFailure('email_in_use');
    return { from: row.email };
  },
  async complete({ input, prepared, ctx }) {
    // Service role (CLAUDE.md §6): only GoTrue's admin API changes another user's login email; the target and the
    // caller's permission were checked under RLS above.
    const { error } = await supabaseAdmin().auth.admin.updateUserById(input.userId, { email: input.email, email_confirm: true });
    if (error) throw emailChangeFailure(error);
    await withRls((tx) =>
      emitEvent(tx, {
        type: 'user.email_set_by_admin',
        organizationId: ctx.organization.id,
        actorId: ctx.session.userId,
        aggregate: { type: 'user', id: input.userId },
        payload: { userId: input.userId, from: prepared.from, to: input.email },
      }),
    );
    return { email: input.email };
  },
  revalidate: ['/admin/users'],
});

export const setMemberStatusAction = defineAction({
  input: z.object({ userId: z.uuid(), status: z.enum(['active', 'deactivated']) }),
  side: 'agency',
  permission: 'users:deactivate',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .update(organizationMembers)
      .set({ status: input.status })
      .where(and(eq(organizationMembers.userId, input.userId), eq(organizationMembers.organizationId, ctx.organization.id)))
      .returning({ id: organizationMembers.id });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: input.status === 'active' ? 'user.reactivated' : 'user.deactivated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'user', id: input.userId },
      payload: { userId: input.userId },
    });
    return null;
  },
  revalidate: ['/admin/users'],
});

export const setPermissionOverrideAction = defineAction({
  input: z.object({
    userId: z.uuid(),
    permissionKey: z.string().min(3).max(64),
    effect: z.enum(['grant', 'deny', 'none']),
    reason: optionalText(200),
  }),
  side: 'agency',
  permission: 'permissions:override',
  async handler({ input, tx, ctx }) {
    if (input.userId === ctx.session.userId) throw new ActionFailure('cannot_modify_self');
    await tx
      .delete(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.organizationId, ctx.organization.id),
          eq(userPermissionOverrides.userId, input.userId),
          eq(userPermissionOverrides.permissionKey, input.permissionKey),
        ),
      );
    if (input.effect !== 'none') {
      await tx.insert(userPermissionOverrides).values({
        organizationId: ctx.organization.id,
        userId: input.userId,
        permissionKey: input.permissionKey,
        effect: input.effect,
        reason: input.reason,
        createdBy: ctx.session.userId,
      });
    }
    await emitEvent(tx, {
      type: 'user.permission_override_set',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'user', id: input.userId },
      payload: { userId: input.userId, permissionKey: input.permissionKey, effect: input.effect },
    });
    return null;
  },
  revalidate: ['/admin/users'],
});

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

const roleFields = z.object({
  name: localizedText(60),
  description: z.object({ ar: z.string().trim().max(200), en: z.string().trim().max(200) }),
});

export const createRoleAction = defineAction({
  input: roleFields.extend({ copyFromRoleId: z.uuid().nullable() }),
  side: 'agency',
  permission: 'roles:create',
  async handler({ input, tx, ctx }) {
    const key = `custom_${crypto.randomUUID().slice(0, 8)}`;
    const [role] = await tx
      .insert(roles)
      .values({ organizationId: ctx.organization.id, key, name: input.name, description: input.description, side: 'agency' })
      .returning({ id: roles.id });
    if (!role) throw new ActionFailure('forbidden');
    if (input.copyFromRoleId) {
      const source = await tx
        .select({ key: rolePermissions.permissionKey })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, input.copyFromRoleId));
      const keys = source.map((s) => s.key);
      if (keys.length) {
        await tx
          .insert(rolePermissions)
          .values(keys.map((permissionKey) => ({ roleId: role.id, permissionKey, organizationId: ctx.organization.id })));
      }
    }
    await emitEvent(tx, {
      type: 'role.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'role', id: role.id },
      payload: { roleId: role.id },
    });
    return { roleId: role.id };
  },
  revalidate: ['/admin/roles'],
});

export const updateRoleAction = defineAction({
  input: roleFields.extend({ roleId: z.uuid() }),
  side: 'agency',
  permission: 'roles:update',
  async handler({ input, tx, ctx }) {
    const [role] = await tx
      .update(roles)
      .set({ name: input.name, description: input.description })
      .where(and(eq(roles.id, input.roleId), eq(roles.organizationId, ctx.organization.id)))
      .returning({ id: roles.id });
    if (!role) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'role.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'role', id: role.id },
      payload: { roleId: role.id, fields: ['name', 'description'] },
    });
    return null;
  },
  revalidate: ['/admin/roles'],
});

export const deleteRoleAction = defineAction({
  input: z.object({ roleId: z.uuid() }),
  side: 'agency',
  permission: 'roles:delete',
  async handler({ input, tx, ctx }) {
    const assigned = await tx.select({ id: userRoles.id }).from(userRoles).where(eq(userRoles.roleId, input.roleId)).limit(1);
    if (assigned.length) throw new ActionFailure('role_in_use');
    const [role] = await tx
      .delete(roles)
      .where(and(eq(roles.id, input.roleId), eq(roles.organizationId, ctx.organization.id)))
      .returning({ id: roles.id });
    if (!role) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'role.deleted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'role', id: role.id },
      payload: { roleId: role.id },
    });
    return null;
  },
  revalidate: ['/admin/roles'],
});

/** Saves a set of matrix changes atomically; triggers enforce locked roles and anti-escalation. */
export const saveRolePermissionsAction = defineAction({
  input: z.object({
    changes: z.array(z.object({ roleId: z.uuid(), add: z.array(z.string().max(64)), remove: z.array(z.string().max(64)) })).max(50),
  }),
  side: 'agency',
  permission: 'roles:update',
  async handler({ input, tx, ctx }) {
    for (const change of input.changes) {
      if (change.remove.length) {
        await tx
          .delete(rolePermissions)
          .where(and(eq(rolePermissions.roleId, change.roleId), inArray(rolePermissions.permissionKey, change.remove)));
      }
      if (change.add.length) {
        await tx
          .insert(rolePermissions)
          .values(change.add.map((permissionKey) => ({ roleId: change.roleId, permissionKey, organizationId: ctx.organization.id })))
          .onConflictDoNothing();
      }
      await emitEvent(tx, {
        type: 'role.permissions_updated',
        organizationId: ctx.organization.id,
        actorId: ctx.session.userId,
        aggregate: { type: 'role', id: change.roleId },
        payload: { roleId: change.roleId, added: change.add, removed: change.remove },
      });
    }
    return { saved: input.changes.length };
  },
  revalidate: ['/admin/roles'],
});
