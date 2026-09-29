import 'server-only';

import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { withRls } from '@/lib/db/rls';
import {
  deliverables,
  files,
  profiles,
  savedViews,
  taskAttachments,
  taskChecklistItems,
  taskDependencies,
  taskMembers,
  tasks,
  threads,
  timeEntries,
  workflowTemplateSteps,
} from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import type { DeliverableStatus } from '@/modules/deliverables/constants';
import { toFileItem, withThumbnails, type FileItem } from '@/modules/files/server/queries';
import { getThread, type ThreadDetail } from '@/modules/messaging/server/queries';
import type { SavedViewConfig, StatusCategory, TaskLayout, TaskPriority } from '@/modules/tasks/constants';
import type { DeliverableType } from '@/modules/workflows/constants';

export type Person = { id: string; name: string; avatarPath: string | null };

export type TaskListItem = {
  id: string;
  number: number;
  title: string;
  clientId: string;
  clientName: LocalizedText;
  clientLogo: string | null;
  requestId: string | null;
  requestReference: string | null;
  parentId: string | null;
  statusId: string;
  statusCategory: StatusCategory;
  priority: TaskPriority;
  startDate: string | null;
  dueDate: string | null;
  estimateMinutes: number | null;
  tags: string[];
  departmentId: string | null;
  reviewerId: string | null;
  position: number;
  assignees: Person[];
  subtasks: number;
  subtasksDone: number;
  checklist: number;
  checklistDone: number;
  comments: number;
  blocked: boolean;
  deliverable: { id: string; status: DeliverableStatus } | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type Row = {
  id: string;
  number: number;
  title: string;
  client_id: string;
  client_name: LocalizedText;
  client_logo: string | null;
  request_id: string | null;
  reference: string | null;
  parent_id: string | null;
  status_id: string;
  status_category: StatusCategory;
  priority: TaskPriority;
  start_date: string | null;
  due_date: string | null;
  estimate_minutes: number | null;
  tags: string[];
  department_id: string | null;
  reviewer_id: string | null;
  position: string | number;
  assignees: Person[];
  subtasks: number;
  subtasks_done: number;
  checklist: number;
  checklist_done: number;
  comments: number;
  blocked: boolean;
  deliverable: { id: string; status: DeliverableStatus } | null;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
};

const iso = (d: string | Date | null) => (d ? new Date(d).toISOString() : null);

function toItem(r: Row): TaskListItem {
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    clientId: r.client_id,
    clientName: r.client_name,
    clientLogo: r.client_logo,
    requestId: r.request_id,
    requestReference: r.reference,
    parentId: r.parent_id,
    statusId: r.status_id,
    statusCategory: r.status_category,
    priority: r.priority,
    startDate: r.start_date,
    dueDate: r.due_date,
    estimateMinutes: r.estimate_minutes,
    tags: r.tags ?? [],
    departmentId: r.department_id,
    reviewerId: r.reviewer_id,
    position: Number(r.position),
    assignees: r.assignees ?? [],
    subtasks: r.subtasks,
    subtasksDone: r.subtasks_done,
    checklist: r.checklist,
    checklistDone: r.checklist_done,
    comments: r.comments,
    blocked: r.blocked,
    deliverable: r.deliverable,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    completedAt: iso(r.completed_at),
  };
}

export type TaskScope = { clientId?: string; requestId?: string; ids?: string[]; parentId?: string; includeDoneDays?: number };

/**
 * Tasks for boards and lists, one round trip with light aggregates (RLS-scoped). Done tasks are limited to the
 * last `includeDoneDays` days so boards stay fast with hundreds of tasks.
 */
