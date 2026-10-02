'use server';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { AppContext } from '@/lib/auth/context';
import type { Tx } from '@/lib/db/client';
import {
  annotationReplies,
  annotations,
  approvals,
  deliverableVersionFiles,
  deliverableVersions,
  deliverables,
  files,
  requests,
  tasks,
} from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { can } from '@/lib/permissions/can';
import { CLIENT_FILES_BUCKET, storagePaths, uploadRules } from '@/lib/storage';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { deliverableMaxBytes } from '@/modules/deliverables/constants';
import {
  annotationSchema,
  createDeliverableSchema,
  decisionSchema,
  finalizeVersionFileSchema,
  replySchema,
  resolveSchema,
  updateDeliverableSchema,
  versionUploadSchema,
} from '@/modules/deliverables/schemas';
import { getDeliverable, type DeliverableDetail } from '@/modules/deliverables/server/queries';

const paths = (id: string) => [
  `/deliverables/${id}`,
  '/tasks',
  '/my-work',
  '/portal',
  '/portal/approvals',
  `/portal/approvals/${id}`,
  '/portal/calendar',
];

function classifyDeliverable(mime: string, size: number) {
  const rule = uploadRules.find((r) => r.mime.test(mime));
  if (!rule) return { ok: false as const, code: 'file_type_not_allowed' as const };
  if (size > deliverableMaxBytes[rule.kind]) return { ok: false as const, code: 'file_too_large' as const };
  return { ok: true as const, kind: rule.kind };
}

async function versionWithDeliverable(tx: Tx, versionId: string) {
  const [row] = await tx
    .select({ v: deliverableVersions, d: deliverables })
    .from(deliverableVersions)
    .innerJoin(deliverables, eq(deliverables.id, deliverableVersions.deliverableId))
    .where(eq(deliverableVersions.id, versionId));
  if (!row) throw new ActionFailure('not_found');
  return row;
}

export const loadDeliverableAction = defineAction({
  input: z.object({ deliverableId: z.uuid() }),
  side: 'any',
  async handler({ input }): Promise<DeliverableDetail> {
    const d = await getDeliverable(input.deliverableId);
    if (!d) throw new ActionFailure('not_found');
    return d;
  },
});

export const createDeliverableAction = defineAction({
  input: createDeliverableSchema,
  side: 'agency',
  permission: 'deliverables:manage',
  async handler({ input, tx, ctx }) {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, input.taskId));
    if (!task) throw new ActionFailure('not_found');
    const [row] = await tx
      .insert(deliverables)
      .values({
        organizationId: ctx.organization.id,
        clientId: task.clientId,
        requestId: task.requestId,
        taskId: task.id,
        type: input.type,
        title: input.title,
        requiresInternalReview: input.requiresInternalReview,
        requiresClientApproval: input.requiresClientApproval,
      })
      .returning({ id: deliverables.id });
    await emitEvent(tx, {
      type: 'deliverable.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'deliverable', id: row!.id },
      clientId: task.clientId,
      payload: { deliverableId: row!.id, clientId: task.clientId, taskId: task.id },
    });
    return { deliverableId: row!.id };
  },
  revalidate: ['/tasks'],
});

export const updateDeliverableAction = defineAction({
  input: updateDeliverableSchema,
  side: 'agency',
  permission: 'deliverables:manage',
  async handler({ input, tx, ctx }) {
    const { deliverableId, ...patch } = input;
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const [row] = await tx
      .update(deliverables)
      .set(clean)
      .where(eq(deliverables.id, deliverableId))
      .returning({ clientId: deliverables.clientId });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'deliverable.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'deliverable', id: deliverableId },
      clientId: row.clientId,
      payload: { deliverableId, clientId: row.clientId, fields: Object.keys(clean) },
    });
    return { deliverableId };
  },
  revalidate: (i) => paths(i.deliverableId),
});

