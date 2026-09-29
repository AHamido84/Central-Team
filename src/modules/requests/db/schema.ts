import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, id, localized, updatedAt } from '@/lib/db/columns';
import { campaigns } from '@/modules/campaigns/db/schema';
import { clients } from '@/modules/clients/db/schema';
import { files } from '@/modules/files/db/schema';
import { organizations, profiles } from '@/modules/organizations/db/schema';
import type { Brief, FormSchema, RequestFormField } from '@/modules/requests/form-schema';

/** What clients can ask for. The brief form lives on the type; each request keeps a snapshot of it. */
export const requestTypes = pgTable(
  'request_types',
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
    defaultPriority: text('default_priority').notNull().default('normal'),
    slaDays: integer('sla_days'),
    packageItemType: text('package_item_type'),
    isActive: boolean('is_active').notNull().default(false),
    formSchema: jsonb('form_schema').$type<FormSchema>().notNull().default({ fields: [] }),
    schemaVersion: integer('schema_version').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('request_types_org_key_idx').on(t.organizationId, t.key),
    check('request_types_category_check', sql`${t.category} in ('design','video','content','ads','web','branding','other')`),
    check('request_types_priority_check', sql`${t.defaultPriority} in ('low','normal','high','urgent')`),
    check('request_types_sla_check', sql`${t.slaDays} is null or ${t.slaDays} between 1 and 90`),
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
    requestTypeId: uuid('request_type_id')
      .notNull()
      .references(() => requestTypes.id, { onDelete: 'restrict' }),
    /** Per-client sequence, assigned by trigger on submit (drafts have none). */
    number: integer('number'),
    /** `<client prefix>-<number>`, e.g. NAJD-0042. */
    reference: text('reference'),
    title: text('title').notNull().default(''),
    brief: jsonb('brief').$type<Brief>().notNull().default({}),
    /** The form the brief was written against (type forms keep evolving). */
    formSnapshot: jsonb('form_snapshot').$type<RequestFormField[]>().notNull().default([]),
    schemaVersion: integer('schema_version').notNull().default(1),
    referenceLinks: jsonb('reference_links').$type<string[]>().notNull().default([]),
    status: text('status').notNull().default('draft'),
    priority: text('priority').notNull().default('normal'),
    assigneeId: uuid('assignee_id').references(() => profiles.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    submittedBy: uuid('submitted_by').references(() => profiles.id, { onDelete: 'set null' }),
    desiredDate: date('desired_date'),
    dueDate: date('due_date'),
    isExtra: boolean('is_extra').notNull().default(false),
    isBillable: boolean('is_billable').notNull().default(false),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** Set once when "Convert to tasks" generated the request's workflow (Phase 3). */
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    /** Optional link to the campaign this work feeds (same client — trigger). */
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('requests_client_number_idx').on(t.clientId, t.number),
    index('requests_client_status_idx').on(t.clientId, t.status, t.lastActivityAt),
    index('requests_org_status_idx').on(t.organizationId, t.status, t.lastActivityAt),
    index('requests_assignee_idx').on(t.assigneeId),
    index('requests_campaign_idx').on(t.campaignId),
    index('requests_type_idx').on(t.requestTypeId),
    index('requests_created_by_idx').on(t.createdBy),
    check(
      'requests_status_check',
      sql`${t.status} in ('draft','submitted','under_review','needs_info','accepted','in_progress','in_review','delivered','closed','rejected','cancelled')`,
    ),
    check('requests_priority_check', sql`${t.priority} in ('low','normal','high','urgent')`),
    check('requests_title_length_check', sql`char_length(${t.title}) <= 140 and (${t.status} = 'draft' or char_length(${t.title}) >= 3)`),
  ],
);

/** Every status transition, with the reason when one is required. Written only by triggers on `requests`. */
export const requestStatusHistory = pgTable(
  'request_status_history',
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
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),
    actorId: uuid('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
    actorSide: text('actor_side').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('request_status_history_request_idx').on(t.requestId, t.createdAt),
    check('request_status_history_actor_side_check', sql`${t.actorSide} in ('agency','client','system')`),
    check('request_status_history_reason_length_check', sql`${t.reason} is null or char_length(${t.reason}) <= 2000`),
  ],
);

/** Non-status changes (assignment, priority, due date, flags, brief edits). Written only by triggers. */
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
    visibility: text('visibility').notNull().default('internal'),
    createdAt: createdAt(),
  },
  (t) => [
    index('request_events_request_idx').on(t.requestId, t.createdAt),
    check('request_events_actor_side_check', sql`${t.actorSide} in ('agency','client','system')`),
    check(
      'request_events_type_check',
      sql`${t.type} in ('assigned','priority_changed','due_date_changed','flags_changed','brief_updated')`,
    ),
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
    /** The brief's file field this belongs to; null = general attachment (wizard step 3). */
    fieldId: text('field_id'),
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
