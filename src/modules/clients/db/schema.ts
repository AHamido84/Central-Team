import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, id, isDemo, localized, softDelete, updatedAt } from '@/lib/db/columns';
import { organizations, profiles } from '@/modules/organizations/db/schema';
import { roles } from '@/modules/rbac/db/schema';

export type ClientSocialHandles = Partial<Record<'instagram' | 'x' | 'tiktok' | 'snapchat' | 'linkedin' | 'youtube', string>>;

export const clients = pgTable(
  'clients',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: localized('name').notNull(),
    slug: text('slug').notNull(),
    industry: text('industry'),
    city: text('city'),
    website: text('website'),
    social: jsonb('social').$type<ClientSocialHandles>().notNull().default({}),
    status: text('status').notNull().default('active'),
    logoPath: text('logo_path'),
    accountManagerId: uuid('account_manager_id').references(() => profiles.id, {
      onDelete: 'set null',
    }),
    startDate: date('start_date'),
    /** Prefix of request references (NAJD-0042). Defaults from the slug (trigger). */
    requestPrefix: text('request_prefix'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    ...softDelete(),
    isDemo: isDemo(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('clients_org_slug_key').on(t.organizationId, t.slug),
    index('clients_account_manager_idx').on(t.accountManagerId),
    check('clients_status_check', sql`${t.status} in ('onboarding','active','paused','archived')`),
  ],
);

/** Internal agency notes about a client. Separate table so RLS can keep it agency-only. */
export const clientNotes = pgTable('client_notes', {
  clientId: uuid('client_id')
    .primaryKey()
    .references(() => clients.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  body: text('body').notNull().default(''),
  updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

/** Portal users of a client, with their client-side role and approval right. */
export const clientUsers = pgTable(
  'client_users',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    canApprove: boolean('can_approve').notNull().default(false),
    jobTitle: text('job_title'),
    status: text('status').notNull().default('active'),
    invitedBy: uuid('invited_by').references(() => profiles.id, { onDelete: 'set null' }),
    ...softDelete(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('client_users_client_user_key').on(t.clientId, t.userId),
    index('client_users_user_idx').on(t.userId),
    check('client_users_status_check', sql`${t.status} in ('active','deactivated')`),
  ],
);

/** Agency staff working on a client besides the account manager (drives `clients:read_assigned`). */
export const clientAssignments = pgTable(
  'client_assignments',
  {
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.userId] }), index('client_assignments_user_idx').on(t.userId)],
);

export const packages = pgTable(
  'packages',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: localized('name').notNull(),
    description: localized('description').notNull().default({}),
    /** Monthly price in halalas (minor units). */
    priceMinor: integer('price_minor'),
    currency: text('currency').notNull().default('SAR'),
    isActive: boolean('is_active').notNull().default(true),
    ...softDelete(),
    isDemo: isDemo(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('packages_org_idx').on(t.organizationId)],
);

export const packageItems = pgTable(
  'package_items',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    packageId: uuid('package_id')
      .notNull()
      .references(() => packages.id, { onDelete: 'cascade' }),
    itemType: text('item_type').notNull(),
    quantity: integer('quantity').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    uniqueIndex('package_items_package_type_key').on(t.packageId, t.itemType),
    check('package_items_quantity_check', sql`${t.quantity} > 0`),
  ],
);

export const clientPackages = pgTable(
  'client_packages',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    packageId: uuid('package_id')
      .notNull()
      .references(() => packages.id, { onDelete: 'restrict' }),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('client_packages_client_period_idx').on(t.clientId, t.periodStart),
    check('client_packages_period_check', sql`${t.periodEnd} >= ${t.periodStart}`),
  ],
);

/**
 * Consumption ledger for a client package. Later phases (deliverables, revisions) append rows;
 * `getPackageUsage()` sums them per item type.
 */
export const packageUsageEntries = pgTable(
  'package_usage_entries',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    clientPackageId: uuid('client_package_id')
      .notNull()
      .references(() => clientPackages.id, { onDelete: 'cascade' }),
    itemType: text('item_type').notNull(),
    quantity: integer('quantity').notNull().default(1),
    sourceType: text('source_type'),
    sourceId: uuid('source_id'),
    note: text('note'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('package_usage_entries_package_idx').on(t.clientPackageId, t.itemType)],
);
