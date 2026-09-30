import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { createdAt, id, localized, softDelete, updatedAt } from '@/lib/db/columns';
import { clients } from '@/modules/clients/db/schema';
import { departments } from '@/modules/departments/db/schema';
import { files } from '@/modules/files/db/schema';
import { organizations, profiles } from '@/modules/organizations/db/schema';
import { requests } from '@/modules/requests/db/schema';
import type { SavedViewConfig } from '@/modules/tasks/constants';
import { workflowTemplateSteps, workflowTemplates } from '@/modules/workflows/db/schema';

/** Organization-defined task statuses. Behaviour keys off `category`, so statuses can be renamed or added freely. */
export const taskStatuses = pgTable(
  'task_statuses',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: localized('name').notNull(),
    category: text('category').notNull(),
    color: text('color').notNull().default('neutral'),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Status given to new tasks. */
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('task_statuses_org_key_idx').on(t.organizationId, t.key),
    uniqueIndex('task_statuses_default_idx')
      .on(t.organizationId)
      .where(sql`${t.isDefault}`),
    check('task_statuses_category_check', sql`${t.category} in ('todo','active','review','changes','done','blocked')`),
    check('task_statuses_color_check', sql`${t.color} in ('neutral','info','primary','accent','warning','danger','success')`),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id').references(() => requests.id, { onDelete: 'set null' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    workflowTemplateId: uuid('workflow_template_id').references(() => workflowTemplates.id, { onDelete: 'set null' }),
    workflowStepId: uuid('workflow_step_id').references(() => workflowTemplateSteps.id, { onDelete: 'set null' }),
    /** Per-organization sequence (shown as T-123), assigned by trigger. */
    number: integer('number').notNull().default(0),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    statusId: uuid('status_id')
      .notNull()
      .references(() => taskStatuses.id, { onDelete: 'restrict' }),
    /** Copy of the status category, kept by trigger (filters, RLS, reminders, unblocking). */
    statusCategory: text('status_category').notNull().default('todo'),
    priority: text('priority').notNull().default('normal'),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    estimateMinutes: integer('estimate_minutes'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    reviewerId: uuid('reviewer_id').references(() => profiles.id, { onDelete: 'set null' }),
    /** Order within a board column (fractional, so a move rewrites one row). */
    position: numeric('position', { mode: 'number' }).notNull().default(0),
    /** Order of generated steps within their workflow. */
    stepOrder: integer('step_order'),
    requiresInternalReview: boolean('requires_internal_review').notNull().default(false),
    requiresClientApproval: boolean('requires_client_approval').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    ...softDelete(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Reminder sweep markers (one "due soon" and one "overdue" reminder per due date). */
    dueSoonNotifiedFor: date('due_soon_notified_for'),
    overdueNotifiedFor: date('overdue_notified_for'),
  },
  (t) => [
    uniqueIndex('tasks_org_number_idx').on(t.organizationId, t.number),
    index('tasks_client_idx').on(t.clientId, t.statusCategory),
    index('tasks_request_idx').on(t.requestId),
    index('tasks_parent_idx').on(t.parentId),
    index('tasks_due_idx').on(t.organizationId, t.dueDate),
    check('tasks_title_check', sql`char_length(${t.title}) between 1 and 200`),
    check('tasks_description_check', sql`char_length(${t.description}) <= 20000`),
    check('tasks_priority_check', sql`${t.priority} in ('low','normal','high','urgent')`),
    check('tasks_status_category_check', sql`${t.statusCategory} in ('todo','active','review','changes','done','blocked')`),
    check('tasks_estimate_check', sql`${t.estimateMinutes} is null or ${t.estimateMinutes} between 0 and 100000`),
    check('tasks_dates_check', sql`${t.startDate} is null or ${t.dueDate} is null or ${t.startDate} <= ${t.dueDate}`),
    check('tasks_parent_check', sql`${t.parentId} is distinct from ${t.id}`),
  ],
);

export const taskMembers = pgTable(
  'task_members',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId, t.role] }),
    index('task_members_user_idx').on(t.userId, t.role),
    check('task_members_role_check', sql`${t.role} in ('assignee','watcher')`),
  ],
);

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnId: uuid('depends_on_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.dependsOnId] }),
    index('task_dependencies_depends_idx').on(t.dependsOnId),
    check('task_dependencies_self_check', sql`${t.taskId} <> ${t.dependsOnId}`),
  ],
);

export const taskChecklistItems = pgTable(
  'task_checklist_items',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    isDone: boolean('is_done').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    doneBy: uuid('done_by').references(() => profiles.id, { onDelete: 'set null' }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('task_checklist_items_task_idx').on(t.taskId, t.sortOrder),
    check('task_checklist_items_body_check', sql`char_length(${t.body}) between 1 and 300`),
  ],
);

export const taskAttachments = pgTable(
  'task_attachments',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.fileId] })],
);

/** Internal time tracking: a running timer has no `ended_at`; manual entries carry minutes directly. */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    minutes: integer('minutes').notNull().default(0),
    note: text('note').notNull().default(''),
    source: text('source').notNull().default('timer'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('time_entries_task_idx').on(t.taskId, t.startedAt),
    index('time_entries_user_idx').on(t.userId, t.startedAt),
    uniqueIndex('time_entries_running_idx')
      .on(t.userId)
      .where(sql`${t.endedAt} is null`),
    check('time_entries_source_check', sql`${t.source} in ('timer','manual')`),
    check('time_entries_minutes_check', sql`${t.minutes} between 0 and 1440`),
    check('time_entries_note_check', sql`char_length(${t.note}) <= 500`),
    check('time_entries_range_check', sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
  ],
);

export const savedViews = pgTable(
  'saved_views',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    isShared: boolean('is_shared').notNull().default(false),
    name: text('name').notNull(),
    layout: text('layout').notNull(),
    config: jsonb('config').$type<SavedViewConfig>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('saved_views_owner_idx').on(t.organizationId, t.ownerId),
    check('saved_views_layout_check', sql`${t.layout} in ('board','list','table','calendar')`),
    check('saved_views_name_check', sql`char_length(${t.name}) between 1 and 60`),
  ],
);
