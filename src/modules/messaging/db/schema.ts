import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { createdAt, id, updatedAt } from '@/lib/db/columns';
import { clients } from '@/modules/clients/db/schema';
import { files } from '@/modules/files/db/schema';
import { organizations, profiles } from '@/modules/organizations/db/schema';

/**
 * Polymorphic conversation container. Phase 1 uses `subject_type = 'client'` (general client
 * conversations); requests (Phase 2) and deliverables (Phase 3) attach threads via subject_type/subject_id.
 */
export const threads = pgTable(
  'threads',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type').notNull().default('client'),
    subjectId: uuid('subject_id'),
    title: text('title').notNull(),
    visibility: text('visibility').notNull().default('client'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    lastCommentAt: timestamp('last_comment_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('threads_client_idx').on(t.clientId, t.lastCommentAt),
    index('threads_subject_idx').on(t.subjectType, t.subjectId),
    check('threads_subject_type_check', sql`${t.subjectType} in ('client','request','deliverable')`),
    check('threads_visibility_check', sql`${t.visibility} in ('internal','client')`),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => profiles.id, { onDelete: 'set null' }),
    authorSide: text('author_side').notNull(),
    body: text('body').notNull(),
    visibility: text('visibility').notNull().default('client'),
    mentions: uuid('mentions').array().notNull().default(sql`'{}'::uuid[]`),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('comments_thread_idx').on(t.threadId, t.createdAt),
    check('comments_visibility_check', sql`${t.visibility} in ('internal','client')`),
    check('comments_author_side_check', sql`${t.authorSide} in ('agency','client')`),
    check('comments_body_length_check', sql`char_length(${t.body}) between 1 and 10000`),
  ],
);

export const commentAttachments = pgTable(
  'comment_attachments',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.fileId] })],
);

/** Read receipts: the last point each participant has read up to in a thread. */
export const threadReads = pgTable(
  'thread_reads',
  {
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.userId] })],
);
