import 'server-only';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import type { ClientContext } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import { clients, comments, files, profiles, threads } from '@/lib/db/schema';
import { getCurrentPackageUsage } from '@/modules/clients/server/package-usage';

export type ActivityItem =
  | {
      kind: 'file';
      id: string;
      at: string;
      actorName: string | null;
      actorAvatar: string | null;
      fileName: string;
      folderId: string | null;
    }
  | {
      kind: 'message';
      id: string;
      at: string;
      actorName: string | null;
      actorAvatar: string | null;
      threadId: string;
      threadTitle: string;
      /** Set when the message belongs to a request conversation (links to the request page). */
      requestId: string | null;
      body: string;
    };

/** Everything the portal home needs, read as the client user (RLS keeps it to their client, client-visible only). */
export async function getPortalHome(ctx: ClientContext) {
  const clientId = ctx.client.id;
  return withRls(async (tx) => {
    const [client] = await tx.select().from(clients).where(eq(clients.id, clientId));
    const [am] = client?.accountManagerId ? await tx.select().from(profiles).where(eq(profiles.id, client.accountManagerId)) : [];
    const usage = await getCurrentPackageUsage(tx, clientId);

    const recentFiles = await tx
      .select({
        id: files.id,
        name: files.name,
        at: files.createdAt,
        folderId: files.folderId,
        actorName: profiles.fullName,
        actorAvatar: profiles.avatarPath,
      })
      .from(files)
      .leftJoin(profiles, eq(profiles.id, files.uploadedBy))
      .where(and(eq(files.clientId, clientId), eq(files.source, 'library'), isNull(files.deletedAt)))
      .orderBy(desc(files.createdAt))
      .limit(8);
    const recentMessages = await tx
      .select({
        id: comments.id,
        at: comments.createdAt,
        body: comments.body,
        threadId: comments.threadId,
        threadTitle: threads.title,
        subjectType: threads.subjectType,
        subjectId: threads.subjectId,
        actorName: profiles.fullName,
        actorAvatar: profiles.avatarPath,
      })
      .from(comments)
      .innerJoin(threads, eq(threads.id, comments.threadId))
      .leftJoin(profiles, eq(profiles.id, comments.authorId))
      .where(and(eq(comments.clientId, clientId), isNull(comments.deletedAt)))
      .orderBy(desc(comments.createdAt))
      .limit(8);
    const activity: ActivityItem[] = [
      ...recentFiles.map((f) => ({
        kind: 'file' as const,
        id: f.id,
        at: f.at.toISOString(),
        actorName: f.actorName,
        actorAvatar: f.actorAvatar,
        fileName: f.name,
        folderId: f.folderId,
      })),
      ...recentMessages.map((m) => ({
        kind: 'message' as const,
        id: m.id,
        at: m.at.toISOString(),
        actorName: m.actorName,
        actorAvatar: m.actorAvatar,
        threadId: m.threadId,
        threadTitle: m.threadTitle,
        requestId: m.subjectType === 'request' ? m.subjectId : null,
        body: m.body,
      })),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 8);

    const [unread] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from public.comments c
      join public.threads t on t.id = c.thread_id and t.subject_type = 'client'
      where c.client_id = ${clientId} and c.deleted_at is null and c.author_id is distinct from auth.uid()
        and c.created_at > coalesce((select r.last_read_at from public.thread_reads r where r.thread_id = c.thread_id and r.user_id = auth.uid()), 'epoch')`);

    return {
      client: client!,
      accountManager: am ? { name: am.fullName, email: am.email, phone: am.phone, whatsapp: am.whatsapp, avatarPath: am.avatarPath } : null,
      usage,
      activity,
      unreadMessages: unread?.n ?? 0,
      fileCount: recentFiles.length,
    };
  });
}
