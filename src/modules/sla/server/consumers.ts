import 'server-only';

import { eq } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { clients, requests, slaBreaches, slaPolicies } from '@/lib/db/schema';
import { defineConsumer } from '@/lib/events/dispatcher';
import { localized } from '@/lib/i18n/localized';
import { notify } from '@/modules/notifications/server/notify';

/**
 * SLA alerts → notifications (ADR-028). At risk → the request's assignee (else the account manager);
 * breached → assignee, account manager and the policy's escalation contact. Skipped when the breach was
 * resolved before the event was handled (e.g. the reply came in the meantime).
 */
export const slaNotifications = defineConsumer({
  name: 'notifications.sla',
  types: ['sla.at_risk', 'sla.breached'],
  async handle(event) {
    const [row] = await dbAdmin
      .select({
        b: slaBreaches,
        reference: requests.reference,
        title: requests.title,
        assigneeId: requests.assigneeId,
        clientName: clients.name,
        am: clients.accountManagerId,
        escalateTo: slaPolicies.escalateTo,
      })
      .from(slaBreaches)
      .innerJoin(requests, eq(requests.id, slaBreaches.requestId))
      .innerJoin(clients, eq(clients.id, slaBreaches.clientId))
      .leftJoin(slaPolicies, eq(slaPolicies.id, slaBreaches.policyId))
      .where(eq(slaBreaches.id, event.payload.breachId));
    if (!row || row.b.resolvedAt) return;
    const breached = event.type === 'sla.breached';
    const userIds = breached ? [row.assigneeId, row.am, row.escalateTo] : [row.assigneeId ?? row.am];
    await notify({
      organizationId: event.organizationId,
      actorId: null,
      eventId: event.id,
      userIds: userIds.filter((id): id is string => Boolean(id)),
      type: breached ? 'sla_breached' : 'sla_at_risk',
      params: {
        reference: row.reference ?? '',
        title: row.title,
        client: localized(row.clientName, 'ar') || localized(row.clientName, 'en'),
        kind: row.b.kind,
      },
      link: `/requests/${row.b.requestId}`,
    });
  },
});
