import 'server-only';

import { and, eq } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { clientAssignments, clientUsers, clients, profiles, requests } from '@/lib/db/schema';
import { defineConsumer } from '@/lib/events/dispatcher';
import { localized } from '@/lib/i18n/localized';
import { preview } from '@/modules/messaging/mentions';
import { notify } from '@/modules/notifications/server/notify';

async function load(requestId: string, actorId: string | null) {
  const [request] = await dbAdmin.select().from(requests).where(eq(requests.id, requestId));
  if (!request) return null;
  const [client] = await dbAdmin.select().from(clients).where(eq(clients.id, request.clientId));
  const [actor] = actorId ? await dbAdmin.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, actorId)) : [];
  const team = await dbAdmin
    .select({ userId: clientAssignments.userId })
    .from(clientAssignments)
    .where(eq(clientAssignments.clientId, request.clientId));
  const portalUsers = await dbAdmin
    .select({ userId: clientUsers.userId })
    .from(clientUsers)
    .where(and(eq(clientUsers.clientId, request.clientId), eq(clientUsers.status, 'active')));
  // Account manager + assignee first; the client's assigned team hears about new requests only.
  const owners = [...new Set([client?.accountManagerId, request.assigneeId].filter(Boolean) as string[])];
  return {
    request,
    params: {
      actor: actor?.name ?? '',
      client: client ? localized(client.name, 'ar') || localized(client.name, 'en') : '',
      reference: request.reference ?? '',
      title: request.title,
    },
    owners,
    team: [...new Set([...owners, ...team.map((t) => t.userId)])],
    portal: portalUsers.map((u) => u.userId),
  };
}

/**
 * Request lifecycle → notifications (ADR-028): submitted → account manager & team; needs info → the client with the
 * question; every other agency transition → the client; client resubmit / cancel / close → the account manager.
 */
export const requestNotifications = defineConsumer({
  name: 'notifications.requests',
  types: ['request.submitted', 'request.assigned', 'request.status_changed'],
  async handle(event) {
    const ctx = await load(event.payload.requestId, event.actorId);
    if (!ctx) return;
    const agencyLink = `/requests/${ctx.request.id}`;
    const portalLink = `/portal/requests/${ctx.request.id}`;
    const base = { organizationId: event.organizationId, actorId: event.actorId, eventId: event.id };

    switch (event.type) {
      case 'request.submitted':
        await notify({ ...base, userIds: ctx.team, type: 'request_submitted', params: ctx.params, link: agencyLink });
        return;
      case 'request.assigned':
        if (!event.payload.assigneeId) return;
        await notify({ ...base, userIds: [event.payload.assigneeId], type: 'request_assigned', params: ctx.params, link: agencyLink });
        return;
      case 'request.status_changed': {
        const { to, reason } = event.payload;
        const params = { ...ctx.params, status: to };
        const quote = reason ? preview(reason, 600) : undefined;
        const actorIsClient = event.actorId ? ctx.portal.includes(event.actorId) : false;
        if (actorIsClient) {
          await notify({ ...base, userIds: ctx.owners, type: 'request_status_changed', params, link: agencyLink, quote });
          return;
        }
        await notify({
          ...base,
          userIds: ctx.portal,
          type: to === 'needs_info' ? 'request_needs_info' : 'request_status_changed',
          params,
          link: portalLink,
          quote,
        });
        // The account manager / assignee hears about changes a teammate made.
        await notify({ ...base, userIds: ctx.owners, type: 'request_status_changed', params, link: agencyLink, quote });
        return;
      }
    }
  },
});
