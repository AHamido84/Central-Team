import { boolean, index, integer, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, id, localized, updatedAt } from '@/lib/db/columns';
import { organizations, profiles } from '@/modules/organizations/db/schema';

export const departments = pgTable(
  'departments',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: localized('name').notNull(),
    color: text('color').notNull().default('primary'),
    icon: text('icon').notNull().default('users'),
    sortOrder: integer('sort_order').notNull().default(100),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('departments_org_key_key').on(t.organizationId, t.key)],
);

export const departmentMembers = pgTable(
  'department_members',
  {
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    isLead: boolean('is_lead').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.departmentId, t.userId] }), index('department_members_user_idx').on(t.userId)],
);
