import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { createdAt, id, updatedAt } from '@/lib/db/columns';
import type { LocalizedText } from '@/lib/i18n/localized';
import { organizations, profiles } from '@/modules/organizations/db/schema';

/**
 * The organization's sender (FR2.1 / ADR-088): one row per organization. The password / app password / API key lives in
 * Vault (`secret_id`, no user column privilege); only `secret_hint` is shown.
 */
export const mailSettings = pgTable(
  'mail_settings',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    preset: text('preset').notNull(),
    host: text('host'),
    port: integer('port'),
    security: text('security').notNull().default('starttls'),
    username: text('username'),
    fromName: jsonb('from_name').$type<LocalizedText>().notNull().default({}),
    fromEmail: text('from_email').notNull(),
    replyTo: text('reply_to'),
    dailyLimit: integer('daily_limit'),
    isActive: boolean('is_active').notNull().default(true),
    secretId: uuid('secret_id'),
    secretHint: text('secret_hint').notNull().default(''),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    lastTestOk: boolean('last_test_ok'),
    lastTestError: text('last_test_error'),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    fallbackSince: timestamp('fallback_since', { withTimezone: true }),
    limitWarnedOn: date('limit_warned_on'),
    updatedBy: uuid('updated_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('mail_settings_org_idx').on(t.organizationId),
    check('mail_settings_preset_check', sql`${t.preset} in ('gmail','google_workspace','microsoft365','zoho','resend','smtp')`),
    check('mail_settings_security_check', sql`${t.security} in ('starttls','ssl','none')`),
    check('mail_settings_port_check', sql`${t.port} is null or ${t.port} between 1 and 65535`),
    check('mail_settings_limit_check', sql`${t.dailyLimit} is null or ${t.dailyLimit} between 1 and 1000000`),
  ],
);

/**
 * Every outgoing email (FR2.1): the queue and the log. Bodies have no user column privilege and are cleared after an
 * auth email is sent (its links sign people in). Kept 90 days.
 */
export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: id(),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    toEmail: text('to_email').notNull(),
    userId: uuid('user_id').references(() => profiles.id, { onDelete: 'set null' }),
    locale: text('locale').notNull().default('ar'),
    subject: text('subject').notNull(),
    html: text('html'),
    text: text('text'),
    replyTo: text('reply_to'),
    tags: jsonb('tags').$type<Record<string, string>>().notNull().default({}),
    sensitive: boolean('sensitive').notNull().default(false),
    status: text('status').notNull().default('queued'),
    attempts: smallint('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    provider: text('provider'),
    sender: text('sender'),
    providerMessageId: text('provider_message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    resentFrom: uuid('resent_from'),
    createdBy: uuid('created_by').references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('email_outbox_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} in ('queued','failed')`),
    index('email_outbox_org_idx').on(t.organizationId, t.createdAt),
    check('email_outbox_status_check', sql`${t.status} in ('queued','sending','sent','failed')`),
    check(
      'email_outbox_kind_check',
      sql`${t.kind} in ('magic_link','recovery','email_change','invitation','notification','security_notice','report','test','other')`,
    ),
    check('email_outbox_sender_check', sql`${t.sender} is null or ${t.sender} in ('configured','environment','fallback','dev')`),
  ],
);
