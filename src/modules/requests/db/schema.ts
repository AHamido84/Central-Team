import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { createdAt, id, localized, updatedAt } from '@/lib/db/columns';
import { clients } from '@/modules/clients/db/schema';
import { files } from '@/modules/files/db/schema';
import { organizations, profiles } from '@/modules/organizations/db/schema';
import type { RequestFormField } from '@/modules/requests/form-schema';

/** Agency-defined request types. The questions live in versions so old requests keep rendering correctly. */
export const requestForms = pgTable(
  'request_forms',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: localized('name').notNull(),
    description: localized('description').notNull().default({}),
    icon: text('icon').notNull().default('clipboard-list'),
    category: text('category').notNull().default('other'),
    status: text('status').notNull().default('draft'),
    currentVersionId: uuid('current_version_id').references((): AnyPgColumn => requestFormVersions.id, { onDelete: 'set null' }),
    defaultPriority: text('default_priority').notNull().default('normal'),
    responseSlaHours: integer('response_sla_hours'),
    resolutionSlaHours: integer('resolution_sla_hours'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('request_forms_org_key_idx').on(t.organizationId, t.key),
    check('request_forms_status_check', sql`${t.status} in ('draft','published','archived')`),
    check('request_forms_category_check', sql`${t.category} in ('design','video','content','ads','social','other')`),
    check('request_forms_priority_check', sql`${t.defaultPriority} in ('low','normal','high','urgent')`),
    check(
      'request_forms_sla_check',
      sql`(${t.responseSlaHours} is null or ${t.responseSlaHours} between 1 and 720) and (${t.resolutionSlaHours} is null or ${t.resolutionSlaHours} between 1 and 2160)`,
    ),
  ],
);

export const requestFormVersions = pgTable(
  'request_form_versions',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    formId: uuid('form_id')
      .notNull()
      .references(() => requestForms.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    fields: jsonb('fields').$type<RequestFormField[]>().notNull().default([]),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('request_form_versions_form_version_idx').on(t.formId, t.version),
    // At most one editable draft per form.
    uniqueIndex('request_form_versions_one_draft_idx')
      .on(t.formId)
      .where(sql`${t.publishedAt} is null`),
  ],
);

export const requests = pgTable(
  'requests',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** Per-organization sequence, assigned by trigger (shown as REQ-0042). */
    number: integer('number').notNull().default(0),
    formId: uuid('form_id')
      .notNull()
      .references(() => requestForms.id, { onDelete: 'restrict' }),
    formVersionId: uuid('form_version_id')
      .notNull()
      .references(() => requestFormVersions.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').notNull().default('submitted'),
    priority: text('priority').notNull().default('normal'),
    assigneeId: uuid('assignee_id').references(() => profiles.id, { onDelete: 'set null' }),
    submittedBy: uuid('submitted_by').references(() => profiles.id, { onDelete: 'set null' }),
    submittedSide: text('submitted_side').notNull().default('client'),
    desiredDate: date('desired_date'),
    responseDueAt: timestamp('response_due_at', { withTimezone: true }),
    resolutionDueAt: timestamp('resolution_due_at', { withTimezone: true }),
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('requests_org_number_idx').on(t.organizationId, t.number),
    index('requests_client_status_idx').on(t.clientId, t.status, t.lastActivityAt),
    index('requests_org_status_idx').on(t.organizationId, t.status, t.lastActivityAt),
    index('requests_assignee_idx').on(t.assigneeId),
    index('requests_form_idx').on(t.formId),
    check(
      'requests_status_check',
      sql`${t.status} in ('submitted','in_review','in_progress','waiting_client','completed','declined','cancelled')`,
    ),
    check('requests_priority_check', sql`${t.priority} in ('low','normal','high','urgent')`),
    check('requests_submitted_side_check', sql`${t.submittedSide} in ('agency','client')`),
    check('requests_title_length_check', sql`char_length(${t.title}) between 1 and 140`),
  ],
);

/** Lifecycle history, written only by triggers on `requests`. */
export const requestEvents = pgTable(
  'request_events',
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
    actorId: uuid('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
    actorSide: text('actor_side').notNull(),
    type: text('type').notNull(),
    fromValue: text('from_value'),
    toValue: text('to_value'),
    visibility: text('visibility').notNull().default('client'),
    createdAt: createdAt(),
  },
  (t) => [
    index('request_events_request_idx').on(t.requestId, t.createdAt),
    check('request_events_actor_side_check', sql`${t.actorSide} in ('agency','client','system')`),
    check('request_events_type_check', sql`${t.type} in ('submitted','status_changed','assigned','priority_changed')`),
    check('request_events_visibility_check', sql`${t.visibility} in ('internal','client')`),
  ],
);

export const requestAttachments = pgTable(
  'request_attachments',
  {
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.fileId] }), uniqueIndex('request_attachments_file_idx').on(t.fileId)],
);
