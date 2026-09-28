import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, id, updatedAt } from '@/lib/db/columns';
import { clients } from '@/modules/clients/db/schema';
import { departments } from '@/modules/departments/db/schema';
import { organizations, profiles } from '@/modules/organizations/db/schema';
import { roles } from '@/modules/rbac/db/schema';

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    fullName: text('full_name'),
    userType: text('user_type').notNull(),
    /** Agency invites: roles to assign on acceptance. */
    roleIds: uuid('role_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    /** Client invites: target client, client-side role and approval right. */
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    clientRoleId: uuid('client_role_id').references(() => roles.id, { onDelete: 'cascade' }),
    canApprove: boolean('can_approve').notNull().default(false),
    locale: text('locale').notNull().default('ar'),
    tokenHash: text('token_hash').notNull().unique(),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    sendCount: integer('send_count').notNull().default(1),
    lastSentAt: timestamp('last_sent_at', { withTimezone: true }).notNull().defaultNow(),
    invitedBy: uuid('invited_by').references(() => profiles.id, { onDelete: 'set null' }),
    acceptedBy: uuid('accepted_by').references(() => profiles.id, { onDelete: 'set null' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('invitations_pending_email_key')
      .on(t.organizationId, sql`lower(${t.email})`)
      .where(sql`${t.status} = 'pending'`),
    index('invitations_client_idx').on(t.clientId),
    check('invitations_user_type_check', sql`${t.userType} in ('agency','client')`),
    check('invitations_status_check', sql`${t.status} in ('pending','accepted','revoked')`),
    check(
      'invitations_client_shape_check',
      sql`(${t.userType} = 'client') = (${t.clientId} is not null and ${t.clientRoleId} is not null)`,
    ),
  ],
);
