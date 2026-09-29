import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { createdAt, id, updatedAt } from '@/lib/db/columns';
import { campaigns } from '@/modules/campaigns/db/schema';
import { clients } from '@/modules/clients/db/schema';
import { files } from '@/modules/files/db/schema';
import { organizations, profiles } from '@/modules/organizations/db/schema';
import { requests } from '@/modules/requests/db/schema';
import { tasks } from '@/modules/tasks/db/schema';

/** Something the team produces for the client (a design, a video, copy…), reviewed version by version. */
export const deliverables = pgTable(
  'deliverables',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').references(() => requests.id, { onDelete: 'set null' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    /** Campaign this creative belongs to (inherited from the request on insert, same client — trigger). */
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('in_progress'),
    requiresInternalReview: boolean('requires_internal_review').notNull().default(true),
    requiresClientApproval: boolean('requires_client_approval').notNull().default(true),
    currentVersionId: uuid('current_version_id').references((): AnyPgColumn => deliverableVersions.id, { onDelete: 'set null' }),
    versionCount: integer('version_count').notNull().default(0),
    /** Client "changes requested" decisions (each one uses a revision round from the package). */
    revisionRounds: integer('revision_rounds').notNull().default(0),
    /** Publishing date shown on the client's content calendar. */
    scheduledFor: date('scheduled_for'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /** First time a version was sent to the client — from then on the client can see this deliverable. */
    clientVisibleAt: timestamp('client_visible_at', { withTimezone: true }),
    /** Last "still waiting for your approval" reminder. */
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('deliverables_client_idx').on(t.clientId, t.status),
    index('deliverables_request_idx').on(t.requestId),
    index('deliverables_task_idx').on(t.taskId),
    index('deliverables_campaign_idx').on(t.campaignId),
    check('deliverables_type_check', sql`${t.type} in ('design','video','copy','document','other')`),
    check(
      'deliverables_status_check',
      sql`${t.status} in ('in_progress','internal_review','internal_changes','client_review','client_changes','approved')`,
    ),
    check('deliverables_title_check', sql`char_length(${t.title}) between 1 and 200`),
  ],
);

export const deliverableVersions = pgTable(
  'deliverable_versions',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    deliverableId: uuid('deliverable_id')
      .notNull()
      .references(() => deliverables.id, { onDelete: 'cascade' }),
    number: integer('number').notNull().default(0),
    notes: text('notes').notNull().default(''),
    status: text('status').notNull().default('draft'),
    uploadedBy: uuid('uploaded_by').references(() => profiles.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    sentToClientAt: timestamp('sent_to_client_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('deliverable_versions_number_idx').on(t.deliverableId, t.number),
    check(
      'deliverable_versions_status_check',
      sql`${t.status} in ('draft','internal_review','internal_changes','client_review','client_changes','approved','superseded')`,
    ),
    check('deliverable_versions_notes_check', sql`char_length(${t.notes}) <= 5000`),
  ],
);

export const deliverableVersionFiles = pgTable(
  'deliverable_version_files',
  {
    versionId: uuid('version_id')
      .notNull()
      .references(() => deliverableVersions.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.versionId, t.fileId] }), uniqueIndex('deliverable_version_files_file_idx').on(t.fileId)],
);

/** Review decisions. Insert-only; a trigger moves the version, deliverable, task and request along. */
export const approvals = pgTable(
  'approvals',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    deliverableId: uuid('deliverable_id')
      .notNull()
      .references(() => deliverables.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => deliverableVersions.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    decision: text('decision').notNull(),
    reviewerId: uuid('reviewer_id').references(() => profiles.id, { onDelete: 'set null' }),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [
    index('approvals_version_idx').on(t.versionId, t.createdAt),
    uniqueIndex('approvals_version_stage_idx').on(t.versionId, t.stage),
    check('approvals_stage_check', sql`${t.stage} in ('internal','client')`),
    check('approvals_decision_check', sql`${t.decision} in ('approved','changes_requested')`),
    check('approvals_comment_check', sql`char_length(${t.comment}) <= 5000`),
  ],
);

/** A comment pinned to a point of an image, a moment of a video, or the version as a whole. Each is a small thread. */
export const annotations = pgTable(
  'annotations',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    deliverableId: uuid('deliverable_id')
      .notNull()
      .references(() => deliverables.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => deliverableVersions.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id').references(() => files.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    /** Position as a fraction of the image (0–1), so pins survive any display size. */
    x: numeric('x', { mode: 'number' }),
    y: numeric('y', { mode: 'number' }),
    timeSeconds: numeric('time_seconds', { mode: 'number' }),
    body: text('body').notNull(),
    visibility: text('visibility').notNull().default('client'),
    authorId: uuid('author_id').references(() => profiles.id, { onDelete: 'set null' }),
    authorSide: text('author_side').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('annotations_version_idx').on(t.versionId, t.createdAt),
    check('annotations_kind_check', sql`${t.kind} in ('point','timestamp','general')`),
    check('annotations_visibility_check', sql`${t.visibility} in ('internal','client')`),
    check('annotations_author_side_check', sql`${t.authorSide} in ('agency','client')`),
    check('annotations_body_check', sql`char_length(${t.body}) between 1 and 5000`),
    check(
      'annotations_position_check',
      sql`(${t.kind} <> 'point' or (${t.x} between 0 and 1 and ${t.y} between 0 and 1 and ${t.fileId} is not null))
        and (${t.kind} <> 'timestamp' or (${t.timeSeconds} >= 0 and ${t.fileId} is not null))`,
    ),
  ],
);

export const annotationReplies = pgTable(
  'annotation_replies',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    annotationId: uuid('annotation_id')
      .notNull()
      .references(() => annotations.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    authorId: uuid('author_id').references(() => profiles.id, { onDelete: 'set null' }),
    authorSide: text('author_side').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('annotation_replies_annotation_idx').on(t.annotationId, t.createdAt),
    check('annotation_replies_author_side_check', sql`${t.authorSide} in ('agency','client')`),
    check('annotation_replies_body_check', sql`char_length(${t.body}) between 1 and 5000`),
  ],
);
