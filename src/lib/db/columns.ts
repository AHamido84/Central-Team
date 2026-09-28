import { jsonb, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { LocalizedText } from '@/lib/i18n/localized';

export const id = () => uuid('id').primaryKey().defaultRandom();

export const organizationId = () => uuid('organization_id').notNull();

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const localized = (name: string) => jsonb(name).$type<LocalizedText>();
