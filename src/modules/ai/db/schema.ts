import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, vector } from 'drizzle-orm/pg-core';

import { createdAt, id, updatedAt } from '@/lib/db/columns';
import type { Citation, InsightFacts, RecommendationFacts } from '@/modules/ai/types';
import { campaignChannels, campaigns } from '@/modules/campaigns/db/schema';
import { clients } from '@/modules/clients/db/schema';
import { organizations, profiles } from '@/modules/organizations/db/schema';
import { tasks } from '@/modules/tasks/db/schema';

const org = () =>
  uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

/** One row per organization: the AI switch, detector sensitivity, report auto-drafts and the monthly token budget. */
export const aiSettings = pgTable(
  'ai_settings',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    sensitivity: text('sensitivity').notNull().default('normal'),
    autoDraftReports: boolean('auto_draft_reports').notNull().default(false),
    monthlyTokenBudget: integer('monthly_token_budget').notNull().default(2_000_000),
    updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('ai_settings_sensitivity_check', sql`${t.sensitivity} in ('low','normal','high')`),
    check('ai_settings_budget_check', sql`${t.monthlyTokenBudget} between 0 and 1000000000`),
  ],
);

/**
 * AI provider credentials per organization (FR1.5, ADR-085). The key itself lives in Supabase Vault (`secret_id`,
 * readable by no user); the row keeps a masked hint for display. One active credential per provider.
 */
export const aiCredentials = pgTable(
  'ai_credentials',
  {
    id: id(),
    organizationId: org(),
    provider: text('provider').notNull(),
    displayName: text('display_name').notNull(),
    keyHint: text('key_hint').notNull(),
    secretId: uuid('secret_id'),
    defaultModel: text('default_model'),
    monthlyTokenLimit: integer('monthly_token_limit'),
    isActive: boolean('is_active').notNull().default(true),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestOk: boolean('last_test_ok'),
    lastTestError: text('last_test_error'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ai_credentials_active_idx')
      .on(t.organizationId, t.provider)
      .where(sql`${t.isActive}`),
    check('ai_credentials_provider_check', sql`${t.provider} in ('anthropic','voyage')`),
    check('ai_credentials_name_check', sql`char_length(${t.displayName}) between 1 and 80`),
    check('ai_credentials_limit_check', sql`${t.monthlyTokenLimit} is null or ${t.monthlyTokenLimit} between 0 and 1000000000`),
  ],
);

/** Every model call (tokens only — never the prompt). The monthly budget sums this table. */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: id(),
    organizationId: org(),
    userId: uuid('user_id').references(() => profiles.id, { onDelete: 'set null' }),
    purpose: text('purpose').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_usage_org_idx').on(t.organizationId, t.createdAt),
    check('ai_usage_purpose_check', sql`${t.purpose} in ('assistant','report_draft','insight_explain','embedding')`),
    check('ai_usage_provider_check', sql`${t.provider} in ('anthropic','voyage','mock')`),
  ],
);

