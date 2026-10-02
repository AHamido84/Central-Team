import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { automations, integrationConnections, whatsappMessages } from '@/lib/db/schema';
import { defineConsumer } from '@/lib/events/dispatcher';
import type { Permission } from '@/lib/permissions/catalog';
import { notify } from '@/modules/notifications/server/notify';

const providerLabel: Record<string, string> = {
  meta: 'Meta',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
  google: 'Google',
  x: 'X',
  linkedin: 'LinkedIn',
};

async function holders(organizationId: string, permission: Permission): Promise<string[]> {
  const rows = await dbAdmin.execute<{ user_id: string }>(sql`
    select m.user_id from public.organization_members m
    where m.organization_id = ${organizationId} and m.status = 'active' and m.user_type = 'agency'
      and app.member_has_permission(m.organization_id, m.user_id, ${permission})`);
  return rows.map((r) => r.user_id);
}

/**
 * Integration health notifications (category `integrations`, agency only): an expired connection or a sync that gave
 * up → everyone with `integrations:manage`; a failed automation → everyone with `automations:manage`; a lead message
 * that failed → its sender. Notification-purpose WhatsApp failures notify nobody (no loops through the same channel).
 */
export const integrationNotifications = defineConsumer({
  name: 'notifications.integrations',
  types: [
    'integration.connection_expired',
    'integration.connection_expiring',
    'integration.sync_failed',
    'automation.failed',
    'whatsapp.message_failed',
  ],
  async handle(event) {
    switch (event.type) {
      case 'integration.connection_expiring': {
        // Personal connection (FR1.6): the owner renews their own token.
        const [c] = await dbAdmin.select().from(integrationConnections).where(eq(integrationConnections.id, event.payload.connectionId));
        if (!c?.ownerId || c.status !== 'connected') return;
        await notify({
          organizationId: event.organizationId,
          actorId: null,
          eventId: event.id,
          userIds: [c.ownerId],
          type: 'integration_expiring',
          params: { provider: providerLabel[c.provider] ?? c.provider, name: c.name, date: event.payload.expiresAt.slice(0, 10) },
          link: '/settings/connections',
        });
        return;
      }
      case 'integration.connection_expired':
      case 'integration.sync_failed': {
        const [c] = await dbAdmin.select().from(integrationConnections).where(eq(integrationConnections.id, event.payload.connectionId));
        if (!c || c.status === 'disconnected') return;
        if (event.type === 'integration.connection_expired' && c.status !== 'expired') return;
        await notify({
          organizationId: event.organizationId,
          actorId: null,
          eventId: event.id,
          // A personal connection's owner hears about it too (FR1.6).
          userIds: [...new Set([...(await holders(event.organizationId, 'integrations:manage')), ...(c.ownerId ? [c.ownerId] : [])])],
          type: event.type === 'integration.connection_expired' ? 'integration_expired' : 'integration_sync_failed',
          params: { provider: providerLabel[c.provider] ?? c.provider, name: c.name, error: event.payload.errorCode },
          link: `/admin/integrations/${c.id}`,
        });
        return;
      }
      case 'automation.failed': {
        const [a] = await dbAdmin
          .select({ id: automations.id, name: automations.name })
          .from(automations)
          .where(eq(automations.id, event.payload.automationId));
        if (!a) return;
        await notify({
          organizationId: event.organizationId,
          actorId: null,
          eventId: event.id,
          userIds: await holders(event.organizationId, 'automations:manage'),
          type: 'automation_failed',
          params: { name: a.name },
          link: `/admin/automations/${a.id}?tab=runs`,
        });
        return;
      }
      case 'whatsapp.message_failed': {
        const [m] = await dbAdmin.select().from(whatsappMessages).where(eq(whatsappMessages.id, event.payload.messageId));
        if (!m || m.purpose !== 'lead' || !m.sentBy || m.status !== 'failed') return;
        await notify({
          organizationId: event.organizationId,
          actorId: null,
          eventId: event.id,
          userIds: [m.sentBy],
          type: 'whatsapp_failed',
          params: { phone: m.toPhone, error: m.errorCode ?? 'platform_error' },
          link: m.leadId ? `/crm/leads/${m.leadId}` : m.dealId ? `/crm/deals/${m.dealId}` : '/crm/leads',
        });
        return;
      }
    }
  },
});
