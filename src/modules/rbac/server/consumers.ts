import 'server-only';

import { eq } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { profiles } from '@/lib/db/schema';
import { defineConsumer } from '@/lib/events/dispatcher';
import { notify } from '@/modules/notifications/server/notify';

/** `user.roles_changed` → the member hears that their access changed. */
export const roleNotifications = defineConsumer({
  name: 'notifications.roles',
  types: ['user.roles_changed'],
  async handle(event) {
    const { userId, added, removed } = event.payload;
    if (added.length + removed.length === 0) return;
    const [actor] = event.actorId
      ? await dbAdmin.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, event.actorId))
      : [];
    await notify({
      organizationId: event.organizationId,
      userIds: [userId],
      type: 'roles_changed',
      params: { actor: actor?.name ?? '' },
      link: '/dashboard',
      actorId: event.actorId,
      eventId: event.id,
    });
  },
});
