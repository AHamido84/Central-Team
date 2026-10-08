import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { createdAt, id } from '@/lib/db/columns';
import { clients } from '@/modules/clients/db/schema';
import { organizations } from '@/modules/organizations/db/schema';

/**
 * One row per delete action (the Trash): the root the user deleted and the batch of rows deleted with it
 * (ADR-080). Restore and purge act on the batch; the row goes away with either.
 */
export const trashItems = pgTable(
  'trash_items',
  {
    batch: uuid('batch').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    title: text('title').notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    /** What went with it, e.g. { tasks: 48, files: 30 }. */
    counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
    /** Whatever restore needs to put back (e.g. a membership's previous status). */
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    deletedBy: uuid('deleted_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('trash_items_org_idx').on(t.organizationId, t.deletedAt),
    index('trash_items_entity_idx').on(t.entityType, t.entityId),
    check(
      'trash_items_type_check',
      sql`${t.entityType} in ('client','client_user','member','package','request_type','workflow_template','request','task','folder','file','deliverable','deliverable_version','comment','lead')`,
    ),
  ],
);

/** A data reset run (Settings → Data management) with its progress and result; kept as the record of what happened. */
export const dataResetJobs = pgTable(
  'data_reset_jobs',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    status: text('status').notNull().default('queued'),
    step: text('step'),
    progress: integer('progress').notNull().default(0),
    counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
    filesRemoved: integer('files_removed').notNull().default(0),
    error: text('error'),
    requestedBy: uuid('requested_by'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('data_reset_jobs_org_idx').on(t.organizationId, t.createdAt),
    check('data_reset_jobs_mode_check', sql`${t.mode} in ('demo','operational','factory')`),
    check('data_reset_jobs_status_check', sql`${t.status} in ('queued','running','succeeded','failed')`),
  ],
);
