import 'server-only';

import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { crmActivities, crmSettings, deals, organizations } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { zonedInstant } from '@/modules/sla/calendar';
import { addDays, dayInZone } from '@/modules/tasks/constants';

export type CrmSweepResult = { followUpsDue: number; staleDeals: number };

/**
 * Sales reminders, run from the cron route with the service connection (listed service path, CLAUDE.md §6) because
 * it scans every organization. Only writes reminder markers + domain events; notifications come from the consumers.
 *  - Follow-ups: an open activity due before the end of today (org time zone) is announced once (`reminded_at`);
 *    rescheduling clears the marker, so the new date is announced again.
 *  - Stale deals: an open deal without activity for `crm_settings.stale_days` is announced once per quiet spell
 *    (`stale_notified_at` older than the last activity means a new spell).
 */
export async function runCrmSweep(now = new Date()): Promise<CrmSweepResult> {
  const result: CrmSweepResult = { followUpsDue: 0, staleDeals: 0 };
  const orgs = await dbAdmin
    .select({ id: organizations.id, tz: organizations.defaultTimezone, staleDays: crmSettings.staleDays })
    .from(organizations)
    .leftJoin(crmSettings, eq(crmSettings.organizationId, organizations.id));
  for (const org of orgs) {
    const endOfToday = zonedInstant(addDays(dayInZone(now, org.tz), 1), 0, org.tz).toISOString();
    const staleDays = org.staleDays ?? 7;
    const staleBefore = new Date(now.getTime() - staleDays * 86_400_000).toISOString();
    await dbAdmin.transaction(async (tx) => {
      const due = await tx
        .update(crmActivities)
        .set({ remindedAt: now })
        .where(
          and(
            eq(crmActivities.organizationId, org.id),
            isNull(crmActivities.completedAt),
            isNotNull(crmActivities.ownerId),
            sql`${crmActivities.dueAt} < ${endOfToday}::timestamptz`,
            isNull(crmActivities.remindedAt),
          ),
        )
        .returning({
          id: crmActivities.id,
          ownerId: crmActivities.ownerId,
          dealId: crmActivities.dealId,
          leadId: crmActivities.leadId,
          dueAt: crmActivities.dueAt,
        });
      for (const a of due) {
        await emitEvent(tx, {
          type: 'crm_activity.due',
          organizationId: org.id,
          actorId: null,
          aggregate: { type: a.dealId ? 'deal' : 'lead', id: a.dealId ?? a.leadId },
          payload: { activityId: a.id, ownerId: a.ownerId!, dueAt: a.dueAt!.toISOString() },
        });
      }
      result.followUpsDue += due.length;

      const stale = await tx
        .update(deals)
        .set({ staleNotifiedAt: now })
        .where(
          and(
            eq(deals.organizationId, org.id),
            eq(deals.status, 'open'),
            sql`${deals.lastActivityAt} < ${staleBefore}::timestamptz`,
            or(isNull(deals.staleNotifiedAt), sql`${deals.staleNotifiedAt} < ${deals.lastActivityAt}`),
          ),
        )
        .returning({ id: deals.id, ownerId: deals.ownerId, lastActivityAt: deals.lastActivityAt });
      for (const d of stale) {
        await emitEvent(tx, {
          type: 'deal.stale',
          organizationId: org.id,
          actorId: null,
          aggregate: { type: 'deal', id: d.id },
          payload: { dealId: d.id, ownerId: d.ownerId, days: Math.floor((now.getTime() - d.lastActivityAt.getTime()) / 86_400_000) },
        });
      }
      result.staleDeals += stale.length;
    });
  }
  return result;
}