export async function listTasks(scope: TaskScope = {}): Promise<TaskListItem[]> {
  const doneDays = scope.includeDoneDays ?? 30;
  const rows = await withRls((tx) =>
    tx.execute<Row>(sql`
      select t.id, t.number, t.title, t.client_id, c.name as client_name, c.logo_path as client_logo,
        t.request_id, r.reference, t.parent_id, t.status_id, t.status_category, t.priority,
        t.start_date::text, t.due_date::text, t.estimate_minutes, t.tags, t.department_id, t.reviewer_id, t.position,
        coalesce((
          select json_agg(json_build_object('id', p.id, 'name', p.full_name, 'avatarPath', p.avatar_path) order by p.full_name)
          from public.task_members m join public.profiles p on p.id = m.user_id
          where m.task_id = t.id and m.role = 'assignee'
        ), '[]'::json) as assignees,
        (select count(*)::int from public.tasks s where s.parent_id = t.id) as subtasks,
        (select count(*)::int from public.tasks s where s.parent_id = t.id and s.status_category = 'done') as subtasks_done,
        (select count(*)::int from public.task_checklist_items i where i.task_id = t.id) as checklist,
        (select count(*)::int from public.task_checklist_items i where i.task_id = t.id and i.is_done) as checklist_done,
        (select count(*)::int from public.threads th join public.comments cm on cm.thread_id = th.id
          where th.subject_type = 'task' and th.subject_id = t.id and cm.deleted_at is null) as comments,
        exists (
          select 1 from public.task_dependencies d join public.tasks b on b.id = d.depends_on_id
          where d.task_id = t.id and b.status_category <> 'done'
        ) as blocked,
        (select json_build_object('id', dl.id, 'status', dl.status) from public.deliverables dl
          where dl.task_id = t.id order by dl.created_at limit 1) as deliverable,
        t.created_at, t.updated_at, t.completed_at
      from public.tasks t
      join public.clients c on c.id = t.client_id
      left join public.requests r on r.id = t.request_id
      where (t.status_category <> 'done' or t.completed_at > now() - make_interval(days => ${doneDays}))
        ${scope.clientId ? sql`and t.client_id = ${scope.clientId}` : sql``}
        ${scope.requestId ? sql`and t.request_id = ${scope.requestId}` : sql``}
        ${scope.parentId ? sql`and t.parent_id = ${scope.parentId}` : sql``}
        ${
          scope.ids
            ? sql`and t.id in (${sql.join(
                [...scope.ids, '00000000-0000-0000-0000-000000000000'].map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`
            : sql``
        }
      order by t.position, t.number
      limit 2000`),
  );
  return rows.map(toItem);
}

export type TimeEntryItem = {
  id: string;
  user: Person;
  startedAt: string;
  endedAt: string | null;
  minutes: number;
  note: string;
  source: 'timer' | 'manual';
};

export type TaskDetail = TaskListItem & {
  description: string;
  watchers: Person[];
  reviewer: Person | null;
  createdBy: Person | null;
  requestTitle: string | null;
  stepName: LocalizedText | null;
  requiresInternalReview: boolean;
  requiresClientApproval: boolean;
  blockedBy: { id: string; number: number; title: string; statusCategory: StatusCategory }[];
  blocking: { id: string; number: number; title: string; statusCategory: StatusCategory }[];
  checklistItems: { id: string; body: string; isDone: boolean; sortOrder: number }[];
  attachments: FileItem[];
  subtaskItems: TaskListItem[];
  deliverables: { id: string; title: string; type: DeliverableType; status: DeliverableStatus; versionCount: number }[];
  time: { entries: TimeEntryItem[]; totalMinutes: number; myMinutes: number; canSeeAll: boolean };
  thread: ThreadDetail | null;
};

export async function getTaskDetail(taskId: string, me: string, canSeeAllTime: boolean): Promise<TaskDetail | null> {
  const [item] = await listTasks({ ids: [taskId], includeDoneDays: 36500 });
  if (!item) return null;
  const detail = await withRls(async (tx) => {
    const [row] = await tx
      .select({ t: tasks, stepName: workflowTemplateSteps.name })
      .from(tasks)
      .leftJoin(workflowTemplateSteps, eq(workflowTemplateSteps.id, tasks.workflowStepId))
      .where(eq(tasks.id, taskId));
    if (!row) return null;
    const people = await tx
      .select({ userId: taskMembers.userId, role: taskMembers.role, name: profiles.fullName, avatarPath: profiles.avatarPath })
      .from(taskMembers)
      .innerJoin(profiles, eq(profiles.id, taskMembers.userId))
      .where(eq(taskMembers.taskId, taskId))
      .orderBy(asc(profiles.fullName));
    const personIds = [row.t.reviewerId, row.t.createdBy].filter(Boolean) as string[];
    const extra = personIds.length
      ? await tx
          .select({ id: profiles.id, name: profiles.fullName, avatarPath: profiles.avatarPath })
          .from(profiles)
          .where(inArray(profiles.id, personIds))
      : [];
    const personOf = (id: string | null) => {
      const p = extra.find((x) => x.id === id);
      return p ? { id: p.id, name: p.name, avatarPath: p.avatarPath } : null;
    };
    const blockedBy = await tx
      .select({ id: tasks.id, number: tasks.number, title: tasks.title, statusCategory: tasks.statusCategory })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnId))
      .where(eq(taskDependencies.taskId, taskId))
      .orderBy(asc(tasks.number));
    const blocking = await tx
      .select({ id: tasks.id, number: tasks.number, title: tasks.title, statusCategory: tasks.statusCategory })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
      .where(eq(taskDependencies.dependsOnId, taskId))
      .orderBy(asc(tasks.number));
    const checklistItems = await tx
      .select({
        id: taskChecklistItems.id,
        body: taskChecklistItems.body,
        isDone: taskChecklistItems.isDone,
        sortOrder: taskChecklistItems.sortOrder,
      })
      .from(taskChecklistItems)
      .where(eq(taskChecklistItems.taskId, taskId))
      .orderBy(asc(taskChecklistItems.sortOrder), asc(taskChecklistItems.createdAt));
    const attachmentRows = await tx
      .select({ file: files, uploaderName: profiles.fullName, uploaderAvatar: profiles.avatarPath })
      .from(taskAttachments)
      .innerJoin(files, eq(files.id, taskAttachments.fileId))
      .leftJoin(profiles, eq(profiles.id, files.uploadedBy))
      .where(and(eq(taskAttachments.taskId, taskId), isNull(files.deletedAt)))
      .orderBy(asc(taskAttachments.createdAt));
    const attachments = await withThumbnails(
      attachmentRows.map((a) => toFileItem(a.file, a.uploaderName, a.uploaderAvatar)),
      new Map(attachmentRows.map((a) => [a.file.id, a.file.storagePath])),
    );
    const deliverableRows = await tx
      .select({
        id: deliverables.id,
        title: deliverables.title,
        type: deliverables.type,
        status: deliverables.status,
        versionCount: deliverables.versionCount,
      })
      .from(deliverables)
      .where(eq(deliverables.taskId, taskId))
      .orderBy(asc(deliverables.createdAt));
    const entries = await tx
      .select({ e: timeEntries, name: profiles.fullName, avatarPath: profiles.avatarPath })
      .from(timeEntries)
      .innerJoin(profiles, eq(profiles.id, timeEntries.userId))
      .where(eq(timeEntries.taskId, taskId))
      .orderBy(desc(timeEntries.startedAt))
      .limit(200);
    const [thread] = await tx
      .select({ id: threads.id })
      .from(threads)
      .where(and(eq(threads.subjectType, 'task'), eq(threads.subjectId, taskId)));
    const [request] = row.t.requestId
      ? ((await tx.execute<{ title: string }>(sql`select title from public.requests where id = ${row.t.requestId}`)) as unknown as {
          title: string;
        }[])
      : [];
    return {
      row,
      people,
      personOf,
      blockedBy,
      blocking,
      checklistItems,
      attachments,
      deliverableRows,
      entries,
      threadId: thread?.id ?? null,
      requestTitle: request?.title ?? null,
    };
  });
  if (!detail) return null;
  const toPeople = (role: string) =>
    detail.people.filter((p) => p.role === role).map((p) => ({ id: p.userId, name: p.name, avatarPath: p.avatarPath }));
  const subtaskItems = item.subtasks ? await listTasks({ parentId: taskId, includeDoneDays: 36500 }) : [];
  const entries: TimeEntryItem[] = detail.entries.map(({ e, name, avatarPath }) => ({
    id: e.id,
    user: { id: e.userId, name, avatarPath },
    startedAt: e.startedAt.toISOString(),
    endedAt: e.endedAt?.toISOString() ?? null,
    minutes: e.minutes,
    note: e.note,
    source: e.source as 'timer' | 'manual',
  }));
  return {
    ...item,
    description: detail.row.t.description,
    watchers: toPeople('watcher'),
    reviewer: detail.personOf(detail.row.t.reviewerId),
    createdBy: detail.personOf(detail.row.t.createdBy),
    requestTitle: detail.requestTitle,
    stepName: detail.row.stepName,
    requiresInternalReview: detail.row.t.requiresInternalReview,
    requiresClientApproval: detail.row.t.requiresClientApproval,
    blockedBy: detail.blockedBy.map((b) => ({ ...b, statusCategory: b.statusCategory as StatusCategory })),
    blocking: detail.blocking.map((b) => ({ ...b, statusCategory: b.statusCategory as StatusCategory })),
    checklistItems: detail.checklistItems,
    attachments: detail.attachments,
    subtaskItems,
    deliverables: detail.deliverableRows.map((d) => ({ ...d, type: d.type as DeliverableType, status: d.status as DeliverableStatus })),
    time: {
      entries,
      totalMinutes: entries.reduce((s, e) => s + e.minutes, 0),
      myMinutes: entries.filter((e) => e.user.id === me).reduce((s, e) => s + e.minutes, 0),
      canSeeAll: canSeeAllTime,
    },
    thread: detail.threadId ? await getThread(detail.threadId) : null,
  };
}

export type SavedViewItem = { id: string; name: string; layout: TaskLayout; isShared: boolean; mine: boolean; config: SavedViewConfig };

export async function listSavedViews(me: string): Promise<SavedViewItem[]> {
  const rows = await withRls((tx) =>
    tx
      .select()
      .from(savedViews)
      .where(or(eq(savedViews.ownerId, me), eq(savedViews.isShared, true)))
      .orderBy(asc(savedViews.name)),
  );
  return rows.map((v) => ({
    id: v.id,
    name: v.name,
    layout: v.layout as TaskLayout,
    isShared: v.isShared,
    mine: v.ownerId === me,
    config: v.config,
  }));
}

export type RunningTimer = { id: string; taskId: string; taskNumber: number; taskTitle: string; startedAt: string } | null;

export async function getRunningTimer(me: string): Promise<RunningTimer> {
  const [row] = await withRls((tx) =>
    tx
      .select({
        id: timeEntries.id,
        taskId: timeEntries.taskId,
        startedAt: timeEntries.startedAt,
        number: tasks.number,
        title: tasks.title,
      })
      .from(timeEntries)
      .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
      .where(and(eq(timeEntries.userId, me), isNull(timeEntries.endedAt))),
  );
  return row
    ? { id: row.id, taskId: row.taskId, taskNumber: row.number, taskTitle: row.title, startedAt: row.startedAt.toISOString() }
    : null;
}
