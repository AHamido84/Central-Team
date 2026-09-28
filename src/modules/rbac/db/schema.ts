import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, localized, updatedAt } from '@/lib/db/columns';
import { organizations, profiles } from '@/modules/organizations/db/schema';

export const permissions = pgTable(
  'permissions',
  {
    key: text('key').primaryKey(),
    resource: text('resource').notNull(),
    action: text('action').notNull(),
    side: text('side').notNull(),
    module: text('module').notNull(),
    label: localized('label').notNull(),
    description: localized('description').notNull().default({}),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [check('permissions_side_check', sql`${t.side} in ('agency','client')`)],
);

export const roles = pgTable(
  'roles',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: localized('name').notNull(),
    description: localized('description').notNull().default({}),
    side: text('side').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    isLocked: boolean('is_locked').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(100),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('roles_org_key_key').on(t.organizationId, t.key),
    check('roles_side_check', sql`${t.side} in ('agency','client')`),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionKey] }),
    index('role_permissions_org_idx').on(t.organizationId),
  ],
);

/** Agency-side role assignments. Client-side roles live on `client_users.role_id` (ADR-018). */
export const userRoles = pgTable(
  'user_roles',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    assignedBy: uuid('assigned_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('user_roles_user_role_key').on(t.userId, t.roleId),
    index('user_roles_org_user_idx').on(t.organizationId, t.userId),
    index('user_roles_role_idx').on(t.roleId),
  ],
);

export const userPermissionOverrides = pgTable(
  'user_permission_overrides',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
    effect: text('effect').notNull(),
    reason: text('reason'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('user_permission_overrides_key').on(t.organizationId, t.userId, t.permissionKey),
    check('user_permission_overrides_effect_check', sql`${t.effect} in ('grant','deny')`),
  ],
);
