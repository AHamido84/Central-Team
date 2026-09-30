import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { createdAt, id, localized, updatedAt } from '@/lib/db/columns';
import { clients, packages } from '@/modules/clients/db/schema';
import { organizations, profiles } from '@/modules/organizations/db/schema';
import { requestTypes } from '@/modules/requests/db/schema';
import { workflowTemplates } from '@/modules/workflows/db/schema';

const org = () =>
  uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

/** Public embeddable lead forms. `token` is the unguessable id in the public URL. */
export const leadForms = pgTable(
  'lead_forms',
  {
    id: id(),
    organizationId: org(),
    name: text('name').notNull(),
    token: text('token').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    services: text('services')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    thankYou: localized('thank_you').notNull().default({}),
    submissions: integer('submissions').notNull().default(0),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('lead_forms_token_idx').on(t.token), check('lead_forms_name_check', sql`char_length(${t.name}) between 1 and 120`)],
);

export const leads = pgTable(
  'leads',
  {
    id: id(),
    organizationId: org(),
    number: integer('number').notNull().default(0),
    fullName: text('full_name').notNull(),
    company: text('company'),
    phone: text('phone'),
    email: text('email'),
    source: text('source').notNull().default('manual'),
    sourceDetail: text('source_detail'),
    externalRef: text('external_ref'),
    services: text('services')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    budgetRange: text('budget_range').notNull().default('unknown'),
    city: text('city'),
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('new'),
    score: integer('score').notNull().default(0),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text('notes').notNull().default(''),
    formId: uuid('form_id').references(() => leadForms.id, { onDelete: 'set null' }),
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => leads.id, { onDelete: 'set null' }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('leads_org_number_idx').on(t.organizationId, t.number),
    uniqueIndex('leads_external_ref_idx').on(t.organizationId, t.source, t.externalRef),
    index('leads_org_status_idx').on(t.organizationId, t.status, t.lastActivityAt),
    index('leads_phone_idx').on(t.organizationId, t.phone),
    index('leads_email_idx').on(t.organizationId, sql`lower(${t.email})`),
    index('leads_owner_idx').on(t.ownerId),
    check('leads_source_check', sql`${t.source} in ('website_form','whatsapp','instagram','referral','event','lead_ad','manual','other')`),
    check('leads_status_check', sql`${t.status} in ('new','contacted','qualified','unqualified','converted','merged')`),
    check('leads_budget_check', sql`${t.budgetRange} in ('under_5k','5k_15k','15k_50k','50k_plus','unknown')`),
    check('leads_score_check', sql`${t.score} between 0 and 100`),
    check('leads_name_check', sql`char_length(${t.fullName}) between 1 and 120`),
    check('leads_contact_check', sql`${t.phone} is not null or ${t.email} is not null`),
  ],
);

export const pipelines = pgTable(
  'pipelines',
  {
    id: id(),
    organizationId: org(),
    name: localized('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('pipelines_one_default_idx')
      .on(t.organizationId)
      .where(sql`${t.isDefault}`),
  ],
);

export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: id(),
    organizationId: org(),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'cascade' }),
    name: localized('name').notNull(),
    kind: text('kind').notNull().default('open'),
    probability: integer('probability').notNull().default(10),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('pipeline_stages_pipeline_idx').on(t.pipelineId, t.sortOrder),
    check('pipeline_stages_kind_check', sql`${t.kind} in ('open','won','lost')`),
    check('pipeline_stages_probability_check', sql`${t.probability} between 0 and 100`),
  ],
);

export const deals = pgTable(
  'deals',
  {
    id: id(),
    organizationId: org(),
    number: integer('number').notNull().default(0),
    title: text('title').notNull(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    company: text('company'),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'restrict' }),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => pipelineStages.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('open'),
    valueMinor: integer('value_minor').notNull().default(0),
    currency: text('currency').notNull().default('SAR'),
    probability: integer('probability').notNull().default(10),
    expectedCloseDate: date('expected_close_date'),
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'set null' }),
    packageId: uuid('package_id').references(() => packages.id, { onDelete: 'set null' }),
    source: text('source'),
    lostReason: text('lost_reason'),
    lostNote: text('lost_note'),
    wonAt: timestamp('won_at', { withTimezone: true }),
    lostAt: timestamp('lost_at', { withTimezone: true }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    staleNotifiedAt: timestamp('stale_notified_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('deals_org_number_idx').on(t.organizationId, t.number),
    index('deals_org_status_idx').on(t.organizationId, t.status, t.expectedCloseDate),
    index('deals_stage_idx').on(t.stageId),
    index('deals_owner_idx').on(t.ownerId),
    index('deals_lead_idx').on(t.leadId),
    check('deals_status_check', sql`${t.status} in ('open','won','lost')`),
    check('deals_value_check', sql`${t.valueMinor} >= 0`),
    check('deals_probability_check', sql`${t.probability} between 0 and 100`),
    check('deals_title_check', sql`char_length(${t.title}) between 1 and 160`),
    check(
      'deals_lost_reason_check',
      sql`${t.lostReason} is null or ${t.lostReason} in ('price','timing','competitor','no_response','not_fit','other')`,
    ),
  ],
);