/** Starts a new draft version (reuses the current draft if one is still open). */
export const createVersionAction = defineAction({
  input: z.object({ deliverableId: z.uuid(), notes: z.string().trim().max(5000, { message: 'too_long' }).optional() }),
  side: 'agency',
  permission: 'deliverables:manage',
  async handler({ input, tx, ctx }) {
    const [d] = await tx.select().from(deliverables).where(eq(deliverables.id, input.deliverableId));
    if (!d) throw new ActionFailure('not_found');
    if (d.currentVersionId) {
      const [current] = await tx.select().from(deliverableVersions).where(eq(deliverableVersions.id, d.currentVersionId));
      if (current?.status === 'draft') return { versionId: current.id, number: current.number };
    }
    const [row] = await tx
      .insert(deliverableVersions)
      .values({ deliverableId: d.id, organizationId: d.organizationId, clientId: d.clientId, notes: input.notes ?? '' })
      .returning({ id: deliverableVersions.id, number: deliverableVersions.number });
    await emitEvent(tx, {
      type: 'deliverable.version_created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'deliverable', id: d.id },
      clientId: d.clientId,
      payload: { deliverableId: d.id, clientId: d.clientId, versionId: row!.id, number: row!.number },
    });
    return { versionId: row!.id, number: row!.number };
  },
  revalidate: (i) => paths(i.deliverableId),
});

export const updateVersionNotesAction = defineAction({
  input: z.object({ versionId: z.uuid(), notes: z.string().trim().max(5000, { message: 'too_long' }) }),
  side: 'agency',
  permission: 'deliverables:manage',
  async handler({ input, tx }) {
    const [row] = await tx
      .update(deliverableVersions)
      .set({ notes: input.notes })
      .where(eq(deliverableVersions.id, input.versionId))
      .returning({ id: deliverableVersions.id });
    if (!row) throw new ActionFailure('not_found');
    return null;
  },
});

/**
 * Step 1 of a deliverable upload: a signed token for a server-chosen path. The browser uploads with TUS
 * (resumable, 6 MB chunks) straight to Storage, plus an optional preview image, then calls finalize.
 */
export const requestVersionUploadAction = defineAction({
  input: versionUploadSchema,
  side: 'agency',
  permission: 'deliverables:manage',
  rateLimit: { key: 'deliverable_upload', max: 300, windowSeconds: 3600 },
  async handler({ input, tx, ctx }) {
    const { v, d } = await versionWithDeliverable(tx, input.versionId);
    if (v.status !== 'draft') throw new ActionFailure('version_locked');
    const rule = classifyDeliverable(input.mimeType, input.size);
    if (!rule.ok) throw new ActionFailure(rule.code);
    const fileId = crypto.randomUUID();
    const path = storagePaths.deliverableFile(ctx.organization.id, d.clientId, d.id, fileId, input.name);
    const storage = supabaseAdmin().storage.from(CLIENT_FILES_BUCKET);
    const main = await storage.createSignedUploadUrl(path);
    if (main.error || !main.data) throw new ActionFailure('upload_failed');
    let thumb: { path: string; token: string } | null = null;
    if (input.withThumbnail) {
      const thumbPath = storagePaths.deliverableThumb(ctx.organization.id, d.clientId, d.id, fileId);
      const t = await storage.createSignedUploadUrl(thumbPath);
      if (!t.error && t.data) thumb = { path: thumbPath, token: t.data.token };
    }
    return { fileId, path, token: main.data.token, thumb };
  },
});

