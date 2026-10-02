import 'server-only';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { withRls } from '@/lib/db/rls';
import { clients, commentAttachments, comments, files, profiles, threadReads, threads } from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import { toFileItem, type FileItem } from '@/modules/files/server/queries';

export type ThreadSummary = {
  id: string;
  clientId: string;
  clientName: LocalizedText;
  clientLogo: string | null;
  title: string;
  visibility: 'internal' | 'client';
  lastCommentAt: string;
  preview: string | null;
  lastAuthorName: string | null;
  lastAuthorSide: 'agency' | 'client' | null;
  unread: number;
};

/**
 * General conversation threads visible to the caller (RLS), newest activity first, with unread counts.
 * Request conversations (`subject_type = 'request'`) live on their request page instead.
 */
export async function listThreads(opts: { clientId?: string; limit?: number } = {}): Promise<ThreadSummary[]> {
  return withRls(async (tx) => {
    const rows = await tx
      .select({
        t: threads,
        clientName: clients.name,
        clientLogo: clients.logoPath,
        preview: sql<
          string | null
        >`(select c.body from public.comments c where c.thread_id = threads.id and c.deleted_at is null order by c.created_at desc limit 1)`,
        lastAuthorName: sql<
          string | null
        >`(select p.full_name from public.comments c join public.profiles p on p.id = c.author_id where c.thread_id = threads.id and c.deleted_at is null order by c.created_at desc limit 1)`,
        lastAuthorSide: sql<
          'agency' | 'client' | null
        >`(select c.author_side from public.comments c where c.thread_id = threads.id and c.deleted_at is null order by c.created_at desc limit 1)`,
        unread: sql<number>`(select count(*)::int from public.comments c where c.thread_id = threads.id and c.deleted_at is null and c.author_id is distinct from auth.uid() and c.created_at > coalesce((select r.last_read_at from public.thread_reads r where r.thread_id = threads.id and r.user_id = auth.uid()), 'epoch'))`,
      })
      .from(threads)
      .innerJoin(clients, eq(clients.id, threads.clientId))
      .where(
        and(
          opts.clientId ? eq(threads.clientId, opts.clientId) : undefined,
          eq(threads.subjectType, 'client'),
          sql`${threads.archivedAt} is null`,
        ),
      )
      .orderBy(desc(threads.lastCommentAt))
      .limit(opts.limit ?? 200);
    return rows.map((r) => ({
      id: r.t.id,
      clientId: r.t.clientId,
      clientName: r.clientName,
      clientLogo: r.clientLogo,
      title: r.t.title,
      visibility: r.t.visibility as 'internal' | 'client',
      lastCommentAt: r.t.lastCommentAt.toISOString(),
      preview: r.preview,
      lastAuthorName: r.lastAuthorName,
      lastAuthorSide: r.lastAuthorSide,
      unread: r.unread,
    }));
  });
}

export type CommentView = {
  id: string;
  body: string;
  visibility: 'internal' | 'client';
  authorId: string | null;
  authorName: string;
  authorAvatar: string | null;
  authorSide: 'agency' | 'client';
  createdAt: string;
  editedAt: string | null;
  attachments: FileItem[];
};

export type ThreadDetail = {
  thread: { id: string; clientId: string; title: string; visibility: 'internal' | 'client' };
  comments: CommentView[];
  reads: { userId: string; name: string; avatarPath: string | null; side: 'agency' | 'client'; lastReadAt: string }[];
  participants: { userId: string; name: string; avatarPath: string | null; side: 'agency' | 'client' }[];
};

export async function getThread(threadId: string): Promise<ThreadDetail | null> {
  return withRls(async (tx) => {
    const [thread] = await tx.select().from(threads).where(eq(threads.id, threadId));
    if (!thread) return null;
    const rows = await tx
      .select({ c: comments, name: profiles.fullName, avatar: profiles.avatarPath })
      .from(comments)
      .leftJoin(profiles, eq(profiles.id, comments.authorId))
      .where(and(eq(comments.threadId, threadId), sql`${comments.deletedAt} is null`))
      .orderBy(asc(comments.createdAt))
      .limit(500);
    const ids = rows.map((r) => r.c.id);
    const attachments = ids.length
      ? await tx
          .select({
            commentId: commentAttachments.commentId,
            file: files,
            uploaderName: profiles.fullName,
            uploaderAvatar: profiles.avatarPath,
          })
          .from(commentAttachments)
          .innerJoin(files, eq(files.id, commentAttachments.fileId))
          .leftJoin(profiles, eq(profiles.id, files.uploadedBy))
          .where(inArray(commentAttachments.commentId, ids))
      : [];
    const reads = await tx
      .select({ userId: threadReads.userId, lastReadAt: threadReads.lastReadAt, name: profiles.fullName, avatarPath: profiles.avatarPath })
      .from(threadReads)
      .innerJoin(profiles, eq(profiles.id, threadReads.userId))
      .where(eq(threadReads.threadId, threadId));
    const participants = await tx.execute<{ user_id: string; name: string; avatar_path: string | null; side: 'agency' | 'client' }>(sql`
      select p.id as user_id, p.full_name as name, p.avatar_path, 'client' as side
        from public.client_users cu join public.profiles p on p.id = cu.user_id
        where cu.client_id = ${thread.clientId} and cu.status = 'active' and ${thread.visibility} = 'client'
      union
      select p.id, p.full_name, p.avatar_path, 'agency'
        from public.clients c join public.profiles p on p.id = c.account_manager_id
        where c.id = ${thread.clientId}
      union
      select p.id, p.full_name, p.avatar_path, 'agency'
        from public.client_assignments a join public.profiles p on p.id = a.user_id
        where a.client_id = ${thread.clientId}
      union
      select p.id, p.full_name, p.avatar_path, c.author_side
        from public.comments c join public.profiles p on p.id = c.author_id
        where c.thread_id = ${threadId}
      union
      -- Task conversations are internal: anyone on the agency team can be mentioned.
      select p.id, p.full_name, p.avatar_path, 'agency'
        from public.organization_members m join public.profiles p on p.id = m.user_id
        where ${thread.subjectType} = 'task' and m.organization_id = ${thread.organizationId}
          and m.user_type = 'agency' and m.status = 'active'`);
    const sideOf = new Map(participants.map((p) => [p.user_id, p.side]));
    return {
      thread: { id: thread.id, clientId: thread.clientId, title: thread.title, visibility: thread.visibility as 'internal' | 'client' },
      comments: rows.map(({ c, name, avatar }) => ({
        id: c.id,
        body: c.body,
        visibility: c.visibility as 'internal' | 'client',
        authorId: c.authorId,
        authorName: name ?? '',
        authorAvatar: avatar,
        authorSide: c.authorSide as 'agency' | 'client',
        createdAt: c.createdAt.toISOString(),
        editedAt: c.editedAt?.toISOString() ?? null,
        attachments: attachments.filter((a) => a.commentId === c.id).map((a) => toFileItem(a.file, a.uploaderName, a.uploaderAvatar)),
      })),
      reads: reads.map((r) => ({ ...r, side: sideOf.get(r.userId) ?? 'agency', lastReadAt: r.lastReadAt.toISOString() })),
      participants: [
        ...new Map(
          participants.map((p) => [p.user_id, { userId: p.user_id, name: p.name, avatarPath: p.avatar_path, side: p.side }]),
        ).values(),
      ],
    };
  });
}
