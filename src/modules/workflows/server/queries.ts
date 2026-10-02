import 'server-only';

import { asc, eq, sql } from 'drizzle-orm';

import { withRls } from '@/lib/db/rls';
import { requestTypes, taskStatuses, workflowTemplateSteps, workflowTemplates } from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import type { TypeIcon } from '@/modules/requests/constants';
import type { StatusCategory, StatusColor } from '@/modules/tasks/constants';
import type { AssigneeMode, DeliverableType } from '@/modules/workflows/constants';

export type TemplateSummary = {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  requestTypeId: string | null;
  requestTypeName: LocalizedText | null;
  requestTypeIcon: TypeIcon | null;
  isActive: boolean;
  isDefault: boolean;
  stepCount: number;
  totalDays: number;
  updatedAt: string;
};

export type TemplateStep = {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  departmentId: string | null;
  assigneeMode: AssigneeMode;
  assigneeRoleId: string | null;
  assigneeUserId: string | null;
  slaDays: number;
  dependsOn: string[];
  requiresInternalReview: boolean;
  requiresClientApproval: boolean;
  deliverableType: DeliverableType | null;
  sortOrder: number;
};

export type TemplateDetail = TemplateSummary & { steps: TemplateStep[] };

export type TaskStatusItem = {
  id: string;
  key: string;
  name: LocalizedText;
  category: StatusCategory;
  color: StatusColor;
  sortOrder: number;
  isDefault: boolean;
  taskCount: number;
};

export async function listWorkflowTemplates(): Promise<TemplateSummary[]> {
  return withRls(async (tx) => {
    const rows = await tx
      .select({
        t: workflowTemplates,
        typeName: requestTypes.name,
        typeIcon: requestTypes.icon,
        stepCount: sql<number>`(select count(*)::int from public.workflow_template_steps s where s.template_id = workflow_templates.id)`,
        totalDays: sql<number>`(select coalesce(sum(s.sla_days), 0)::int from public.workflow_template_steps s where s.template_id = workflow_templates.id)`,
      })
      .from(workflowTemplates)
      .leftJoin(requestTypes, eq(requestTypes.id, workflowTemplates.requestTypeId))
      .orderBy(asc(requestTypes.sortOrder), asc(workflowTemplates.createdAt));
    return rows.map((r) => ({
      id: r.t.id,
      name: r.t.name,
      description: r.t.description,
      requestTypeId: r.t.requestTypeId,
      requestTypeName: r.typeName,
      requestTypeIcon: (r.typeIcon as TypeIcon | null) ?? null,
      isActive: r.t.isActive,
      isDefault: r.t.isDefault,
      stepCount: r.stepCount,
      totalDays: r.totalDays,
      updatedAt: r.t.updatedAt.toISOString(),
    }));
  });
}

export async function getWorkflowTemplate(templateId: string): Promise<TemplateDetail | null> {
  const all = await listWorkflowTemplates();
  const summary = all.find((t) => t.id === templateId);
  if (!summary) return null;
  const steps = await withRls((tx) =>
    tx
      .select()
      .from(workflowTemplateSteps)
      .where(eq(workflowTemplateSteps.templateId, templateId))
      .orderBy(asc(workflowTemplateSteps.sortOrder)),
  );
  return {
    ...summary,
    steps: steps.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      departmentId: s.departmentId,
      assigneeMode: s.assigneeMode as AssigneeMode,
      assigneeRoleId: s.assigneeRoleId,
      assigneeUserId: s.assigneeUserId,
      slaDays: s.slaDays,
      dependsOn: s.dependsOn,
      requiresInternalReview: s.requiresInternalReview,
      requiresClientApproval: s.requiresClientApproval,
      deliverableType: s.deliverableType as DeliverableType | null,
      sortOrder: s.sortOrder,
    })),
  };
}

/** Active templates for "Convert to tasks", the request type's default first. */
export async function templatesForRequestType(requestTypeId: string): Promise<TemplateDetail[]> {
  const all = await listWorkflowTemplates();
  const candidates = all
    .filter((t) => t.isActive && (t.requestTypeId === requestTypeId || t.requestTypeId === null))
    .sort((a, b) => Number(b.requestTypeId === requestTypeId && b.isDefault) - Number(a.requestTypeId === requestTypeId && a.isDefault));
  const out: TemplateDetail[] = [];
  for (const c of candidates) {
    const detail = await getWorkflowTemplate(c.id);
    if (detail && detail.steps.length) out.push(detail);
  }
  return out;
}

export async function listTaskStatuses(): Promise<TaskStatusItem[]> {
  return withRls(async (tx) => {
    const rows = await tx
      .select({
        s: taskStatuses,
        taskCount: sql<number>`(select count(*)::int from public.tasks t where t.status_id = task_statuses.id)`,
      })
      .from(taskStatuses)
      .orderBy(asc(taskStatuses.sortOrder), asc(taskStatuses.createdAt));
    return rows.map((r) => ({
      id: r.s.id,
      key: r.s.key,
      name: r.s.name,
      category: r.s.category as StatusCategory,
      color: r.s.color as StatusColor,
      sortOrder: r.s.sortOrder,
      isDefault: r.s.isDefault,
      taskCount: r.taskCount,
    }));
  });
}

export type ProgressStep = { order: number; name: LocalizedText; state: 'done' | 'active' | 'review' | 'pending'; dueDate: string | null };

/** The request's workflow steps and their state — step names only, safe for the portal (`app.request_progress`). */
export async function getRequestProgress(requestId: string): Promise<ProgressStep[]> {
  const rows = await withRls((tx) =>
    tx.execute<{ step_order: number; name: LocalizedText; state: ProgressStep['state']; due_date: string | null }>(
      sql`select step_order, name, state, due_date::text from app.request_progress(${requestId})`,
    ),
  );
  return [...rows].map((r) => ({ order: r.step_order, name: r.name, state: r.state, dueDate: r.due_date }));
}
