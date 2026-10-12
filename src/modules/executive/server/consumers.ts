import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { executiveNotes, organizationMembers, profiles, taskMembers, taskStatuses, tasks } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { defineConsumer } from '@/lib/events/dispatcher';
import { isLocale } from '@/lib/i18n/localized';
import { viewSearch } from '@/modules/executive/config';
import { executiveKit } from '@/modules/executive/kit';
import { notify } from '@/modules/notifications/server/notify';

/**
 * A note on a KPI (FR7) → its owner: an in-app notification (and email, per their preferences), or a task assigned to
 * them on the chosen client. Executives can't create tasks themselves (read-only roles), so the task is the consumer's
 * service-path write, made only for an active agency member and only once per note (idempotent on `task_id`).
 */
export const executiveNotesConsumer = defineConsumer({
  name: 'executive.notes',
  types: ['executive.note_added'],
  async handle(event) {
    const { noteId, ownerId, task } = event.payload;
    if (!ownerId) return;
    const [row] = await dbAdmin
      .select({ note: executiveNotes, locale: profiles.locale, author: profiles.fullName })
      .from(executiveNotes)
      .leftJoin(profiles, eq(profiles.id, executiveNotes.authorId))
      .where(eq(executiveNotes.id, noteId));
    if (!row) return;
    const [owner] = await dbAdmin
      .select({ locale: profiles.locale })
      .from(organizationMembers)
      .innerJoin(profiles, eq(profiles.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.userId, ownerId),
          eq(organizationMembers.organizationId, event.organizationId),
          eq(organizationMembers.userType, 'agency'),
          eq(organizationMembers.status, 'active'),
          isNull(organizationMembers.deletedAt),
        ),
      );
    if (!owner) return;
    const kit = executiveKit(isLocale(owner.locale) ? owner.locale : 'ar');
    const kpi = kit.t(`kpi.${row.note.kpi}.name`);
    const link = `/executive${viewSearch(row.note.context)}`;

    if (task && !row.note.taskId) {
      const [status] = await dbAdmin
        .select({ id: taskStatuses.id })
        .from(taskStatuses)
        .where(and(eq(taskStatuses.organizationId, event.organizationId), eq(taskStatuses.isDefault, true)));
      if (status) {
        await dbAdmin.transaction(async (tx) => {
          // Claim the note first: a retried delivery finds task_id set and creates nothing.
          const id = crypto.randomUUID();
          const [claimed] = await tx
            .update(executiveNotes)
            .set({ taskId: id })
            .where(and(eq(executiveNotes.id, noteId), isNull(executiveNotes.taskId)))
            .returning({ id: executiveNotes.id });
          if (!claimed) return;
          await tx.insert(tasks).values({
            id,
            organizationId: event.organizationId,
            clientId: task.clientId,
            title: kit.t('notes.taskTitle', { kpi }).slice(0, 200),
            description: `${row.note.body}\n\n${link}`,
            statusId: status.id,
            dueDate: task.dueDate,
            createdBy: event.actorId,
          });
          await tx
            .insert(taskMembers)
            .values({ taskId: id, userId: ownerId, role: 'assignee', organizationId: event.organizationId, clientId: task.clientId })
            .onConflictDoNothing();
          await emitEvent(tx, {
            type: 'task.created',
            organizationId: event.organizationId,
            actorId: event.actorId,
            aggregate: { type: 'task', id },
            clientId: task.clientId,
            payload: { taskId: id, clientId: task.clientId, parentId: null },
          });
          await emitEvent(tx, {
            type: 'task.assigned',
            organizationId: event.organizationId,
            actorId: event.actorId,
            aggregate: { type: 'task', id },
            clientId: task.clientId,
            payload: { taskId: id, clientId: task.clientId, userIds: [ownerId] },
          });
        });
      }
    }

    await notify({
      organizationId: event.organizationId,
      actorId: event.actorId,
      eventId: event.id,
      userIds: [ownerId],
      type: 'executive_note',
      params: { actor: row.author ?? '', kpi, body: row.note.body.slice(0, 280) },
      link,
      clientId: null,
    });
  },
});
