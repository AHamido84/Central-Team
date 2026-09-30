import { boolean, jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { LocalizedText } from '@/lib/i18n/localized';

export const id = () => uuid('id').primaryKey().defaultRandom();

export const organizationId = () => uuid('organization_id').notNull();

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const localized = (name: string) => jsonb(name).$type<LocalizedText>();

/**
 * Soft delete (Feedback Round 1, ADR-080): the row is hidden by a restrictive RLS policy until restored or purged.
 * `delete_batch` groups a root and the children deleted with it, so restore and purge act on the whole group.
 */
export const softDelete = () => ({
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  deletedBy: uuid('deleted_by'),
  deleteBatch: uuid('delete_batch'),
});

/** Seeded demo data (`Settings → Data management` can remove it all at once). */
export const isDemo = () => boolean('is_demo').notNull().default(false);
