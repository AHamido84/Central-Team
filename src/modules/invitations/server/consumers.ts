import 'server-only';

import { eq } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { invitations, profiles } from '@/lib/db/schema';
import { defineConsumer } from '@/lib/events/dispatcher';
import { notify } from '@/modules/notifications/server/notify';

/** `invitation.accepted` → the inviter hears that the person joined. */
export const invitationNotifications = defineConsumer({
  name: 'notifications.invitations',
  types: ['invitation.accepted'],
  async handle(event) {
    if (!event.aggregateId) return;
    const [invitation] = await dbAdmin.select().from(invitations).where(eq(invitations.id, event.aggregateId));
    if (!invitation?.invitedBy) return;
    const [person] = await dbAdmin.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, event.payload.userId));
    await notify({
      organizationId: event.organizationId,
      userIds: [invitation.invitedBy],
      type: 'invitation_accepted',
      params: { name: person?.name || invitation.fullName || invitation.email },
      link: invitation.userType === 'client' && invitation.clientId ? `/clients/${invitation.clientId}?tab=users` : '/admin/users',
      actorId: event.payload.userId,
      eventId: event.id,
    });
  },
});
