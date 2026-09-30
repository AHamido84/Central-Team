import { sql } from 'drizzle-orm';
import { check, date, index, numeric, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, id, updatedAt } from '@/lib/db/columns';
import { departments } from '@/modules/departments/db/schema';
import { organizations, profiles } from '@/modules/organizations/db/schema';

/** Contracted hours per week (defaults to 40 when a member has no row). */
export const memberCapacity = pgTable(
  'member_capacity',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    hoursPerWeek: numeric('hours_per_week', { mode: 'number' }).notNull().default(40),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    check('member_capacity_hours_check', sql`${t.hoursPerWeek} between 0 and 80`),
  ],
);

export const timeOff = pgTable(
  'time_off',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    kind: text('kind').notNull().default('annual'),
    note: text('note').notNull().default(''),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('time_off_user_idx').on(t.userId, t.startDate),
    check('time_off_kind_check', sql`${t.kind} in ('annual','sick','other')`),
    check('time_off_range_check', sql`${t.endDate} >= ${t.startDate}`),
  ],
);

/** Hours each department spends per unit of a package item (e.g. one reel = 3h video + 1h content). */
export const serviceEfforts = pgTable(
  'service_efforts',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    itemType: text('item_type').notNull(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    hours: numeric('hours', { mode: 'number' }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('service_efforts_org_item_dept_idx').on(t.organizationId, t.itemType, t.departmentId),
    check('service_efforts_hours_check', sql`${t.hours} >= 0 and ${t.hours} <= 200`),
  ],
);
