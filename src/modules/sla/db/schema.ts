import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, id, localized, updatedAt } from '@/lib/db/columns';
import { clients } from '@/modules/clients/db/schema';
import { organizations, profiles } from '@/modules/organizations/db/schema';
import { requestTypes, requests } from '@/modules/requests/db/schema';

/**
 * Service targets for requests. Every non-null criterion must match; the most specific policy wins
 * (client > request type > priority). A policy with no criteria is the organization default.
 */
export const slaPolicies = pgTable(
  'sla_policies',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: localized('name').notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    requestTypeId: uuid('request_type_id').references(() => requestTypes.id, { onDelete: 'cascade' }),
    priority: text('priority'),
    /** First agency response, in business hours. */
    responseHours: integer('response_hours').notNull().default(8),
    /** Delivery, in working days; null = the request type's `sla_days`. */
    resolutionDays: integer('resolution_days'),
    pauseOnClient: boolean('pause_on_client').notNull().default(true),
    atRiskPercent: integer('at_risk_percent').notNull().default(75),
    escalateTo: uuid('escalate_to').references(() => profiles.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('sla_policies_org_idx').on(t.organizationId, t.isActive),
    check('sla_policies_priority_check', sql`${t.priority} is null or ${t.priority} in ('low','normal','high','urgent')`),
    check('sla_policies_response_check', sql`${t.responseHours} between 1 and 240`),
    check('sla_policies_resolution_check', sql`${t.resolutionDays} is null or ${t.resolutionDays} between 1 and 90`),
    check('sla_policies_at_risk_check', sql`${t.atRiskPercent} between 50 and 95`),
  ],
);

/** Non-working days on top of the Friday–Saturday weekend. */
export const holidays = pgTable(
  'holidays',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    name: localized('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('holidays_org_date_idx').on(t.organizationId, t.date)],
);

/** At-risk and breached SLA targets, recorded once each by the sweep; people can only acknowledge them. */
export const slaBreaches = pgTable(
  'sla_breaches',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    policyId: uuid('policy_id').references(() => slaPolicies.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    level: text('level').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    /** The target was met late, or the request ended (closed / cancelled / rejected). */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: uuid('acknowledged_by').references(() => profiles.id, { onDelete: 'set null' }),
    note: text('note'),
  },
  (t) => [
    uniqueIndex('sla_breaches_request_kind_level_idx').on(t.requestId, t.kind, t.level),
    index('sla_breaches_org_detected_idx').on(t.organizationId, t.detectedAt),
    index('sla_breaches_client_idx').on(t.clientId, t.detectedAt),
    check('sla_breaches_kind_check', sql`${t.kind} in ('response','resolution')`),
    check('sla_breaches_level_check', sql`${t.level} in ('at_risk','breached')`),
    check('sla_breaches_note_length_check', sql`${t.note} is null or char_length(${t.note}) <= 1000`),
  ],
);
