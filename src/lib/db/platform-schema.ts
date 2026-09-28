import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id } from '@/lib/db/columns';
import { organizations, profiles } from '@/modules/organizations/db/schema';

/** Transactional outbox: written in the same transaction as the mutation it describes (ADR-012). */
export const domainEvents = pgTable(
  'domain_events',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id'),
    clientId: uuid('client_id'),
    actorId: uuid('actor_id'),
    payload: jsonb('payload').notNull().default({}),
    version: integer('version').notNull().default(1),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('domain_events_org_occurred_idx').on(t.organizationId, t.occurredAt),
    index('domain_events_type_idx').on(t.type, t.occurredAt),
  ],
);

export const domainEventDeliveries = pgTable(
  'domain_event_deliveries',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => domainEvents.id, { onDelete: 'cascade' }),
    consumer: text('consumer').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.consumer] })],
);

/** Row-level audit trail, written only by the `app.audit_trigger()` trigger. */
export const activityLog = pgTable(
  'activity_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    tableName: text('table_name').notNull(),
    recordId: text('record_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    changedFields: text('changed_fields').array(),
    createdAt: createdAt(),
  },
  (t) => [
    index('activity_log_org_created_idx').on(t.organizationId, t.createdAt),
    index('activity_log_record_idx').on(t.tableName, t.recordId),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    category: text('category').notNull(),
    params: jsonb('params').$type<Record<string, string | number>>().notNull().default({}),
    link: text('link'),
    actorId: uuid('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => domainEvents.id, { onDelete: 'set null' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt, t.createdAt)],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    inApp: boolean('in_app').notNull().default(true),
    email: boolean('email').notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.organizationId, t.category] })],
);

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull(),
});
