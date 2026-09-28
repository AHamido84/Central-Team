import 'server-only';

import { and, eq } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { clientAssignments, clientUsers, clients, comments, profiles, requests, threads } from '@/lib/db/schema';
import { defineConsumer } from '@/lib/events/dispatcher';
import { preview } from '@/modules/messaging/mentions';
import { notify } from '@/modules/notifications/server/notify';
import { formatRequestNumber } from '@/modules/requests/constants';

/** Everyone who should hear about activity in a thread, split by side. Computed server-side from the DB. */
export async function threadAudience(clientId: string, threadId: string, visibility: 'internal' | 'client') {
  const [client] = await dbAdmin.select({ am: clients.accountManagerId }).from(clients).where(eq(clients.id, clientId));
  const team = await dbAdmin
    .select({ userId: clientAssignments.userId })
    .from(clientAssignments)
    .where(eq(clientAssignments.clientId, clientId));
  const commenters = await dbAdmin
    .selectDistinct({ userId: comments.authorId, side: comments.authorSide })
    .from(comments)
    .where(eq(comments.threadId, threadId));
  const agency = new Set<string>(
    [client?.am, ...team.map((t) => t.userId), ...commenters.filter((c) => c.side === 'agency').map((c) => c.userId)].filter(
      Boolean,
    ) as string[],
  );
  const clientSide =
    visibility === 'client'
      ? (
          await dbAdmin
            .select({ userId: clientUsers.userId })
            .from(clientUsers)
            .where(and(eq(clientUsers.clientId, clientId), eq(clientUsers.status, 'active')))
        ).map((u) => u.userId)
      : [];
  return { agency: [...agency], client: clientSide };
}

/**
 * `comment.created` → message / mention notifications. Request conversations link to the request page
 * and also reach the request's assignee.
 */
export const messageNotifications = defineConsumer({
  name: 'notifications.messages',
  types: ['comment.created'],
  async handle(event) {
    const { commentId, threadId, clientId, visibility, mentions } = event.payload;
    const [comment] = await dbAdmin.select().from(comments).where(eq(comments.id, commentId));
    const [thread] = await dbAdmin.select().from(threads).where(eq(threads.id, threadId));
    if (!comment || !thread || comment.deletedAt) return;
    const [actor] = event.actorId
      ? await dbAdmin.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, event.actorId))
      : [];

    const audience = await threadAudience(clientId, threadId, visibility);
    let title = thread.title;
    let links = { agency: `/messages?thread=${threadId}`, client: `/portal/messages?thread=${threadId}` };
    if (thread.subjectType === 'request' && thread.subjectId) {
      const [request] = await dbAdmin
        .select({ id: requests.id, number: requests.number, assigneeId: requests.assigneeId })
        .from(requests)
        .where(eq(requests.id, thread.subjectId));
      if (request) {
        title = `${formatRequestNumber(request.number)} · ${thread.title}`;
        links = { agency: `/requests/${request.id}`, client: `/portal/requests/${request.id}` };
        if (request.assigneeId && !audience.agency.includes(request.assigneeId)) audience.agency.push(request.assigneeId);
      }
    }

    const author = comment.authorId;
    // Mentions only reach people who can actually see the message.
    const visible = new Set([...audience.agency, ...audience.client]);
    const mentioned = mentions.filter((id) => visible.has(id) && id !== author);
    const params = { actor: actor?.name ?? '', thread: title, preview: preview(comment.body, 90) };
    const quote = preview(comment.body, 600);
    const clientSet = new Set(audience.client);
    const base = { organizationId: event.organizationId, actorId: author, eventId: event.id, quote, params };

    await notify({ ...base, userIds: mentioned.filter((id) => !clientSet.has(id)), type: 'mention', link: links.agency });
    await notify({ ...base, userIds: mentioned.filter((id) => clientSet.has(id)), type: 'mention', link: links.client });

    const others = (ids: string[]) => ids.filter((id) => !mentioned.includes(id));
    // Client authors notify the agency team; agency authors notify the client (and teammates on internal notes).
    await notify({ ...base, userIds: others(audience.agency), type: 'message_new', link: links.agency });
    if (comment.authorSide === 'agency') {
      await notify({ ...base, userIds: others(audience.client), type: 'message_new', link: links.client });
    }
  },
});
