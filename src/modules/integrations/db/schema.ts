import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, id, updatedAt } from '@/lib/db/columns';
import { campaignChannels } from '@/modules/campaigns/db/schema';
import { clients } from '@/modules/clients/db/schema';
import { deals, leads } from '@/modules/crm/db/schema';
import { organizations, profiles } from '@/modules/organizations/db/schema';

const org = () =>
  uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

/**
 * One authorized link to a platform (Meta, WhatsApp, TikTok, Snapchat, Google). The token set lives only in Supabase
 * Vault (`integration_secrets` → `vault.secrets`); status and health columns are written by the service path.
 */
export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: id(),
    organizationId: org(),
    provider: text('provider').notNull(),
    mode: text('mode').notNull().default('live'),
    name: text('name').notNull(),
    status: text('status').notNull().default('connected'),
    externalUserId: text('external_user_id'),
    externalName: text('external_name'),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    /** Non-secret provider settings (WhatsApp phone number / WABA id, Google customer id). */
    settings: jsonb('settings').$type<Record<string, string>>().notNull().default({}),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    connectedBy: uuid('connected_by').references(() => profiles.id, { onDelete: 'set null' }),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('integration_connections_org_idx').on(t.organizationId, t.provider),
    check('integration_connections_provider_check', sql`${t.provider} in ('meta','whatsapp','tiktok','snapchat','google')`),
    check('integration_connections_mode_check', sql`${t.mode} in ('live','sandbox')`),
    check('integration_connections_status_check', sql`${t.status} in ('connected','expired','error','disconnected')`),
    check('integration_connections_name_check', sql`char_length(${t.name}) between 1 and 120`),
  ],
);

/** Connection → Vault secret id. No policies and no grants: only the `app.integration_*_secret` functions read it. */
export const integrationSecrets = pgTable('integration_secrets', {
  connectionId: uuid('connection_id')
    .primaryKey()
    .references(() => integrationConnections.id, { onDelete: 'cascade' }),
  secretId: uuid('secret_id').notNull(),
  updatedAt: updatedAt(),
});

