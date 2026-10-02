import 'server-only';

import { and, eq, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { deliverableVersions, deliverables, organizations, tasks } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { addDays, dayInZone } from '@/modules/tasks/constants';
import { liveClient } from '@/lib/db/live';

export type SweepResult = { dueSoon: number; overdue: number; approvalReminders: number };

/**
 * Time-based reminders: "due soon" (due today or tomorrow) and "overdue" once per due date per task, and a
 * "waiting for your approval" reminder every N days (organization setting) while a deliverable waits on the client.
 * Runs from the cron route with the service connection (listed service path, CLAUDE.md §6): it scans every
 * organization and only writes reminder markers + domain events; notifications come from the event consumers.
 */
export async function runReminderSweep(now = new Date()): Promise<SweepResult> {
  const result: SweepResult = { dueSoon: 0, overdue: 0, approvalReminders: 0 };
  const orgs = await dbAdmin
    .select({ id: organizations.id, tz: organizations.defaultTimezone, days: organizations.approvalReminderDays })
    .from(organizations);
  for (const org of orgs) {
    const today = dayInZone(now, org.tz);
    const tomorrow = addDays(today, 1);
    await dbAdmin.transaction(async (tx) => {
      const dueSoon = await tx
        .update(tasks)
        .set({ dueSoonNotifiedFor: sql`${tasks.dueDate}` })
        .where(
          and(
            eq(tasks.organizationId, org.id),
            ne(tasks.statusCategory, 'done'),
            isNull(tasks.deletedAt),
            liveClient(tasks.clientId),
            isNotNull(tasks.dueDate),
            sql`${tasks.dueDate} between ${today}::date and ${tomorrow}::date`,
            or(isNull(tasks.dueSoonNotifiedFor), sql`${tasks.dueSoonNotifiedFor} <> ${tasks.dueDate}`),
          ),
        )
        .returning({ id: tasks.id, clientId: tasks.clientId, dueDate: tasks.dueDate });
      for (const t of dueSoon) {
        await emitEvent(tx, {
          type: 'task.due_soon',
          organizationId: org.id,
          actorId: null,
          aggregate: { type: 'task', id: t.id },
          clientId: t.clientId,
          payload: { taskId: t.id, clientId: t.clientId, dueDate: t.dueDate! },
        });
      }
      const overdue = await tx
        .update(tasks)
        .set({ overdueNotifiedFor: sql`${tasks.dueDate}` })
        .where(
          and(
            eq(tasks.organizationId, org.id),
            ne(tasks.statusCategory, 'done'),
            isNull(tasks.deletedAt),
            liveClient(tasks.clientId),
            lt(tasks.dueDate, today),
            or(isNull(tasks.overdueNotifiedFor), sql`${tasks.overdueNotifiedFor} <> ${tasks.dueDate}`),
          ),
        )
        .returning({ id: tasks.id, clientId: tasks.clientId, dueDate: tasks.dueDate });
      for (const t of overdue) {
        await emitEvent(tx, {
          type: 'task.overdue',
          organizationId: org.id,
          actorId: null,
          aggregate: { type: 'task', id: t.id },
          clientId: t.clientId,
          payload: { taskId: t.id, clientId: t.clientId, dueDate: t.dueDate! },
        });
      }

      const cutoff = new Date(now.getTime() - org.days * 24 * 60 * 60 * 1000);
      const waiting = await tx
        .select({ id: deliverables.id, clientId: deliverables.clientId, versionId: deliverableVersions.id })
        .from(deliverables)
        .innerJoin(deliverableVersions, eq(deliverableVersions.id, deliverables.currentVersionId))
        .where(
          and(
            eq(deliverables.organizationId, org.id),
            eq(deliverables.status, 'client_review'),
            isNull(deliverables.deletedAt),
            liveClient(deliverables.clientId),
            lte(deliverableVersions.sentToClientAt, cutoff),
            or(isNull(deliverables.remindedAt), lte(deliverables.remindedAt, cutoff)),
          ),
        );
      for (const d of waiting) {
        await tx.update(deliverables).set({ remindedAt: now }).where(eq(deliverables.id, d.id));
        await emitEvent(tx, {
          type: 'deliverable.approval_reminder',
          organizationId: org.id,
          actorId: null,
          aggregate: { type: 'deliverable', id: d.id },
          clientId: d.clientId,
          payload: { deliverableId: d.id, clientId: d.clientId, versionId: d.versionId, days: org.days },
        });
      }
      result.dueSoon += dueSoon.length;
      result.overdue += overdue.length;
      result.approvalReminders += waiting.length;
    });
  }
  return result;
}