export const dealStageHistory = pgTable(
  'deal_stage_history',
  {
    id: id(),
    organizationId: org(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    fromStageId: uuid('from_stage_id').references(() => pipelineStages.id, { onDelete: 'set null' }),
    toStageId: uuid('to_stage_id')
      .notNull()
      .references(() => pipelineStages.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('deal_stage_history_deal_idx').on(t.dealId, t.createdAt)],
);

export const dealContacts = pgTable(
  'deal_contacts',
  {
    id: id(),
    organizationId: org(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    jobTitle: text('job_title'),
    phone: text('phone'),
    email: text('email'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('deal_contacts_deal_idx').on(t.dealId),
    uniqueIndex('deal_contacts_one_primary_idx')
      .on(t.dealId)
      .where(sql`${t.isPrimary}`),
    check('deal_contacts_name_check', sql`char_length(${t.fullName}) between 1 and 120`),
  ],
);

export const crmActivities = pgTable(
  'crm_activities',
  {
    id: id(),
    organizationId: org(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull().default(''),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'set null' }),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('crm_activities_lead_idx').on(t.leadId, t.createdAt),
    index('crm_activities_deal_idx').on(t.dealId, t.createdAt),
    index('crm_activities_due_idx')
      .on(t.organizationId, t.ownerId, t.dueAt)
      .where(sql`${t.completedAt} is null`),
    check('crm_activities_type_check', sql`${t.type} in ('call','meeting','email','whatsapp','note','task')`),
    check('crm_activities_parent_check', sql`${t.leadId} is not null or ${t.dealId} is not null`),
    check('crm_activities_subject_check', sql`char_length(${t.subject}) between 1 and 200`),
  ],
);

export const crmFiles = pgTable(
  'crm_files',
  {
    id: id(),
    organizationId: org(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    storagePath: text('storage_path').notNull(),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('crm_files_deal_idx').on(t.dealId), uniqueIndex('crm_files_path_idx').on(t.storagePath)],
);

export const quotes = pgTable(
  'quotes',
  {
    id: id(),
    organizationId: org(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    number: integer('number').notNull().default(0),
    title: text('title').notNull(),
    locale: text('locale').notNull().default('ar'),
    status: text('status').notNull().default('draft'),
    validUntil: date('valid_until'),
    currency: text('currency').notNull().default('SAR'),
    discountMinor: integer('discount_minor').notNull().default(0),
    subtotalMinor: integer('subtotal_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull().default(0),
    notes: text('notes').notNull().default(''),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('quotes_org_number_idx').on(t.organizationId, t.number),
    index('quotes_deal_idx').on(t.dealId),
    check('quotes_status_check', sql`${t.status} in ('draft','sent','accepted','declined')`),
    check('quotes_locale_check', sql`${t.locale} in ('ar','en')`),
    check('quotes_discount_check', sql`${t.discountMinor} >= 0`),
  ],
);

export const quoteItems = pgTable(
  'quote_items',
  {
    id: id(),
    organizationId: org(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    packageId: uuid('package_id').references(() => packages.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    quantity: numeric('quantity', { mode: 'number' }).notNull().default(1),
    unitPriceMinor: integer('unit_price_minor').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('quote_items_quote_idx').on(t.quoteId, t.sortOrder),
    check('quote_items_quantity_check', sql`${t.quantity} > 0`),
    check('quote_items_price_check', sql`${t.unitPriceMinor} >= 0`),
  ],
);

export const leadAssignmentRules = pgTable(
  'lead_assignment_rules',
  {
    id: id(),
    organizationId: org(),
    name: text('name').notNull(),
    matchServices: text('match_services')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    matchCities: text('match_cities')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    matchSources: text('match_sources')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    memberIds: uuid('member_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    cursor: integer('cursor').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('lead_assignment_rules_org_idx').on(t.organizationId, t.sortOrder)],
);

export const crmWebhookTokens = pgTable(
  'crm_webhook_tokens',
  {
    id: id(),
    organizationId: org(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('crm_webhook_tokens_hash_idx').on(t.tokenHash)],
);

export const salesTargets = pgTable(
  'sales_targets',
  {
    id: id(),
    organizationId: org(),
    ownerId: uuid('owner_id').references(() => profiles.id, { onDelete: 'cascade' }),
    month: date('month').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sales_targets_org_owner_month_idx').on(
      t.organizationId,
      sql`coalesce(${t.ownerId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.month,
    ),
    check('sales_targets_amount_check', sql`${t.amountMinor} >= 0`),
    check('sales_targets_month_check', sql`extract(day from ${t.month}) = 1`),
  ],
);

export const crmSettings = pgTable(
  'crm_settings',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    staleDays: integer('stale_days').notNull().default(7),
    onboardingRequestTypeId: uuid('onboarding_request_type_id').references(() => requestTypes.id, { onDelete: 'set null' }),
    onboardingTemplateId: uuid('onboarding_template_id').references(() => workflowTemplates.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [check('crm_settings_stale_check', sql`${t.staleDays} between 1 and 90`)],
);