/** Something the detectors found on a campaign (ADR-074). Facts are computed by code; titles come from translations. */
export const aiInsights = pgTable(
  'ai_insights',
  {
    id: id(),
    organizationId: org(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id').references(() => campaignChannels.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    metric: text('metric'),
    severity: text('severity').notNull().default('info'),
    status: text('status').notNull().default('open'),
    dedupeKey: text('dedupe_key').notNull(),
    detectedOn: date('detected_on').notNull(),
    facts: jsonb('facts').$type<InsightFacts>().notNull(),
    explanation: text('explanation'),
    explanationLocale: text('explanation_locale'),
    explainedAt: timestamp('explained_at', { withTimezone: true }),
    firstDetectedAt: timestamp('first_detected_at', { withTimezone: true }).notNull().defaultNow(),
    lastDetectedAt: timestamp('last_detected_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    dismissReason: text('dismiss_reason'),
    actedBy: uuid('acted_by').references(() => profiles.id, { onDelete: 'set null' }),
    actedAt: timestamp('acted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ai_insights_dedupe_idx').on(t.organizationId, t.dedupeKey),
    index('ai_insights_campaign_idx').on(t.campaignId, t.status),
    index('ai_insights_org_idx').on(t.organizationId, t.status, t.lastDetectedAt),
    check(
      'ai_insights_kind_check',
      sql`${t.kind} in ('spike','drop','kpi_off_track','kpi_at_risk','budget_overspent','budget_overpace','budget_underpace','delivery_stopped')`,
    ),
    check('ai_insights_severity_check', sql`${t.severity} in ('info','warning','critical')`),
    check('ai_insights_status_check', sql`${t.status} in ('open','acknowledged','dismissed','resolved')`),
    check('ai_insights_explanation_locale_check', sql`${t.explanationLocale} is null or ${t.explanationLocale} in ('ar','en')`),
    check('ai_insights_dismiss_reason_check', sql`${t.dismissReason} is null or char_length(${t.dismissReason}) <= 500`),
  ],
);

/** A rule-based next step for an insight, with computed impact; accepting it creates a task. */
export const aiRecommendations = pgTable(
  'ai_recommendations',
  {
    id: id(),
    organizationId: org(),
    insightId: uuid('insight_id')
      .notNull()
      .references(() => aiInsights.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    facts: jsonb('facts').$type<RecommendationFacts>().notNull().default({}),
    status: text('status').notNull().default('proposed'),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    dismissReason: text('dismiss_reason'),
    decidedBy: uuid('decided_by').references(() => profiles.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ai_recommendations_insight_kind_idx').on(t.insightId, t.kind),
    index('ai_recommendations_campaign_idx').on(t.campaignId, t.status),
    check(
      'ai_recommendations_kind_check',
      sql`${t.kind} in ('shift_budget','reduce_budget','increase_budget','refresh_creative','review_targeting','check_tracking','resume_delivery')`,
    ),
    check('ai_recommendations_status_check', sql`${t.status} in ('proposed','accepted','dismissed')`),
    check('ai_recommendations_dismiss_reason_check', sql`${t.dismissReason} is null or char_length(${t.dismissReason}) <= 500`),
  ],
);

/** Retrieval index for the assistant: one redacted text chunk per source record (ADR-075, ADR-076). */
export const aiChunks = pgTable(
  'ai_chunks',
  {
    id: id(),
    organizationId: org(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    url: text('url').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),
    embeddingModel: text('embedding_model').notNull(),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_chunks_source_idx').on(t.sourceType, t.sourceId),
    index('ai_chunks_org_idx').on(t.organizationId, t.embeddingModel),
    index('ai_chunks_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    check('ai_chunks_source_type_check', sql`${t.sourceType} in ('client','campaign','request','task','report','lead','deal','insight')`),
    check('ai_chunks_content_check', sql`char_length(${t.content}) <= 8000`),
  ],
);

/** A private assistant conversation. */
export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: id(),
    organizationId: org(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ai_conversations_user_idx').on(t.userId, t.lastMessageAt),
    check('ai_conversations_title_check', sql`char_length(${t.title}) between 1 and 120`),
  ],
);

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: id(),
    organizationId: org(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    content: text('content').notNull(),
    citations: jsonb('citations').$type<Citation[]>().notNull().default([]),
    status: text('status').notNull().default('ok'),
    /** Why a reply failed (an `ai_*` failure code, FR3.2): shown as a specific, translated reason in the thread. */
    reason: text('reason'),
    model: text('model'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_messages_conversation_idx').on(t.conversationId, t.createdAt),
    check('ai_messages_role_check', sql`${t.role} in ('user','assistant')`),
    check('ai_messages_status_check', sql`${t.status} in ('ok','failed','refused','budget','disabled','no_sources')`),
    check('ai_messages_content_check', sql`char_length(${t.content}) <= 20000`),
    check('ai_messages_reason_check', sql`${t.reason} is null or ${t.reason} ~ '^ai_[a-z_]{1,40}$'`),
  ],
);