/** Step 2: confirms the object landed at the expected path, records the file and adds it to the draft version. */
export const finalizeVersionFileAction = defineAction({
  input: finalizeVersionFileSchema,
  side: 'agency',
  permission: 'deliverables:manage',
  async handler({ input, tx, ctx }) {
    const { v, d } = await versionWithDeliverable(tx, input.versionId);
    if (v.status !== 'draft') throw new ActionFailure('version_locked');
    const rule = classifyDeliverable(input.mimeType, input.size);
    if (!rule.ok) throw new ActionFailure(rule.code);
    const path = storagePaths.deliverableFile(ctx.organization.id, d.clientId, d.id, input.fileId, input.name);
    const dir = path.slice(0, path.lastIndexOf('/'));
    const storage = supabaseAdmin().storage.from(CLIENT_FILES_BUCKET);
    const { data: listed } = await storage.list(dir, { search: input.fileId, limit: 5 });
    const object = listed?.find((o) => `${dir}/${o.name}` === path);
    if (!object) throw new ActionFailure('upload_failed');
    const actualSize = Number((object.metadata as { size?: number } | null)?.size ?? input.size);
    if (actualSize > deliverableMaxBytes[rule.kind]) throw new ActionFailure('file_too_large');
    const thumbPath = storagePaths.deliverableThumb(ctx.organization.id, d.clientId, d.id, input.fileId);
    const hasThumb = input.withThumbnail && Boolean(listed?.find((o) => `${dir}/${o.name}` === thumbPath));

    await tx.insert(files).values({
      id: input.fileId,
      organizationId: ctx.organization.id,
      clientId: d.clientId,
      name: input.name,
      storagePath: path,
      mimeType: input.mimeType,
      sizeBytes: actualSize,
      kind: rule.kind,
      visibility: 'internal',
      source: 'deliverable',
      uploadedBy: ctx.session.userId,
      uploaderSide: 'agency',
      thumbnailPath: hasThumb ? thumbPath : null,
      width: input.width,
      height: input.height,
      durationSeconds: input.durationSeconds,
    });
    const [{ n }] = (await tx.execute<{ n: number }>(
      sql`select coalesce(max(sort_order), 0)::int + 1 as n from public.deliverable_version_files where version_id = ${v.id}`,
    )) as unknown as [{ n: number }];
    await tx
      .insert(deliverableVersionFiles)
      .values({ versionId: v.id, fileId: input.fileId, organizationId: d.organizationId, clientId: d.clientId, sortOrder: n });
    return { fileId: input.fileId };
  },
});

export const removeVersionFileAction = defineAction({
  input: z.object({ versionId: z.uuid(), fileId: z.uuid() }),
  side: 'agency',
  permission: 'deliverables:manage',
  async handler({ input, tx }) {
    const [row] = await tx
      .delete(deliverableVersionFiles)
      .where(and(eq(deliverableVersionFiles.versionId, input.versionId), eq(deliverableVersionFiles.fileId, input.fileId)))
      .returning({ fileId: deliverableVersionFiles.fileId });
    if (!row) throw new ActionFailure('version_locked');
    await tx
      .update(files)
      .set({ deletedAt: new Date() })
      .where(and(eq(files.id, input.fileId), isNull(files.deletedAt)));
    return null;
  },
});

/** Sends the draft version into review; the trigger picks the first stage the deliverable needs. */
export const submitVersionAction = defineAction({
  input: z.object({ versionId: z.uuid() }),
  side: 'agency',
  permission: 'deliverables:manage',
  async handler({ input, tx, ctx }) {
    const { d } = await versionWithDeliverable(tx, input.versionId);
    const requestBefore = await requestStatus(tx, d.requestId);
    const [row] = await tx
      .update(deliverableVersions)
      .set({ status: 'internal_review' })
      .where(eq(deliverableVersions.id, input.versionId))
      .returning({ status: deliverableVersions.status });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'deliverable.submitted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'deliverable', id: d.id },
      clientId: d.clientId,
      payload: { deliverableId: d.id, clientId: d.clientId, versionId: input.versionId, status: row.status },
    });
    await emitDelivered(tx, ctx, d, requestBefore);
    return { deliverableId: d.id, status: row.status };
  },
  revalidate: (_i, r) => paths(r.deliverableId),
});

async function requestStatus(tx: Tx, requestId: string | null) {
  if (!requestId) return null;
  const [r] = await tx.select({ status: requests.status }).from(requests).where(eq(requests.id, requestId));
  return r?.status ?? null;
}

/** The approval trigger may have delivered the request; tell the request's consumers like any other transition. */
async function emitDelivered(tx: Tx, ctx: AppContext, d: { requestId: string | null; clientId: string }, before: string | null) {
  if (!d.requestId || !before) return;
  const after = await requestStatus(tx, d.requestId);
  if (after && after !== before) {
    await emitEvent(tx, {
      type: 'request.status_changed',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request', id: d.requestId },
      clientId: d.clientId,
      payload: { requestId: d.requestId, clientId: d.clientId, from: before, to: after, reason: null },
    });
  }
}

