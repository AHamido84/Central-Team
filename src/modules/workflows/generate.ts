import { and, asc, eq, inArray, sql } from 'drizzle-orm';

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
import { taskPriorities, type TaskPriority } from '@/modules/tasks/constants';
import { scheduleSteps, type DeliverableType } from '@/modules/workflows/constants';
import { orderPlan, type PlanItem } from '@/modules/workflows/plan';

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
 * The plan a workflow template proposes for a request (FR1.3): one item per step with its assignee, reviewer,
 * department, priority and scheduled dates. Nothing is written — the review screen edits it before `createFromPlan`.
 */
export async function planFromTemplate(tx: Tx, input: Omit<GenerateInput, 'createdBy'>): Promise<PlanItem[]> {
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
  const reviewer = client?.am ?? null;
  const priority = (taskPriorities as readonly string[]).includes(input.request.priority)
    ? (input.request.priority as TaskPriority)
    : 'normal';

  return steps.map((s) => ({
    key: s.id,
    stepId: s.id,
    title: `${localized(s.name, input.locale)} · ${input.request.title}`.slice(0, 200),
    departmentId: s.departmentId,
    assigneeId: assigneeFor(s),
    reviewerId: s.requiresInternalReview ? reviewer : null,
    priority,
    durationDays: s.slaDays,
    startDate: schedule.get(s.id)!.startDate,
    dueDate: schedule.get(s.id)!.dueDate,
    manualDates: false,
    dependsOn: s.dependsOn,
    deliverableType: (s.deliverableType as DeliverableType | null) ?? null,
    requiresInternalReview: s.requiresInternalReview,
    requiresClientApproval: s.requiresClientApproval,
  }));
}

/**
 * Creates a request's tasks exactly as planned — order, names, people, dates, dependencies — plus a deliverable for
 * items that produce one. Items without a `stepId` are "outside the workflow". Runs in the caller's transaction (RLS
 * for users; the database checks assignees, departments and the dependency graph again).
 */
export async function createFromPlan(
  tx: Tx,
  input: {
    organizationId: string;
    request: { id: string; clientId: string; title: string };
    templateId: string | null;
    items: PlanItem[];
    createdBy: string | null;
    locale: Locale;
  },
): Promise<GeneratedWorkflow> {
  if (!orderPlan(input.items)) throw new Error('dependency_cycle');
  const [todo] = await tx
    .select({ id: taskStatuses.id })
    .from(taskStatuses)
    .where(and(eq(taskStatuses.organizationId, input.organizationId), eq(taskStatuses.isDefault, true)));
  if (!todo) throw new Error('no_default_status');
  const [maxOrder] = await tx
    .select({ n: sql<number>`coalesce(max(${tasks.stepOrder}), 0)::int` })
    .from(tasks)
    .where(eq(tasks.requestId, input.request.id));
  const offset = maxOrder?.n ?? 0;

  const idFor = new Map(input.items.map((i) => [i.key, crypto.randomUUID()]));
  await tx.insert(tasks).values(
    input.items.map((item, i) => ({
      id: idFor.get(item.key)!,
      organizationId: input.organizationId,
      clientId: input.request.clientId,
      requestId: input.request.id,
      workflowTemplateId: item.stepId ? input.templateId : null,
      workflowStepId: item.stepId,
      title: item.title,
      departmentId: item.departmentId,
      statusId: todo.id,
      priority: item.priority,
      startDate: item.startDate,
      dueDate: item.dueDate,
      reviewerId: item.reviewerId,
      stepOrder: offset + i + 1,
      position: offset + i + 1,
      requiresInternalReview: item.requiresInternalReview,
      requiresClientApproval: item.requiresClientApproval,
      createdBy: input.createdBy,
    })),
  );

  const assignments = input.items.filter((i) => i.assigneeId).map((i) => ({ taskId: idFor.get(i.key)!, userIds: [i.assigneeId!] }));
  if (assignments.length) {
    await tx.insert(taskMembers).values(
      assignments.map((a) => ({
        taskId: a.taskId,
        userId: a.userIds[0]!,
        role: 'assignee',
        organizationId: input.organizationId,
        clientId: input.request.clientId,
      })),
    );
  }

  const deps = input.items.flatMap((item) =>
    item.dependsOn.map((d) => ({
      taskId: idFor.get(item.key)!,
      dependsOnId: idFor.get(d)!,
      organizationId: input.organizationId,
      clientId: input.request.clientId,
    })),
  );
  if (deps.length) await tx.insert(taskDependencies).values(deps);

  const producing = input.items.filter((i) => i.deliverableType);
  const deliverableIds: string[] = [];
  if (producing.length) {
    const rows = await tx
      .insert(deliverables)
      .values(
        producing.map((item) => ({
          organizationId: input.organizationId,
          clientId: input.request.clientId,
          requestId: input.request.id,
          taskId: idFor.get(item.key)!,
          type: item.deliverableType!,
          title: (producing.length > 1 ? item.title : input.request.title).slice(0, 200),
          requiresInternalReview: item.requiresInternalReview,
          requiresClientApproval: item.requiresClientApproval,
          createdBy: input.createdBy,
        })),
      )
      .returning({ id: deliverables.id });
    deliverableIds.push(...rows.map((r) => r.id));
  }

  return { taskIds: input.items.map((i) => idFor.get(i.key)!), deliverableIds, assignments };
}

/** Template → tasks without a review (won-deal onboarding): the template's plan, created as proposed. */
export async function generateWorkflow(tx: Tx, input: GenerateInput): Promise<GeneratedWorkflow> {
  const items = await planFromTemplate(tx, input);
  return createFromPlan(tx, {
    organizationId: input.organizationId,
    request: input.request,
    templateId: input.templateId,
    items,
    createdBy: input.createdBy,
    locale: input.locale,
  });
}

/** Assignee ids per task, for notifications after bulk inserts. */
export async function assigneesOf(tx: Tx, taskIds: string[]) {
  if (!taskIds.length) return [];
  return tx
    .select({ taskId: taskMembers.taskId, userId: taskMembers.userId })
    .from(taskMembers)
    .where(and(inArray(taskMembers.taskId, taskIds), eq(taskMembers.role, 'assignee')));
}
