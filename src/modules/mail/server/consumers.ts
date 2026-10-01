import 'server-only';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { defineConsumer } from '@/lib/events/dispatcher';
import { notify } from '@/modules/notifications/server/notify';

async function managers(organizationId: string): Promise<string[]> {
  const rows = await dbAdmin.execute<{ user_id: string }>(sql`
    select m.user_id from public.organization_members m
    where m.organization_id = ${organizationId} and m.status = 'active' and m.user_type = 'agency'
      and app.member_has_permission(m.organization_id, m.user_id, 'mail:manage')`);
  return rows.map((r) => r.user_id);
}

/** Sender health (FR2.1): the backup sender took over, or today's limit is close → everyone with `mail:manage`. */
export const mailNotifications = defineConsumer({
  name: 'notifications.mail',
  types: ['mail.fallback_used', 'mail.limit_approaching'],
  async handle(event) {
    const userIds = await managers(event.organizationId);
    if (event.type === 'mail.fallback_used')
      await notify({
        organizationId: event.organizationId,
        actorId: null,
        eventId: event.id,
        userIds,
        type: 'mail_fallback',
        params: { error: event.payload.errorCode },
        link: '/admin/mail',
      });
    else
      await notify({
        organizationId: event.organizationId,
        actorId: null,
        eventId: event.id,
        userIds,
        type: 'mail_limit',
        params: { sent: event.payload.sent, limit: event.payload.limit },
        link: '/admin/mail',
      });
  },
});