/** Internal review (deliverables:review) or client approval (client users with approval rights). */
export const decideVersionAction = defineAction({
  input: decisionSchema,
  side: 'any',
  rateLimit: { key: 'approval', max: 120, windowSeconds: 3600 },
  async handler({ input, tx, ctx }) {
    if (input.stage === 'internal' && (ctx.side !== 'agency' || !can(ctx.permissions, 'deliverables:review')))
      throw new ActionFailure('forbidden');
    if (input.stage === 'client' && (ctx.side !== 'client' || !ctx.client.canApprove)) throw new ActionFailure('forbidden');
    const { d } = await versionWithDeliverable(tx, input.versionId);
    if (ctx.side === 'client' && d.clientId !== ctx.client.id) throw new ActionFailure('forbidden');
    const requestBefore = await requestStatus(tx, d.requestId);
    const [approval] = await tx
      .insert(approvals)
      .values({
        organizationId: d.organizationId,
        clientId: d.clientId,
        deliverableId: d.id,
        versionId: input.versionId,
        stage: input.stage,
        decision: input.decision,
        comment: input.comment,
        reviewerId: ctx.session.userId,
      })
      .returning({ id: approvals.id });
    const [v] = await tx
      .select({ status: deliverableVersions.status })
      .from(deliverableVersions)
      .where(eq(deliverableVersions.id, input.versionId));
    await emitEvent(tx, {
      type: 'deliverable.decided',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'deliverable', id: d.id },
      clientId: d.clientId,
      payload: {
        deliverableId: d.id,
        clientId: d.clientId,
        versionId: input.versionId,
        stage: input.stage,
        decision: input.decision,
        status: v?.status ?? '',
        approvalId: approval!.id,
      },
    });
    await emitDelivered(tx, ctx, d, requestBefore);
    return { deliverableId: d.id, status: v?.status ?? '' };
  },
  revalidate: (_i, r) => [...paths(r.deliverableId), '/requests', '/portal/requests'],
});

export const addAnnotationAction = defineAction({
  input: annotationSchema,
  side: 'any',
  rateLimit: { key: 'annotation', max: 300, windowSeconds: 3600 },
  async handler({ input, tx, ctx }) {
    const { d } = await versionWithDeliverable(tx, input.versionId);
    if (ctx.side === 'client' && d.clientId !== ctx.client.id) throw new ActionFailure('forbidden');
    const [row] = await tx
      .insert(annotations)
      .values({
        organizationId: d.organizationId,
        clientId: d.clientId,
        deliverableId: d.id,
        versionId: input.versionId,
        fileId: input.fileId,
        kind: input.kind,
        x: input.kind === 'point' ? input.x : null,
        y: input.kind === 'point' ? input.y : null,
        timeSeconds: input.kind === 'timestamp' ? input.timeSeconds : null,
        body: input.body,
        visibility: ctx.side === 'client' ? 'client' : input.visibility,
        authorId: ctx.session.userId,
        authorSide: ctx.side,
      })
      .returning({ id: annotations.id, visibility: annotations.visibility });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'annotation.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'deliverable', id: d.id },
      clientId: d.clientId,
      payload: {
        annotationId: row.id,
        deliverableId: d.id,
        clientId: d.clientId,
        visibility: row.visibility as 'internal' | 'client',
        side: ctx.side,
      },
    });
    return { annotationId: row.id };
  },
});

export const replyAnnotationAction = defineAction({
  input: replySchema,
  side: 'any',
  rateLimit: { key: 'annotation', max: 300, windowSeconds: 3600 },
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .insert(annotationReplies)
      .values({
        annotationId: input.annotationId,
        body: input.body,
        authorId: ctx.session.userId,
        authorSide: ctx.side,
        organizationId: ctx.organization.id,
        clientId: ctx.side === 'client' ? ctx.client.id : sql`(select client_id from public.annotations where id = ${input.annotationId})`,
      })
      .returning({ id: annotationReplies.id });
    if (!row) throw new ActionFailure('forbidden');
    return { replyId: row.id };
  },
});

export const resolveAnnotationAction = defineAction({
  input: resolveSchema,
  side: 'any',
  async handler({ input, tx }) {
    const [row] = await tx
      .update(annotations)
      .set({ resolvedAt: input.resolved ? new Date() : null })
      .where(eq(annotations.id, input.annotationId))
      .returning({ id: annotations.id });
    if (!row) throw new ActionFailure('forbidden');
    return null;
  },
});
