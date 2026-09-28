'use server';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { AppContext } from '@/lib/auth/context';
import { clients, fileFolders, files, threads } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { can } from '@/lib/permissions/can';
import { CLIENT_FILES_BUCKET, classifyUpload, storagePaths } from '@/lib/storage';
import { supabaseAdmin } from '@/lib/supabase/admin';

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((n) => !/[\\/\0]/.test(n), { message: 'validation' });

const uploadSchema = z.object({
  clientId: z.uuid(),
  folderId: z.uuid().nullable(),
  threadId: z.uuid().nullable(),
  name: nameSchema,
  mimeType: z.string().min(3).max(120),
  size: z.number().int().positive(),
  visibility: z.enum(['internal', 'client']),
  /** A file attached to a request being filled in (linked by `submitRequestAction`). */
  forRequest: z.boolean().optional(),
});

function uploadRightsFor(ctx: AppContext, clientId: string, visibility: 'internal' | 'client') {
  if (ctx.side === 'agency') {
    if (!can(ctx.permissions, 'files:upload')) throw new ActionFailure('forbidden');
    return { side: 'agency' as const, visibility };
  }
  if (ctx.client.id !== clientId || !can(ctx.permissions, 'portal_files:upload')) throw new ActionFailure('forbidden');
  return { side: 'client' as const, visibility: 'client' as const };
}

function expectedPath(orgId: string, input: z.infer<typeof uploadSchema> & { fileId: string }) {
  if (input.forRequest) return storagePaths.requestAttachment(orgId, input.clientId, input.fileId, input.name);
  return input.threadId
    ? storagePaths.attachment(orgId, input.clientId, input.threadId, input.fileId, input.name)
    : storagePaths.clientFile(orgId, input.clientId, input.folderId, input.fileId, input.name);
}

/**
 * Step 1 of an upload: validates rights, type and size, then issues a one-time signed upload URL for a
 * server-chosen path. The browser uploads directly to Storage (with progress), then calls finalize.
 */
export const requestFileUploadAction = defineAction({
  input: uploadSchema,
  side: 'any',
  rateLimit: { key: 'upload', max: 200, windowSeconds: 3600 },
  async handler({ input, tx, ctx }) {
    uploadRightsFor(ctx, input.clientId, input.visibility);
    const rule = classifyUpload(input.mimeType, input.size);
    if (!rule.ok) throw new ActionFailure(rule.code);
    // RLS: the folder / thread must be visible to the caller and belong to this client.
    if (input.folderId) {
      const [folder] = await tx
        .select({ id: fileFolders.id })
        .from(fileFolders)
        .where(and(eq(fileFolders.id, input.folderId), eq(fileFolders.clientId, input.clientId)));
      if (!folder) throw new ActionFailure('not_found');
    }
    if (input.threadId) {
      const [thread] = await tx
        .select({ id: threads.id })
        .from(threads)
        .where(and(eq(threads.id, input.threadId), eq(threads.clientId, input.clientId)));
      if (!thread) throw new ActionFailure('not_found');
    }
    const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, input.clientId));
    if (!client) throw new ActionFailure('not_found');
    const fileId = crypto.randomUUID();
    const path = expectedPath(ctx.organization.id, { ...input, fileId });
    const { data, error } = await supabaseAdmin().storage.from(CLIENT_FILES_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new ActionFailure('upload_failed');
    return { fileId, path, token: data.token, signedUrl: data.signedUrl };
  },
});

/** Step 2: confirms the object exists at the expected path and records it (RLS decides who may insert). */
export const finalizeFileUploadAction = defineAction({
  input: uploadSchema.extend({ fileId: z.uuid() }),
  side: 'any',
  async handler({ input, tx, ctx }) {
    const rights = uploadRightsFor(ctx, input.clientId, input.visibility);
    const rule = classifyUpload(input.mimeType, input.size);
    if (!rule.ok) throw new ActionFailure(rule.code);
    const path = expectedPath(ctx.organization.id, input);
    const dir = path.slice(0, path.lastIndexOf('/'));
    const fileName = path.slice(path.lastIndexOf('/') + 1);
    const { data: listed } = await supabaseAdmin().storage.from(CLIENT_FILES_BUCKET).list(dir, { search: fileName, limit: 1 });
    const object = listed?.find((o) => o.name === fileName);
    if (!object) throw new ActionFailure('upload_failed');
    const actualSize = Number((object.metadata as { size?: number } | null)?.size ?? input.size);
    if (actualSize > input.size * 1.01 + 1024) throw new ActionFailure('file_too_large');

    await tx.insert(files).values({
      id: input.fileId,
      organizationId: ctx.organization.id,
      clientId: input.clientId,
      folderId: input.threadId || input.forRequest ? null : input.folderId,
      name: input.name,
      storagePath: path,
      mimeType: input.mimeType,
      sizeBytes: actualSize,
      kind: rule.kind,
      visibility: rights.visibility,
      source: input.threadId || input.forRequest ? 'attachment' : 'library',
      uploadedBy: ctx.session.userId,
      uploaderSide: rights.side,
    });
    const eventId = await emitEvent(tx, {
      type: 'file.uploaded',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'file', id: input.fileId },
      clientId: input.clientId,
      payload: { fileId: input.fileId, clientId: input.clientId, visibility: rights.visibility, name: input.name },
    });
    return {
      fileId: input.fileId,
      eventId,
      side: rights.side,
      visibility: rights.visibility,
      isAttachment: Boolean(input.threadId || input.forRequest),
    };
  },
  revalidate: (input) => [`/clients/${input.clientId}`, '/portal/files', '/portal'],
});

