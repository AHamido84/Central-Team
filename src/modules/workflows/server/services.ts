import 'server-only';

import { eq } from 'drizzle-orm';

import { ActionFailure } from '@/lib/actions/errors';
import type { AgencyContext } from '@/lib/auth/context';
import type { Tx } from '@/lib/db/client';
import { requests, workflowTemplates } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { isLocale } from '@/lib/i18n/localized';
import { dayInZone } from '@/modules/tasks/constants';
import { generateWorkflow } from '@/modules/workflows/generate';

/**
 * "Convert to tasks" (ADR-037) in the caller's RLS transaction: accept the request if needed, generate the workflow's
 * tasks and deliverables, start the request. Shared by triage and the won-deal conversion (onboarding).
 */
export async function convertRequest(
  tx: Tx,
  ctx: AgencyContext,
  input: { requestId: string; templateId: string; startDate?: string | null },
): Promise<{ requestId: string; taskIds: string[]; deliverableIds: string[] }> {
  if (!ctx.flags['module.tasks']) throw new ActionFailure('forbidden');
  const [request] = await tx.select().from(requests).where(eq(requests.id, input.requestId));
  if (!request) throw new ActionFailure('not_found');
  if (request.convertedAt) throw new ActionFailure('already_converted');
  if (!['submitted', 'under_review', 'accepted'].includes(request.status)) throw new ActionFailure('invalid_transition');
  const [template] = await tx
    .select({ id: workflowTemplates.id, isActive: workflowTemplates.isActive })
    .from(workflowTemplates)
    .where(eq(workflowTemplates.id, input.templateId));
  if (!template?.isActive) throw new ActionFailure('not_found');

  // Accept first when needed (consumes the package item), then start work — each a normal, audited transition.
  const path = request.status === 'accepted' ? ['in_progress'] : ['accepted', 'in_progress'];
  let from = request.status;
  for (const to of path) {
    const [row] = await tx.update(requests).set({ status: to }).where(eq(requests.id, request.id)).returning({ id: requests.id });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'request.status_changed',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request', id: request.id },
      clientId: request.clientId,
      payload: { requestId: request.id, clientId: request.clientId, from, to, reason: null },
    });
    from = to;
  }

  const locale = isLocale(ctx.organization.defaultLocale) ? ctx.organization.defaultLocale : 'ar';
  let generated;
  try {
    generated = await generateWorkflow(tx, {
      organizationId: ctx.organization.id,
      locale,
      request: { id: request.id, clientId: request.clientId, title: request.title, priority: request.priority },
      templateId: template.id,
      start: input.startDate ?? dayInZone(new Date(), ctx.organization.defaultTimezone),
      createdBy: ctx.session.userId,
    });
  } catch (error) {
    const message = (error as Error).message;
    if (message === 'workflow_empty' || message === 'dependency_cycle') throw new ActionFailure(message);
    throw error;
  }
  await tx.update(requests).set({ convertedAt: new Date() }).where(eq(requests.id, request.id));

  await emitEvent(tx, {
    type: 'request.converted',
    organizationId: ctx.organization.id,
    actorId: ctx.session.userId,
    aggregate: { type: 'request', id: request.id },
    clientId: request.clientId,
    payload: { requestId: request.id, clientId: request.clientId, templateId: template.id, taskIds: generated.taskIds },
  });
  for (const a of generated.assignments) {
    await emitEvent(tx, {
      type: 'task.assigned',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'task', id: a.taskId },
      clientId: request.clientId,
      payload: { taskId: a.taskId, clientId: request.clientId, userIds: a.userIds },
    });
  }
  return { requestId: request.id, taskIds: generated.taskIds, deliverableIds: generated.deliverableIds };
}
