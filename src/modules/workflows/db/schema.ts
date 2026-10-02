import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, id, isDemo, localized, softDelete, updatedAt } from '@/lib/db/columns';
import { departments } from '@/modules/departments/db/schema';
import { organizations, profiles } from '@/modules/organizations/db/schema';
import { roles } from '@/modules/rbac/db/schema';
import { requestTypes } from '@/modules/requests/db/schema';

/** How a request type's work is produced: an ordered chain of steps that "Convert to tasks" turns into tasks. */
export const workflowTemplates = pgTable(
  'workflow_templates',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    requestTypeId: uuid('request_type_id').references(() => requestTypes.id, { onDelete: 'set null' }),
    name: localized('name').notNull(),
    description: localized('description').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    /** The template "Convert to tasks" proposes for its request type. */
    isDefault: boolean('is_default').notNull().default(false),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    ...softDelete(),
    isDemo: isDemo(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('workflow_templates_org_idx').on(t.organizationId),
    uniqueIndex('workflow_templates_default_idx')
      .on(t.requestTypeId)
      .where(sql`${t.isDefault} and ${t.requestTypeId} is not null`),
  ],
);

export const workflowTemplateSteps = pgTable(
  'workflow_template_steps',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => workflowTemplates.id, { onDelete: 'cascade' }),
    name: localized('name').notNull(),
    description: localized('description').notNull().default({}),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    /** Who gets the generated task: the client's account manager, a client-team member with a role, a fixed user, or nobody. */
    assigneeMode: text('assignee_mode').notNull().default('none'),
    assigneeRoleId: uuid('assignee_role_id').references(() => roles.id, { onDelete: 'set null' }),
    assigneeUserId: uuid('assignee_user_id').references(() => profiles.id, { onDelete: 'set null' }),
    slaDays: integer('sla_days').notNull().default(1),
    /** Ids of steps of the same template that must be done first. */
    dependsOn: uuid('depends_on')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    requiresInternalReview: boolean('requires_internal_review').notNull().default(false),
    requiresClientApproval: boolean('requires_client_approval').notNull().default(false),
    deliverableType: text('deliverable_type'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('workflow_template_steps_template_idx').on(t.templateId, t.sortOrder),
    check('workflow_template_steps_assignee_mode_check', sql`${t.assigneeMode} in ('account_manager','role','user','none')`),
    check('workflow_template_steps_sla_check', sql`${t.slaDays} between 0 and 60`),
    check(
      'workflow_template_steps_deliverable_type_check',
      sql`${t.deliverableType} is null or ${t.deliverableType} in ('design','video','copy','document','other')`,
    ),
    check('workflow_template_steps_approval_check', sql`not ${t.requiresClientApproval} or ${t.deliverableType} is not null`),
    check('workflow_template_steps_review_check', sql`not ${t.requiresInternalReview} or ${t.deliverableType} is not null`),
  ],
);