/** Short-lived signed URL for preview or download — only issued for files the caller can SELECT via RLS. */
export const getFileUrlAction = defineAction({
  input: z.object({ fileId: z.uuid(), download: z.boolean() }),
  side: 'any',
  async handler({ input, tx }) {
    const [file] = await tx
      .select({ path: files.storagePath, name: files.name })
      .from(files)
      .where(and(eq(files.id, input.fileId), isNull(files.deletedAt)));
    if (!file) throw new ActionFailure('not_found');
    const { data, error } = await supabaseAdmin()
      .storage.from(CLIENT_FILES_BUCKET)
      .createSignedUrl(file.path, 60 * 10, input.download ? { download: file.name } : undefined);
    if (error || !data) throw new ActionFailure('not_found');
    return { url: data.signedUrl };
  },
});

export const updateFileAction = defineAction({
  input: z.object({
    fileId: z.uuid(),
    name: nameSchema.optional(),
    folderId: z.uuid().nullable().optional(),
    visibility: z.enum(['internal', 'client']).optional(),
  }),
  side: 'agency',
  permission: 'files:manage',
  async handler({ input, tx, ctx }) {
    const { fileId, ...patch } = input;
    const [row] = await tx.update(files).set(patch).where(eq(files.id, fileId)).returning({ id: files.id, clientId: files.clientId });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'file.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'file', id: fileId },
      clientId: row.clientId,
      payload: { fileId, fields: Object.keys(patch) },
    });
    return { clientId: row.clientId };
  },
  revalidate: (_i, r) => [`/clients/${r.clientId}`, '/portal/files'],
});

export const deleteFileAction = defineAction({
  input: z.object({ fileId: z.uuid() }),
  side: 'agency',
  permission: 'files:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .update(files)
      .set({ deletedAt: new Date() })
      .where(and(eq(files.id, input.fileId), isNull(files.deletedAt)))
      .returning({ clientId: files.clientId, path: files.storagePath });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'file.deleted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'file', id: input.fileId },
      clientId: row.clientId,
      payload: { fileId: input.fileId },
    });
    return row;
  },
  async after({ result }) {
    await supabaseAdmin().storage.from(CLIENT_FILES_BUCKET).remove([result.path]);
  },
  revalidate: (_i, r) => [`/clients/${r.clientId}`, '/portal/files'],
});

export const createFolderAction = defineAction({
  input: z.object({
    clientId: z.uuid(),
    name: z.string().trim().min(1, { message: 'required' }).max(120),
    kind: z.enum(['month', 'project', 'type', 'brand', 'custom']),
    visibility: z.enum(['internal', 'client']),
  }),
  side: 'agency',
  permission: 'files:upload',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .insert(fileFolders)
      .values({
        organizationId: ctx.organization.id,
        clientId: input.clientId,
        name: input.name,
        kind: input.kind,
        visibility: input.visibility,
        createdBy: ctx.session.userId,
      })
      .returning({ id: fileFolders.id });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'folder.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'folder', id: row.id },
      clientId: input.clientId,
      payload: { folderId: row.id, clientId: input.clientId },
    });
    return { folderId: row.id };
  },
  revalidate: (input) => [`/clients/${input.clientId}`, '/portal/files'],
});

export const updateFolderAction = defineAction({
  input: z.object({ folderId: z.uuid(), name: z.string().trim().min(1).max(120), visibility: z.enum(['internal', 'client']) }),
  side: 'agency',
  permission: 'files:manage',
  async handler({ input, tx }) {
    const [row] = await tx
      .update(fileFolders)
      .set({ name: input.name, visibility: input.visibility })
      .where(eq(fileFolders.id, input.folderId))
      .returning({ clientId: fileFolders.clientId });
    if (!row) throw new ActionFailure('not_found');
    return row;
  },
  revalidate: (_i, r) => [`/clients/${r.clientId}`, '/portal/files'],
});

export const deleteFolderAction = defineAction({
  input: z.object({ folderId: z.uuid() }),
  side: 'agency',
  permission: 'files:manage',
  async handler({ input, tx }) {
    const [{ n }] = (await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from public.files where folder_id = ${input.folderId} and deleted_at is null`,
    )) as unknown as [{ n: number }];
    if (n > 0) throw new ActionFailure('conflict');
    const [row] = await tx.delete(fileFolders).where(eq(fileFolders.id, input.folderId)).returning({ clientId: fileFolders.clientId });
    if (!row) throw new ActionFailure('not_found');
    return row;
  },
  revalidate: (_i, r) => [`/clients/${r.clientId}`, '/portal/files'],
});
