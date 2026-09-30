/**
 * Who may change which task fields (FR1.4 / ADR-084) — the UI mirror of `app.task_edit_scope()`, which the database
 * enforces. `full`: every field; `limited`: status and checklist (tasks assigned to you); `none`: read-only.
 */
export type TaskAccess = 'full' | 'limited' | 'none';

export type TaskEditContext = {
  me: string;
  canUpdate: boolean;
  editAll: boolean;
  managedClientIds: string[];
  ledDepartmentIds: string[];
};

export const noTaskEdit: TaskEditContext = { me: '', canUpdate: false, editAll: false, managedClientIds: [], ledDepartmentIds: [] };

export function taskAccess(
  task: { clientId: string; departmentId: string | null; assignees: { id: string }[] },
  c: TaskEditContext,
): TaskAccess {
  if (!c.canUpdate) return 'none';
  if (c.editAll) return 'full';
  if (c.managedClientIds.includes(task.clientId)) return 'full';
  if (task.departmentId && c.ledDepartmentIds.includes(task.departmentId)) return 'full';
  if (task.assignees.some((a) => a.id === c.me)) return 'limited';
  return 'none';
}
