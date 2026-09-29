import { and, asc, eq, inArray } from 'drizzle-orm';

import type { Tx } from '@/lib/db/client';
import {
  clientAssignments,
  clients,
  deliverables,
  departmentMembers,
  taskDependencies,
  taskMembers,
  taskStatuses,
  tasks,
  userRoles,
  workflowTemplateSteps,
} from '@/lib/db/schema';
import { localized, type Locale } from '@/lib/i18n/localized';
import { scheduleSteps } from '@/modules/workflows/constants';

export type GenerateInput = {
  organizationId: string;
  locale: Locale;
  request: { id: string; clientId: string; title: string; priority: string };
  templateId: string;
  /** YYYY-MM-DD, first working day of the workflow. */
  start: string;
  createdBy: string | null;
};

export type GeneratedWorkflow = {
  taskIds: string[];
  deliverableIds: string[];
  /** Task id → assignee ids (for "task assigned" notifications). */
  assignments: { taskId: string; userIds: string[] }[];
};

/**
 * Turns a workflow template into the request's task chain: one task per step (dependencies, assignee, reviewer,
 * due dates) plus a deliverable for steps that produce one. Runs in the caller's transaction (RLS-scoped for users).
 */
export async function generateWorkflow(tx: Tx, input: GenerateInput): Promise<GeneratedWorkflow> {
  const steps = await tx
    .select()
    .from(workflowTemplateSteps)
    .where(eq(workflowTemplateSteps.templateId, input.templateId))
    .orderBy(asc(workflowTemplateSteps.sortOrder));
  if (steps.length === 0) throw new Error('workflow_empty');
  const schedule = scheduleSteps(steps, input.start);
  if (!schedule) throw new Error('dependency_cycle');

  const [client] = await tx.select({ am: clients.accountManagerId }).from(clients).where(eq(clients.id, input.request.clientId));
  const team = await tx
    .select({ userId: clientAssignments.userId, roleId: userRoles.roleId })
    .from(clientAssignments)
    .leftJoin(userRoles, and(eq(userRoles.userId, clientAssignments.userId), eq(userRoles.organizationId, input.organizationId)))
    .where(eq(clientAssignments.clientId, input.request.clientId));
  const inDepartment = await tx
    .select({ userId: departmentMembers.userId, departmentId: departmentMembers.departmentId })
    .from(departmentMembers)
    .where(eq(departmentMembers.organizationId, input.organizationId));
  const [todo] = await tx
    .select({ id: taskStatuses.id })
    .from(taskStatuses)
    .where(and(eq(taskStatuses.organizationId, input.organizationId), eq(taskStatuses.isDefault, true)));
  if (!todo) throw new Error('no_default_status');

  const assigneeFor = (s: (typeof steps)[number]): string | null => {
    switch (s.assigneeMode) {
      case 'account_manager':
        return client?.am ?? null;
      case 'user':
        return s.assigneeUserId;
      case 'role': {
        // A client-team member with the role, preferring one in the step's department.
        const withRole = team.filter((m) => m.roleId === s.assigneeRoleId);
        const inDept = withRole.find((m) => inDepartment.some((d) => d.userId === m.userId && d.departmentId === s.departmentId));
        return (inDept ?? withRole[0])?.userId ?? null;
      }
      default:
        return null;
    }
  };

  const idFor = new Map(steps.map((s) => [s.id, crypto.randomUUID()]));
  const title = (s: (typeof steps)[number]) => `${localized(s.name, input.locale)} · ${input.request.title}`.slice(0, 200);
  const reviewer = client?.am ?? null;

  await tx.insert(tasks).values(
    steps.map((s, i) => ({
      id: idFor.get(s.id)!,
      organizationId: input.organizationId,
      clientId: input.request.clientId,
      requestId: input.request.id,
      workflowTemplateId: input.templateId,
      workflowStepId: s.id,
      title: title(s),
      description: localized(s.description, input.locale),
      departmentId: s.departmentId,
      statusId: todo.id,
      priority: input.request.priority,
      startDate: schedule.get(s.id)!.startDate,
      dueDate: schedule.get(s.id)!.dueDate,
      reviewerId: s.requiresInternalReview ? reviewer : null,
      stepOrder: i + 1,
      position: i + 1,
      requiresInternalReview: s.requiresInternalReview,
      requiresClientApproval: s.requiresClientApproval,
      createdBy: input.createdBy,
    })),
  );

  const assignments = steps
    .map((s) => ({ taskId: idFor.get(s.id)!, userIds: [assigneeFor(s)].filter(Boolean) as string[] }))
    .filter((a) => a.userIds.length > 0);
  if (assignments.length) {
    await tx.insert(taskMembers).values(
      assignments.flatMap((a) =>
        a.userIds.map((userId) => ({
          taskId: a.taskId,
          userId,
          role: 'assignee',
          organizationId: input.organizationId,
          clientId: input.request.clientId,
        })),
      ),
    );
  }

  const deps = steps.flatMap((s) =>
    s.dependsOn.map((d) => ({
      taskId: idFor.get(s.id)!,
      dependsOnId: idFor.get(d)!,
      organizationId: input.organizationId,
      clientId: input.request.clientId,
    })),
  );
  if (deps.length) await tx.insert(taskDependencies).values(deps);

  const producing = steps.filter((s) => s.deliverableType);
  const deliverableIds: string[] = [];
  if (producing.length) {
    const rows = await tx
      .insert(deliverables)
      .values(
        producing.map((s) => ({
          organizationId: input.organizationId,
          clientId: input.request.clientId,
          requestId: input.request.id,
          taskId: idFor.get(s.id)!,
          type: s.deliverableType!,
          title: (producing.length > 1 ? `${input.request.title} · ${localized(s.name, input.locale)}` : input.request.title).slice(0, 200),
          requiresInternalReview: s.requiresInternalReview,
          requiresClientApproval: s.requiresClientApproval,
          createdBy: input.createdBy,
        })),
      )
      .returning({ id: deliverables.id });
    deliverableIds.push(...rows.map((r) => r.id));
  }

  return { taskIds: steps.map((s) => idFor.get(s.id)!), deliverableIds, assignments };
}

/** Assignee ids per task, for notifications after bulk inserts. */
export async function assigneesOf(tx: Tx, taskIds: string[]) {
  if (!taskIds.length) return [];
  return tx
    .select({ taskId: taskMembers.taskId, userId: taskMembers.userId })
    .from(taskMembers)
    .where(and(inArray(taskMembers.taskId, taskIds), eq(taskMembers.role, 'assignee')));
}
