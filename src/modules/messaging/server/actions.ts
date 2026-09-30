'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { AppContext } from '@/lib/auth/context';
import { commentAttachments, comments, files, threadReads, threads } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { can } from '@/lib/permissions/can';
import { extractMentionIds } from '@/modules/messaging/mentions';
import { getThread, type ThreadDetail } from '@/modules/messaging/server/queries';

function writeSide(ctx: AppContext, clientId: string, visibility: 'internal' | 'client') {
  if (ctx.side === 'agency') {
    if (!can(ctx.permissions, 'messages:send')) throw new ActionFailure('forbidden');
    return { side: 'agency' as const, visibility };
  }
  if (ctx.client.id !== clientId || !can(ctx.permissions, 'portal_messages:send')) throw new ActionFailure('forbidden');
  return { side: 'client' as const, visibility: 'client' as const };
}

const bodySchema = z.string().trim().min(1, { message: 'required' }).max(10000, { message: 'too_long' });

export const createThreadAction = defineAction({
  input: z.object({
    clientId: z.uuid(),
    title: z.string().trim().min(1, { message: 'required' }).max(140),
    visibility: z.enum(['internal', 'client']),
    body: bodySchema,
  }),
  side: 'any',
  async handler({ input, tx, ctx }) {
    const rights = writeSide(ctx, input.clientId, input.visibility);
    const threadId = crypto.randomUUID();
    await tx.insert(threads).values({
      id: threadId,
      organizationId: ctx.organization.id,
      clientId: input.clientId,
      title: input.title,
      visibility: rights.visibility,
      createdBy: ctx.session.userId,
    });
    const commentId = crypto.randomUUID();
    const mentions = extractMentionIds(input.body);
    await tx.insert(comments).values({
      id: commentId,
      organizationId: ctx.organization.id,
      clientId: input.clientId,
      threadId,
      authorId: ctx.session.userId,
      authorSide: rights.side,
      body: input.body,
      visibility: rights.visibility,
      mentions,
    });
    await tx
      .insert(threadReads)
      .values({ threadId, userId: ctx.session.userId, organizationId: ctx.organization.id, clientId: input.clientId });
    await emitEvent(tx, {
      type: 'thread.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'thread', id: threadId },
      clientId: input.clientId,
      payload: { threadId, clientId: input.clientId },
    });
    const eventId = await emitEvent(tx, {
      type: 'comment.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'comment', id: commentId },
      clientId: input.clientId,
      payload: { commentId, threadId, clientId: input.clientId, visibility: rights.visibility, mentions },
    });
    return { threadId, commentId, eventId, side: rights.side, visibility: rights.visibility, mentions };
  },
  revalidate: (input) => [`/clients/${input.clientId}`, '/messages', '/portal/messages'],
});

export const postCommentAction = defineAction({
  input: z.object({
    threadId: z.uuid(),
    body: bodySchema,
    internal: z.boolean(),
    attachmentIds: z.array(z.uuid()).max(10),
  }),
  side: 'any',
  rateLimit: { key: 'comment', max: 120, windowSeconds: 600 },
  async handler({ input, tx, ctx }) {
    const [thread] = await tx.select().from(threads).where(eq(threads.id, input.threadId));
    if (!thread) throw new ActionFailure('not_found');
    const rights = writeSide(ctx, thread.clientId, input.internal || thread.visibility === 'internal' ? 'internal' : 'client');
    if (input.attachmentIds.length) {
      const owned = await tx
        .select({ id: files.id, visibility: files.visibility })
        .from(files)
        .where(and(inArray(files.id, input.attachmentIds), eq(files.uploadedBy, ctx.session.userId), eq(files.clientId, thread.clientId)));
      if (owned.length !== input.attachmentIds.length) throw new ActionFailure('forbidden');
      // An attachment must be exactly as visible as its message (the composer uploads with the right visibility).
      if (owned.some((f) => f.visibility !== rights.visibility)) throw new ActionFailure('validation');
    }
    const commentId = crypto.randomUUID();
    const mentions = extractMentionIds(input.body);
    await tx.insert(comments).values({
      id: commentId,
      organizationId: ctx.organization.id,
      clientId: thread.clientId,
      threadId: thread.id,
      authorId: ctx.session.userId,
      authorSide: rights.side,
      body: input.body,
      visibility: rights.visibility,
      mentions,
    });
    if (input.attachmentIds.length) {
      await tx
        .insert(commentAttachments)
        .values(
          input.attachmentIds.map((fileId) => ({ commentId, fileId, organizationId: ctx.organization.id, clientId: thread.clientId })),
        );
    }
    await tx
      .insert(threadReads)
      .values({
        threadId: thread.id,
        userId: ctx.session.userId,
        organizationId: ctx.organization.id,
        clientId: thread.clientId,
        lastReadAt: new Date(),
      })
      .onConflictDoUpdate({ target: [threadReads.threadId, threadReads.userId], set: { lastReadAt: new Date() } });
    const eventId = await emitEvent(tx, {
      type: 'comment.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'comment', id: commentId },
      clientId: thread.clientId,
      payload: { commentId, threadId: thread.id, clientId: thread.clientId, visibility: rights.visibility, mentions },
    });
    return {
      commentId,
      eventId,
      clientId: thread.clientId,
      threadTitle: thread.title,
      side: rights.side,
      visibility: rights.visibility,
      mentions,
    };
  },
});

/** Authors edit their own messages (RLS: `comments_update` allows only the author; body and edited_at only). */
export const editCommentAction = defineAction({
  input: z.object({ commentId: z.uuid(), body: bodySchema }),
  side: 'any',
  rateLimit: { key: 'comment', max: 120, windowSeconds: 600 },
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .update(comments)
      .set({ body: input.body, editedAt: new Date() })
      .where(and(eq(comments.id, input.commentId), eq(comments.authorId, ctx.session.userId)))
      .returning({ threadId: comments.threadId, clientId: comments.clientId });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'comment.edited',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'comment', id: input.commentId },
      clientId: row.clientId,
      payload: { commentId: input.commentId, threadId: row.threadId, clientId: row.clientId },
    });
    return row;
  },
});

export const markThreadReadAction = defineAction({
  input: z.object({ threadId: z.uuid() }),
  side: 'any',
  async handler({ input, tx, ctx }) {
    const [thread] = await tx.select({ clientId: threads.clientId }).from(threads).where(eq(threads.id, input.threadId));
    if (!thread) throw new ActionFailure('not_found');
    await tx
      .insert(threadReads)
      .values({
        threadId: input.threadId,
        userId: ctx.session.userId,
        organizationId: ctx.organization.id,
        clientId: thread.clientId,
        lastReadAt: new Date(),
      })
      .onConflictDoUpdate({ target: [threadReads.threadId, threadReads.userId], set: { lastReadAt: new Date() } });
    return null;
  },
});

/** Client-side refresh of a thread after a realtime event (RLS-scoped). */
export const loadThreadAction = defineAction({
  input: z.object({ threadId: z.uuid() }),
  side: 'any',
  async handler({ input }): Promise<ThreadDetail> {
    const thread = await getThread(input.threadId);
    if (!thread) throw new ActionFailure('not_found');
    return thread;
  },
});
