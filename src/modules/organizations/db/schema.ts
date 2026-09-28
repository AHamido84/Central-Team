import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';

import { createdAt, id, localized, updatedAt } from '@/lib/db/columns';

export type OrganizationBrand = { primaryColor?: string };

export const organizations = pgTable('organizations', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: localized('name').notNull(),
  defaultLocale: text('default_locale').notNull().default('ar'),
  defaultTimezone: text('default_timezone').notNull().default('Asia/Riyadh'),
  defaultCurrency: text('default_currency').notNull().default('SAR'),
  logoPath: text('logo_path'),
  brand: jsonb('brand').$type<OrganizationBrand>().notNull().default({}),
  supportEmail: text('support_email'),
  supportWhatsapp: text('support_whatsapp'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull().default(''),
    email: text('email').notNull(),
    phone: text('phone'),
    whatsapp: text('whatsapp'),
    avatarPath: text('avatar_path'),
    locale: text('locale').notNull().default('ar'),
    theme: text('theme').notNull().default('system'),
    timezone: text('timezone').notNull().default('Asia/Riyadh'),
    calendar: text('calendar').notNull().default('gregory'),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('profiles_locale_check', sql`${t.locale} in ('ar','en')`),
    check('profiles_theme_check', sql`${t.theme} in ('system','light','dark')`),
    check('profiles_calendar_check', sql`${t.calendar} in ('gregory','islamic-umalqura')`),
  ],
);

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    userType: text('user_type').notNull(),
    jobTitle: text('job_title'),
    status: text('status').notNull().default('active'),
    invitedBy: uuid('invited_by').references(() => profiles.id, { onDelete: 'set null' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('organization_members_org_user_key').on(t.organizationId, t.userId),
    index('organization_members_user_idx').on(t.userId),
    check('organization_members_user_type_check', sql`${t.userType} in ('agency','client')`),
    check('organization_members_status_check', sql`${t.status} in ('active','deactivated')`),
  ],
);

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  module: text('module').notNull(),
  defaultEnabled: boolean('default_enabled').notNull().default(false),
  description: localized('description').notNull().default({}),
});

export const organizationFeatures = pgTable(
  'organization_features',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    flagKey: text('flag_key')
      .notNull()
      .references(() => featureFlags.key, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull(),
    config: jsonb('config').notNull().default({}),
    updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.flagKey] })],
);
