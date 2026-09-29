import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, numeric, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

import { createdAt, id, updatedAt } from '@/lib/db/columns';
import { clients } from '@/modules/clients/db/schema';
import { organizations, profiles } from '@/modules/organizations/db/schema';

export const fileFolders = pgTable(
  'file_folders',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => fileFolders.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('custom'),
    visibility: text('visibility').notNull().default('client'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('file_folders_client_idx').on(t.clientId, t.parentId),
    check('file_folders_kind_check', sql`${t.kind} in ('month','project','type','brand','custom')`),
    check('file_folders_visibility_check', sql`${t.visibility} in ('internal','client')`),
  ],
);

export const files = pgTable(
  'files',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => fileFolders.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    storagePath: text('storage_path').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    kind: text('kind').notNull(),
    visibility: text('visibility').notNull().default('client'),
    /** `library` files appear in the files library; `attachment` files belong to a comment, request or task; `deliverable` files to a deliverable version. */
    source: text('source').notNull().default('library'),
    /** Preview image generated in the browser at upload (image thumbnail or video poster frame), same bucket. */
    thumbnailPath: text('thumbnail_path'),
    width: integer('width'),
    height: integer('height'),
    durationSeconds: numeric('duration_seconds', { mode: 'number' }),
    uploadedBy: uuid('uploaded_by').references(() => profiles.id, { onDelete: 'set null' }),
    uploaderSide: text('uploader_side').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('files_client_folder_idx').on(t.clientId, t.folderId, t.createdAt),
    check('files_kind_check', sql`${t.kind} in ('image','video','pdf','document','archive','other')`),
    check('files_visibility_check', sql`${t.visibility} in ('internal','client')`),
    check('files_source_check', sql`${t.source} in ('library','attachment','deliverable')`),
    check('files_uploader_side_check', sql`${t.uploaderSide} in ('agency','client')`),
  ],
);
