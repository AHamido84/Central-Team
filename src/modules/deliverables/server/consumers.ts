import 'server-only';

import { and, eq } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { approvals, clientUsers, clients, deliverables, profiles, taskMembers, tasks } from '@/lib/db/schema';
import { defineConsumer } from '@/lib/events/dispatcher';
import { localized } from '@/lib/i18n/localized';
import { preview } from '@/modules/messaging/mentions';
import { notify } from '@/modules/notifications/server/notify';

async function load(deliverableId: string, actorId: string | null) {
  const [d] = await dbAdmin.select().from(deliverables).where(eq(deliverables.id, deliverableId));
  if (!d) return null;
  const [client] = await dbAdmin.select().from(clients).where(eq(clients.id, d.clientId));
  const [actor] = actorId ? await dbAdmin.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, actorId)) : [];
  const [task] = d.taskId ? await dbAdmin.select({ reviewerId: tasks.reviewerId }).from(tasks).where(eq(tasks.id, d.taskId)) : [];
  const assignees = d.taskId
    ? (
        await dbAdmin
          .select({ userId: taskMembers.userId })
          .from(taskMembers)
          .where(and(eq(taskMembers.taskId, d.taskId), eq(taskMembers.role, 'assignee')))
      ).map((a) => a.userId)
    : [];
  // Client approvers: active portal users with approval rights (Phase 1 `can_approve`).
  const approvers = (
    await dbAdmin
      .select({ userId: clientUsers.userId })
      .from(clientUsers)
      .where(and(eq(clientUsers.clientId, d.clientId), eq(clientUsers.status, 'active'), eq(clientUsers.canApprove, true)))
  ).map((u) => u.userId);
  const am = client?.accountManagerId ?? null;
  return {
    d,
    am,
    reviewer: task?.reviewerId ?? am,
    assignees,
    approvers,
    params: {
      actor: actor?.name ?? '',
      client: client ? localized(client.name, 'ar') || localized(client.name, 'en') : '',
      title: d.title,
    },
    agencyLink: `/deliverables/${d.id}`,
    portalLink: `/portal/approvals/${d.id}`,
  };
}

/**
 * Review & approval → notifications (ADR-028): ready for internal review → reviewer; ready for client approval →
 * client approvers; decisions → the task's assignees (and the account manager for client decisions); reminders →
 * client approvers.
 */
export const deliverableNotifications = defineConsumer({
  name: 'notifications.deliverables',
  types: ['deliverable.submitted', 'deliverable.decided', 'deliverable.approval_reminder'],
  async handle(event) {
    const ctx = await load(event.payload.deliverableId, event.actorId);
    if (!ctx) return;
    const base = { organizationId: event.organizationId, actorId: event.actorId, eventId: event.id };
    const toClient = () =>
      notify({ ...base, userIds: ctx.approvers, type: 'approval_requested', params: ctx.params, link: ctx.portalLink });

    switch (event.type) {
      case 'deliverable.submitted':
        if (event.payload.status === 'internal_review' && ctx.reviewer) {
          await notify({ ...base, userIds: [ctx.reviewer], type: 'review_requested', params: ctx.params, link: ctx.agencyLink });
        }
        if (event.payload.status === 'client_review') await toClient();
        return;
      case 'deliverable.approval_reminder':
        await notify({
          ...base,
          userIds: ctx.approvers,
          type: 'approval_reminder',
          params: { ...ctx.params, days: event.payload.days },
          link: ctx.portalLink,
        });
        return;
      case 'deliverable.decided': {
        const { stage, decision, approvalId, status } = event.payload;
        const [approval] = await dbAdmin.select({ comment: approvals.comment }).from(approvals).where(eq(approvals.id, approvalId));
        const quote = approval?.comment ? preview(approval.comment, 600) : undefined;
        const team = stage === 'client' ? [...new Set([...ctx.assignees, ...(ctx.am ? [ctx.am] : [])])] : ctx.assignees;
        const params = { ...ctx.params, stage };
        await notify({
          ...base,
          userIds: team,
          type: decision === 'approved' ? 'deliverable_approved' : 'deliverable_changes_requested',
          params,
          quote,
          link: ctx.agencyLink,
        });
        if (stage === 'internal' && status === 'client_review') await toClient();
        return;
      }
    }
  },
});
