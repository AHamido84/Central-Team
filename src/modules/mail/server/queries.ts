import 'server-only';

import { and, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';

import type { AgencyContext } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import { emailOutbox, mailSettings } from '@/lib/db/schema';
import { env } from '@/lib/env';
import type { LocalizedText } from '@/lib/i18n/localized';
import {
  MAX_ATTEMPTS,
  type EmailKind,
  type MailPreset,
  type MailSecurity,
  type OutboxStatus,
  type SenderKind,
} from '@/modules/mail/constants';
import { devMailOnly } from '@/modules/mail/server/sender';

export type MailSettingsView = {
  id: string;
  preset: MailPreset;
  host: string | null;
  port: number | null;
  security: MailSecurity;
  username: string | null;
  fromName: LocalizedText;
  fromEmail: string;
  replyTo: string | null;
  dailyLimit: number | null;
  isActive: boolean;
  secretHint: string;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  lastSuccessAt: string | null;
  fallbackSince: string | null;
};

export type MailOverview = {
  settings: MailSettingsView | null;
  /** Who sends right now. */
  activeSender: SenderKind;
  /** The environment sender (fallback, or the sender while nothing is configured). */
  environment: { provider: string; from: string };
  devMode: boolean;
  sentToday: number;
  failedToday: number;
  queued: number;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Settings → Mail (RLS: `mail:manage`). Explicit columns: the Vault reference has no user privilege. */
export async function getMailOverview(ctx: AgencyContext): Promise<MailOverview> {
  return withRls(async (tx) => {
    const [s] = await tx
      .select({
        id: mailSettings.id,
        preset: mailSettings.preset,
        host: mailSettings.host,
        port: mailSettings.port,
        security: mailSettings.security,
        username: mailSettings.username,
        fromName: mailSettings.fromName,
        fromEmail: mailSettings.fromEmail,
        replyTo: mailSettings.replyTo,
        dailyLimit: mailSettings.dailyLimit,
        isActive: mailSettings.isActive,
        secretHint: mailSettings.secretHint,
        lastTestedAt: mailSettings.lastTestedAt,
        lastTestOk: mailSettings.lastTestOk,
        lastTestError: mailSettings.lastTestError,
        lastSuccessAt: mailSettings.lastSuccessAt,
        fallbackSince: mailSettings.fallbackSince,
      })
      .from(mailSettings)
      .where(eq(mailSettings.organizationId, ctx.organization.id));
    const [counts] = await tx
      .select({
        sent: sql<number>`count(*) filter (where ${emailOutbox.status} = 'sent' and ${emailOutbox.sentAt} >= (date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'))::int`,
        failed: sql<number>`count(*) filter (where ${emailOutbox.status} = 'failed' and ${emailOutbox.updatedAt} >= (date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'))::int`,
        queued: sql<number>`count(*) filter (where ${emailOutbox.status} in ('queued', 'sending'))::int`,
      })
      .from(emailOutbox)
      .where(eq(emailOutbox.organizationId, ctx.organization.id));
    const devMode = devMailOnly();
    const settings: MailSettingsView | null = s
      ? {
          ...s,
          preset: s.preset as MailPreset,
          security: s.security as MailSecurity,
          lastTestedAt: iso(s.lastTestedAt),
          lastSuccessAt: iso(s.lastSuccessAt),
          fallbackSince: iso(s.fallbackSince),
        }
      : null;
    const e = env();
    return {
      settings,
      activeSender: devMode
        ? 'dev'
        : settings?.isActive && settings.secretHint
          ? settings.fallbackSince
            ? 'fallback'
            : 'configured'
          : 'environment',
      environment: { provider: e.EMAIL_PROVIDER, from: e.EMAIL_FROM },
      devMode,
      sentToday: Number(counts?.sent ?? 0),
      failedToday: Number(counts?.failed ?? 0),
      queued: Number(counts?.queued ?? 0),
    };
  });
}

export type EmailLogRow = {
  id: string;
  kind: EmailKind;
  toEmail: string;
  subject: string;
  status: OutboxStatus;
  attempts: number;
  final: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  provider: string | null;
  sender: SenderKind | null;
  sensitive: boolean;
  createdAt: string;
  sentAt: string | null;
  nextAttemptAt: string;
};

export type EmailLogFilters = { status?: OutboxStatus | 'all'; kind?: EmailKind | 'all'; q?: string; page?: number };
export const EMAIL_LOG_PAGE = 50;

/** The email log (RLS: `mail:manage`): metadata only, newest first, 90 days. */
export async function listEmailLog(ctx: AgencyContext, f: EmailLogFilters): Promise<{ rows: EmailLogRow[]; total: number }> {
  return withRls(async (tx) => {
    const where: SQL[] = [eq(emailOutbox.organizationId, ctx.organization.id)];
    if (f.status && f.status !== 'all') where.push(eq(emailOutbox.status, f.status));
    if (f.kind && f.kind !== 'all') where.push(eq(emailOutbox.kind, f.kind));
    if (f.q?.trim()) where.push(ilike(emailOutbox.toEmail, `%${f.q.trim().replace(/[%_]/g, '')}%`));
    const page = Math.max(0, (f.page ?? 1) - 1);
    const rows = await tx
      .select({
        id: emailOutbox.id,
        kind: emailOutbox.kind,
        toEmail: emailOutbox.toEmail,
        subject: emailOutbox.subject,
        status: emailOutbox.status,
        attempts: emailOutbox.attempts,
        errorCode: emailOutbox.errorCode,
        errorMessage: emailOutbox.errorMessage,
        provider: emailOutbox.provider,
        sender: emailOutbox.sender,
        sensitive: emailOutbox.sensitive,
        createdAt: emailOutbox.createdAt,
        sentAt: emailOutbox.sentAt,
        nextAttemptAt: emailOutbox.nextAttemptAt,
        total: sql<number>`count(*) over ()::int`,
      })
      .from(emailOutbox)
      .where(and(...where))
      .orderBy(desc(emailOutbox.createdAt))
      .limit(EMAIL_LOG_PAGE)
      .offset(page * EMAIL_LOG_PAGE);
    return {
      total: Number(rows[0]?.total ?? 0),
      rows: rows.map((r) => ({
        id: r.id,
        kind: r.kind as EmailKind,
        toEmail: r.toEmail,
        subject: r.subject,
        status: r.status as OutboxStatus,
        attempts: r.attempts,
        final: r.status === 'failed' && r.attempts >= MAX_ATTEMPTS,
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
        provider: r.provider,
        sender: r.sender as SenderKind | null,
        sensitive: r.sensitive,
        createdAt: r.createdAt.toISOString(),
        sentAt: iso(r.sentAt),
        nextAttemptAt: r.nextAttemptAt.toISOString(),
      })),
    };
  });
}
