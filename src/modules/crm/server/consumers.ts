import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { crmActivities, deals, leads } from '@/lib/db/schema';
import { defineConsumer } from '@/lib/events/dispatcher';
import { dealReference, leadReference } from '@/modules/crm/constants';
import { notify } from '@/modules/notifications/server/notify';

/** Everyone who oversees the whole pipeline (`crm:manage_all`). */
async function salesManagers(organizationId: string): Promise<string[]> {
  const rows = await dbAdmin.execute<{ user_id: string }>(sql`
    select m.user_id from public.organization_members m
    where m.organization_id = ${organizationId} and m.status = 'active' and m.user_type = 'agency'
      and app.member_has_permission(m.organization_id, m.user_id, 'crm:manage_all')`);
  return rows.map((r) => r.user_id);
}

/**
 * Sales notifications (ADR-028; category `sales`, agency users only). Assignment → the new owner; a follow-up due →
 * its owner; a stale deal → its owner (else the sales managers); a won deal → the sales managers and the owner.
 * Each handler re-reads the row and skips when the situation already changed (completed, reassigned, closed).
 */
export const crmNotifications = defineConsumer({
  name: 'notifications.crm',
  types: ['lead.assigned', 'crm_activity.due', 'deal.stale', 'deal.won'],
  async handle(event) {
    switch (event.type) {
      case 'lead.assigned': {
        const [lead] = await dbAdmin.select().from(leads).where(eq(leads.id, event.payload.leadId));
        if (!lead?.ownerId || lead.ownerId !== event.payload.ownerId || lead.deletedAt) return;
        await notify({
          organizationId: event.organizationId,
          actorId: event.actorId,
          eventId: event.id,
          userIds: [lead.ownerId],
          type: 'lead_assigned',
          params: { reference: leadReference(lead.number), name: lead.fullName },
          link: `/crm/leads/${lead.id}`,
        });
        return;
      }
      case 'crm_activity.due': {
        const [row] = await dbAdmin
          .select({ a: crmActivities, dealTitle: deals.title, leadName: leads.fullName })
          .from(crmActivities)
          .leftJoin(deals, eq(deals.id, crmActivities.dealId))
          .leftJoin(leads, eq(leads.id, crmActivities.leadId))
          .where(eq(crmActivities.id, event.payload.activityId));
        // A follow-up in the Trash (with its lead, FR5) isn't announced.
        if (!row || row.a.completedAt || !row.a.ownerId || row.a.deletedAt) return;
        await notify({
          organizationId: event.organizationId,
          actorId: null,
          eventId: event.id,
          userIds: [row.a.ownerId],
          type: 'crm_followup_due',
          params: { subject: row.a.subject, parent: row.dealTitle ?? row.leadName ?? '', type: row.a.type },
          link: row.a.dealId ? `/crm/deals/${row.a.dealId}` : `/crm/leads/${row.a.leadId}`,
        });
        return;
      }
      case 'deal.stale': {
        const [deal] = await dbAdmin.select().from(deals).where(eq(deals.id, event.payload.dealId));
        if (!deal || deal.status !== 'open') return;
        await notify({
          organizationId: event.organizationId,
          actorId: null,
          eventId: event.id,
          userIds: deal.ownerId ? [deal.ownerId] : await salesManagers(event.organizationId),
          type: 'deal_stale',
          params: { reference: dealReference(deal.number), title: deal.title, days: event.payload.days },
          link: `/crm/deals/${deal.id}`,
        });
        return;
      }
      case 'deal.won': {
        const [deal] = await dbAdmin.select().from(deals).where(eq(deals.id, event.payload.dealId));
        if (!deal || deal.status !== 'won') return;
        await notify({
          organizationId: event.organizationId,
          actorId: event.actorId,
          eventId: event.id,
          userIds: [...(await salesManagers(event.organizationId)), ...(deal.ownerId ? [deal.ownerId] : [])],
          type: 'deal_won',
          params: { reference: dealReference(deal.number), title: deal.title, valueSar: Math.round(deal.valueMinor / 100) },
          link: `/crm/deals/${deal.id}`,
        });
        return;
      }
    }
  },
});
