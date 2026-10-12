import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, updatedAt } from '@/lib/db/columns';
import { organizations, profiles } from '@/modules/organizations/db/schema';
import type { ExecutiveViewConfig } from '@/modules/executive/types';

/**
 * Yearly or quarterly targets the Executive Center compares against (FR7, ADR-096). `quarter` is null for a yearly
 * target; a quarterly one wins over the year for its quarter.
 */
export const kpiTargets = pgTable(
  'kpi_targets',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(),
    year: integer('year').notNull(),
    quarter: smallint('quarter'),
    value: doublePrecision('value').notNull(),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('kpi_targets_unique_idx').on(t.organizationId, t.metric, t.year, sql`coalesce(${t.quarter}, 0)`),
    check('kpi_targets_quarter_check', sql`${t.quarter} is null or ${t.quarter} between 1 and 4`),
    check('kpi_targets_year_check', sql`${t.year} between 2000 and 2100`),
  ],
);

/**
 * One value per organization, day and metric for metrics that are otherwise only current-state (client health,
 * backlog, utilization, pipeline, open risks), written by the daily cron and "Refresh now" so trends exist.
 */
export const kpiSnapshots = pgTable(
  'kpi_snapshots',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    metric: text('metric').notNull(),
    value: doublePrecision('value'),
    /** Breakdowns kept with the value (e.g. the health distribution). */
    details: jsonb('details').$type<Record<string, number>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.day, t.metric] }),
    index('kpi_snapshots_metric_idx').on(t.organizationId, t.metric, t.day),
  ],
);

/** A saved filter + tab combination of the Executive Center, private to its owner. */
export const executiveViews = pgTable(
  'executive_views',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    config: jsonb('config').$type<ExecutiveViewConfig>().notNull(),
    pinned: boolean('pinned').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('executive_views_user_idx').on(t.userId),
    check('executive_views_name_check', sql`char_length(${t.name}) between 1 and 80`),
  ],
);

/** A note on a KPI or chart; it notifies the chosen owner and can open a task for them. */
export const executiveNotes = pgTable(
  'executive_notes',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => profiles.id, { onDelete: 'set null' }),
    kpi: text('kpi').notNull(),
    /** The period and filters the note was written against. */
    context: jsonb('context').$type<ExecutiveViewConfig>().notNull(),
    body: text('body').notNull(),
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'set null' }),
    taskId: uuid('task_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('executive_notes_kpi_idx').on(t.organizationId, t.kpi, t.createdAt),
    check('executive_notes_body_check', sql`char_length(${t.body}) between 1 and 2000`),
  ],
);

/** Weekly or monthly board report e-mailed with the PDF attached (through Settings → Mail). */
export const executiveSchedules = pgTable(
  'executive_schedules',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    cadence: text('cadence').notNull().default('monthly'),
    locale: text('locale').notNull().default('ar'),
    recipients: text('recipients').array().notNull(),
    nextRunOn: date('next_run_on').notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('executive_schedules_due_idx').on(t.isActive, t.nextRunOn),
    check('executive_schedules_cadence_check', sql`${t.cadence} in ('weekly','monthly')`),
    check('executive_schedules_locale_check', sql`${t.locale} in ('ar','en')`),
    check('executive_schedules_recipients_check', sql`cardinality(${t.recipients}) between 1 and 20`),
  ],
);
