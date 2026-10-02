import 'server-only';

import { eq } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { clients, profiles, roles } from '@/lib/db/schema';
import { defineConsumer } from '@/lib/events/dispatcher';
import { localized } from '@/lib/i18n/localized';
import { notify } from '@/modules/notifications/server/notify';

/**
 * `client_user.added` (FR4.2): an existing portal user was given access to another client → they hear about it in the
 * app and by email ("You now have access to <Client>"); the link opens that client. Idempotent through `notify`.
 */
export const portalAccessNotifications = defineConsumer({
  name: 'notifications.portal_access',
  types: ['client_user.added'],
  async handle(event) {
    const { clientId, userId, roleKey } = event.payload;
    const [client] = await dbAdmin.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId));
    const [role] = await dbAdmin.select({ name: roles.name }).from(roles).where(eq(roles.key, roleKey)).limit(1);
    const [actor] = event.actorId
      ? await dbAdmin.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, event.actorId))
      : [];
    if (!client) return;
    await notify({
      organizationId: event.organizationId,
      userIds: [userId],
      type: 'portal_access_granted',
      params: {
        client: localized(client.name, 'ar') || localized(client.name, 'en'),
        role: localized(role?.name, 'ar') || localized(role?.name, 'en'),
        actor: actor?.name ?? '',
      },
      link: '/portal',
      clientId,
      actorId: event.actorId,
      eventId: event.id,
    });
  },
});
