import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, id, isDemo, updatedAt } from '@/lib/db/columns';
import { domainEvents } from '@/lib/db/platform-schema';
import type { AutomationAction, AutomationCondition, ActionResult, ConditionResult } from '@/modules/automations/types';
import { organizations, profiles } from '@/modules/organizations/db/schema';

/** A rule: when a domain event of `trigger_type` happens and the conditions hold, run the actions in order. */
export const automations = pgTable(
  'automations',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isActive: boolean('is_active').notNull().default(false),
    triggerType: text('trigger_type').notNull(),
    match: text('match').notNull().default('all'),
    conditions: jsonb('conditions').$type<AutomationCondition[]>().notNull().default([]),
    actions: jsonb('actions').$type<AutomationAction[]>().notNull().default([]),
    runCount: integer('run_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
    isDemo: isDemo(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('automations_trigger_idx')
      .on(t.organizationId, t.triggerType)
      .where(sql`${t.isActive}`),
    check('automations_match_check', sql`${t.match} in ('all','any')`),
    check('automations_name_check', sql`char_length(${t.name}) between 1 and 120`),
    check('automations_description_check', sql`char_length(${t.description}) <= 1000`),
    check('automations_actions_check', sql`jsonb_typeof(${t.actions}) = 'array' and jsonb_array_length(${t.actions}) between 1 and 10`),
    check('automations_conditions_check', sql`jsonb_typeof(${t.conditions}) = 'array' and jsonb_array_length(${t.conditions}) <= 20`),
  ],
);

/** One evaluation of a rule against an event (or a dry run), with the result of every condition and action. */
export const automationRuns = pgTable(
  'automation_runs',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => domainEvents.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    dryRun: boolean('dry_run').notNull().default(false),
    status: text('status').notNull().default('running'),
    skipReason: text('skip_reason'),
    depth: smallint('depth').notNull().default(0),
    attempts: integer('attempts').notNull().default(1),
    conditions: jsonb('conditions').$type<ConditionResult[]>().notNull().default([]),
    actions: jsonb('actions').$type<ActionResult[]>().notNull().default([]),
    error: text('error'),
    requestedBy: uuid('requested_by').references(() => profiles.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('automation_runs_event_idx')
      .on(t.automationId, t.eventId)
      .where(sql`not ${t.dryRun}`),
    index('automation_runs_automation_idx').on(t.automationId, t.startedAt),
    index('automation_runs_org_idx').on(t.organizationId, t.startedAt),
    check('automation_runs_status_check', sql`${t.status} in ('running','succeeded','failed','skipped')`),
    check(
      'automation_runs_skip_check',
      sql`${t.skipReason} is null or ${t.skipReason} in ('conditions','loop_depth','loop_self','rate_limited')`,
    ),
  ],
);