/** Something inside a connection: an ad account, a Facebook page, a WhatsApp number or an analytics property. */
export const integrationAccounts = pgTable(
  'integration_accounts',
  {
    id: id(),
    organizationId: org(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    currency: char('currency', { length: 3 }),
    timezone: text('timezone'),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    syncEnabled: boolean('sync_enabled').notNull().default(false),
    metadata: jsonb('metadata').$type<Record<string, string>>().notNull().default({}),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('integration_accounts_external_idx').on(t.connectionId, t.kind, t.externalId),
    index('integration_accounts_route_idx').on(t.kind, t.externalId),
    index('integration_accounts_client_idx').on(t.clientId),
    check('integration_accounts_kind_check', sql`${t.kind} in ('ad_account','page','whatsapp_number','analytics_property')`),
  ],
);

/** A platform campaign discovered in an ad account, optionally feeding one of our campaign channels. */
export const integrationCampaignLinks = pgTable(
  'integration_campaign_links',
  {
    id: id(),
    organizationId: org(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => integrationAccounts.id, { onDelete: 'cascade' }),
    externalCampaignId: text('external_campaign_id').notNull(),
    name: text('name').notNull(),
    platformStatus: text('platform_status'),
    channelId: uuid('channel_id').references(() => campaignChannels.id, { onDelete: 'set null' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('integration_campaign_links_external_idx').on(t.accountId, t.externalCampaignId),
    index('integration_campaign_links_channel_idx').on(t.channelId),
  ],
);

/** Sync log: one row per metrics pull (manual, scheduled, backfill), retried with backoff. */
export const integrationSyncRuns = pgTable(
  'integration_sync_runs',
  {
    id: id(),
    organizationId: org(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').references(() => integrationAccounts.id, { onDelete: 'cascade' }),
    trigger: text('trigger').notNull().default('manual'),
    dateFrom: date('date_from').notNull(),
    dateTo: date('date_to').notNull(),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    rowsWritten: integer('rows_written').notNull().default(0),
    campaigns: integer('campaigns').notNull().default(0),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    requestedBy: uuid('requested_by').references(() => profiles.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('integration_sync_runs_connection_idx').on(t.connectionId, t.createdAt),
    index('integration_sync_runs_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} in ('queued','failed')`),
    check('integration_sync_runs_trigger_check', sql`${t.trigger} in ('manual','scheduled','backfill','retry')`),
    check('integration_sync_runs_status_check', sql`${t.status} in ('queued','running','succeeded','failed')`),
    check('integration_sync_runs_range_check', sql`${t.dateTo} >= ${t.dateFrom} and ${t.dateTo} - ${t.dateFrom} <= 90`),
  ],
);

/** Every inbound platform webhook: signature result, dedup key, processing state. */
export const integrationWebhookEvents = pgTable(
  'integration_webhook_events',
  {
    id: id(),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    connectionId: uuid('connection_id').references(() => integrationConnections.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => integrationAccounts.id, { onDelete: 'set null' }),
    externalId: text('external_id'),
    topic: text('topic').notNull().default('other'),
    signatureValid: boolean('signature_valid').notNull(),
    status: text('status').notNull().default('received'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    payload: jsonb('payload').$type<unknown>(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('integration_webhook_events_dedup_idx')
      .on(t.provider, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index('integration_webhook_events_org_idx').on(t.organizationId, t.receivedAt),
    index('integration_webhook_events_pending_idx')
      .on(t.receivedAt)
      .where(sql`${t.status} in ('received','failed')`),
    check('integration_webhook_events_provider_check', sql`${t.provider} in ('meta','whatsapp','tiktok','snapchat','google')`),
    check('integration_webhook_events_topic_check', sql`${t.topic} in ('lead','message_status','message','verification','other')`),
    check('integration_webhook_events_status_check', sql`${t.status} in ('received','processed','ignored','failed','rejected')`),
  ],
);

/** Message templates of a WhatsApp Business account (only approved ones can be sent). */
export const whatsappTemplates = pgTable(
  'whatsapp_templates',
  {
    id: id(),
    organizationId: org(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    language: text('language').notNull(),
    /** The platform's exact language code (`en_US`), used when sending. */
    languageCode: text('language_code').notNull().default(''),
    category: text('category').notNull().default('utility'),
    status: text('status').notNull().default('approved'),
    body: text('body').notNull().default(''),
    paramCount: integer('param_count').notNull().default(0),
    isNotification: boolean('is_notification').notNull().default(false),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('whatsapp_templates_name_idx').on(t.connectionId, t.name, t.language),
    uniqueIndex('whatsapp_templates_notification_idx')
      .on(t.organizationId, t.language)
      .where(sql`${t.isNotification}`),
    check('whatsapp_templates_language_check', sql`${t.language} in ('ar','en')`),
    check('whatsapp_templates_category_check', sql`${t.category} in ('utility','marketing','authentication')`),
    check('whatsapp_templates_status_check', sql`${t.status} in ('approved','pending','rejected','paused')`),
    check('whatsapp_templates_params_check', sql`${t.paramCount} between 0 and 10`),
  ],
);

/** Outbound WhatsApp messages (notifications, lead outreach, automations) with their delivery status. */
export const whatsappMessages = pgTable(
  'whatsapp_messages',
  {
    id: id(),
    organizationId: org(),
    connectionId: uuid('connection_id').references(() => integrationConnections.id, { onDelete: 'set null' }),
    toPhone: text('to_phone').notNull(),
    templateName: text('template_name').notNull(),
    language: text('language').notNull(),
    params: text('params')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    body: text('body').notNull().default(''),
    purpose: text('purpose').notNull(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    recipientUserId: uuid('recipient_user_id').references(() => profiles.id, { onDelete: 'set null' }),
    automationRunId: uuid('automation_run_id'),
    notificationType: text('notification_type'),
    externalId: text('external_id'),
    status: text('status').notNull().default('queued'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    attempts: integer('attempts').notNull().default(0),
    sentBy: uuid('sent_by').references(() => profiles.id, { onDelete: 'set null' }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('whatsapp_messages_external_idx')
      .on(t.externalId)
      .where(sql`${t.externalId} is not null`),
    index('whatsapp_messages_lead_idx').on(t.leadId, t.createdAt),
    index('whatsapp_messages_deal_idx').on(t.dealId, t.createdAt),
    index('whatsapp_messages_org_idx').on(t.organizationId, t.createdAt),
    check('whatsapp_messages_purpose_check', sql`${t.purpose} in ('notification','lead','automation')`),
    check('whatsapp_messages_status_check', sql`${t.status} in ('queued','sent','delivered','read','failed')`),
    check('whatsapp_messages_language_check', sql`${t.language} in ('ar','en')`),
  ],
);

/** A user's consent to receive notifications on WhatsApp (agency channel). */
export const whatsappOptIns = pgTable(
  'whatsapp_opt_ins',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    organizationId: org(),
    phone: text('phone').notNull(),
    optedInAt: timestamp('opted_in_at', { withTimezone: true }),
    optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.organizationId] }),
    check('whatsapp_opt_ins_phone_check', sql`${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
  ],
);
