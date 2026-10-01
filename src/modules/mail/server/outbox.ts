import 'server-only';

import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { after } from 'next/server';

import { dbAdmin } from '@/lib/db/client';
import { emailOutbox, mailSettings } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { scheduleEventDispatch } from '@/lib/events/schedule';
import { isLocale, type Locale } from '@/lib/i18n/localized';
import {
  LIMIT_WARNING_SHARE,
  MAX_ATTEMPTS,
  OUTBOX_RETENTION_DAYS,
  RETRY_MINUTES,
  type EmailKind,
  type MailErrorCode,
} from '@/modules/mail/constants';
import { classifyMailError, isTransient } from '@/modules/mail/server/errors';
import { resolveSenders, type ResolvedSender } from '@/modules/mail/server/sender';

type OutboxRow = typeof emailOutbox.$inferSelect;

export type EnqueueInput = {
  organizationId: string | null;
  kind: EmailKind;
  to: string;
  userId?: string | null;
  locale: Locale;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  tags?: Record<string, string>;
  /** Holds sign-in links: the body is cleared once sent and the log can't resend it. */
  sensitive?: boolean;
  createdBy?: string | null;
  resentFrom?: string | null;
};

/**
 * Service path (CLAUDE.md §6, ADR-088): every email goes through the outbox so a failing provider never breaks the
 * action that triggered it. Returns the row id; delivery happens after the response (or in the cron sweep).
 */
export async function enqueueEmail(input: EnqueueInput, opts: { deliver?: 'after' | 'none' } = {}): Promise<string> {
  const [row] = await dbAdmin
    .insert(emailOutbox)
    .values({
      organizationId: input.organizationId,
      kind: input.kind,
      toEmail: input.to.trim().toLowerCase(),
      userId: input.userId ?? null,
      locale: input.locale,
      subject: input.subject.slice(0, 300),
      html: input.html,
      text: input.text,
      replyTo: input.replyTo ?? null,
      tags: input.tags ?? {},
      sensitive: input.sensitive ?? false,
      createdBy: input.createdBy ?? null,
      resentFrom: input.resentFrom ?? null,
    })
    .returning({ id: emailOutbox.id });
  if (opts.deliver !== 'none') scheduleEmailQueue([row!.id]);
  return row!.id;
}

/** Delivers after the response is sent (or detached outside a request). The cron sweep retries what's left. */
export function scheduleEmailQueue(ids?: string[]): void {
  const task = () =>
    processEmailQueue({ ids }).then(
      () => undefined,
      (error) => console.error('[mail] queue failed', error),
    );
  try {
    after(task);
  } catch {
    void task();
  }
}

const riyadhDayStart = sql`(date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh')`;

/** Messages the configured sender delivered today (Riyadh day), for the daily limit and the status card. */
export async function sentToday(organizationId: string): Promise<number> {
  const [row] = await dbAdmin
    .select({ n: sql<number>`count(*)::int` })
    .from(emailOutbox)
    .where(
      and(
        eq(emailOutbox.organizationId, organizationId),
        eq(emailOutbox.status, 'sent'),
        eq(emailOutbox.sender, 'configured'),
        sql`${emailOutbox.sentAt} >= ${riyadhDayStart}`,
      ),
    );
  return Number(row?.n ?? 0);
}

async function emitMailEvent(
  organizationId: string,
  type: 'mail.fallback_used' | 'mail.limit_approaching',
  payload: Record<string, unknown>,
) {
  await dbAdmin.transaction((tx) =>
    emitEvent(tx, {
      type,
      organizationId,
      actorId: null,
      aggregate: { type: 'mail_settings', id: null },
      payload,
    } as never),
  );
  scheduleEventDispatch();
}

type Senders = Awaited<ReturnType<typeof resolveSenders>>;

/**
 * Claims due messages and sends them. Retries with backoff (1, 5, 15, 60 minutes), falls back to the environment
 * sender when the configured one fails or has reached its daily limit (admins are told once a day), and warns at 80%
 * of the limit. Idempotent per message: a claimed row is locked for two minutes.
 */
export async function processEmailQueue(
  opts: {
    ids?: string[];
    limit?: number;
    /** Tests inject senders; the app always resolves them from the DB. */ resolve?: typeof resolveSenders;
  } = {},
): Promise<{ sent: number; failed: number; deferred: number }> {
  const result = { sent: 0, failed: 0, deferred: 0 };
  const idFilter = opts.ids?.length ? sql`and o.id = any (${`{${opts.ids.join(',')}}`}::uuid[])` : sql``;
  const claimed = await dbAdmin.execute<{ id: string }>(sql`
    with due as (
      select o.id from public.email_outbox o
      where o.status in ('queued', 'failed') and o.attempts < ${MAX_ATTEMPTS} and o.next_attempt_at <= now()
        and (o.locked_until is null or o.locked_until < now()) ${idFilter}
      order by o.next_attempt_at
      limit ${opts.limit ?? 25}
      for update skip locked
    )
    update public.email_outbox o
    set status = 'sending', attempts = o.attempts + 1, locked_until = now() + interval '2 minutes'
    from due where o.id = due.id
    returning o.id`);
  if (!claimed.length) return result;
  const rows = await dbAdmin
    .select()
    .from(emailOutbox)
    .where(
      inArray(
        emailOutbox.id,
        claimed.map((c) => c.id),
      ),
    );
  const senders = new Map<string, Senders>();
  for (const row of rows) {
    const key = row.organizationId ?? '';
    if (!senders.has(key)) senders.set(key, await (opts.resolve ?? resolveSenders)(row.organizationId));
    const outcome = await deliver(row, senders.get(key)!);
    result[outcome]++;
  }
  return result;
}

async function attempt(row: OutboxRow, sender: ResolvedSender) {
  const locale: Locale = isLocale(row.locale) ? row.locale : 'ar';
  return sender.provider.send({
    to: row.toEmail,
    subject: row.subject,
    html: row.html ?? '',
    text: row.text ?? '',
    from: sender.from(locale),
    replyTo: row.replyTo ?? sender.replyTo ?? undefined,
    tags: { ...row.tags, kind: row.kind },
  });
}

async function markSent(row: OutboxRow, sender: ResolvedSender, messageId: string) {
  await dbAdmin
    .update(emailOutbox)
    .set({
      status: 'sent',
      sentAt: new Date(),
      lockedUntil: null,
      sender: sender.kind,
      provider: sender.provider.name,
      providerMessageId: messageId.slice(0, 300),
      errorCode: null,
      errorMessage: null,
      // Sign-in links must not outlive their delivery.
      ...(row.sensitive ? { html: null, text: null } : {}),
    })
    .where(eq(emailOutbox.id, row.id));
}

async function deliver(row: OutboxRow, { primary, fallback }: Senders): Promise<'sent' | 'failed' | 'deferred'> {
  const settings = primary.settings;
  let useFallbackFor: MailErrorCode | null = null;

  if (primary.kind === 'configured' && settings?.dailyLimit) {
    const today = await sentToday(settings.organizationId);
    if (today >= settings.dailyLimit) {
      if (!fallback) {
        // At the limit with nowhere else to send: wait for tomorrow (Riyadh) without spending an attempt.
        await dbAdmin
          .update(emailOutbox)
          .set({
            status: 'queued',
            attempts: sql`greatest(${emailOutbox.attempts} - 1, 0)`,
            lockedUntil: null,
            errorCode: 'daily_limit',
            errorMessage: null,
            nextAttemptAt: sql`${riyadhDayStart} + interval '1 day'`,
          })
          .where(eq(emailOutbox.id, row.id));
        return 'deferred';
      }
      useFallbackFor = 'daily_limit';
    }
  }

  if (!useFallbackFor) {
    try {
      const { id } = await attempt(row, primary);
      await markSent(row, primary, id);
      if (primary.kind === 'configured' && settings) await afterConfiguredSuccess(settings);
      return 'sent';
    } catch (error) {
      const code = classifyMailError(error);
      if (primary.kind !== 'configured' || !fallback) return recordFailure(row, code, error);
      useFallbackFor = code;
      console.warn('[mail] configured sender failed, using fallback', code);
    }
  }

  try {
    const { id } = await attempt(row, fallback!);
    await markSent(row, fallback!, id);
    if (settings) await noteFallback(settings, useFallbackFor);
    return 'sent';
  } catch (error) {
    return recordFailure(row, classifyMailError(error), error);
  }
}

async function recordFailure(row: OutboxRow, code: MailErrorCode, error: unknown): Promise<'failed'> {
  // The claim already counted this attempt.
  const attempts = row.attempts;
  const retry = isTransient(code) && attempts < MAX_ATTEMPTS;
  const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 500);
  await dbAdmin
    .update(emailOutbox)
    .set({
      status: 'failed',
      lockedUntil: null,
      errorCode: code,
      errorMessage: message,
      // A permanent error stops here; a transient one waits for the next slot.
      ...(retry
        ? { nextAttemptAt: new Date(Date.now() + RETRY_MINUTES[Math.min(attempts, RETRY_MINUTES.length) - 1]! * 60_000) }
        : { attempts: MAX_ATTEMPTS }),
    })
    .where(eq(emailOutbox.id, row.id));
  return 'failed';
}

async function afterConfiguredSuccess(settings: typeof mailSettings.$inferSelect) {
  await dbAdmin.update(mailSettings).set({ lastSuccessAt: new Date(), fallbackSince: null }).where(eq(mailSettings.id, settings.id));
  if (!settings.dailyLimit) return;
  const today = await sentToday(settings.organizationId);
  if (today < Math.ceil(settings.dailyLimit * LIMIT_WARNING_SHARE)) return;
  // Once per Riyadh day.
  const [claimed] = await dbAdmin
    .update(mailSettings)
    .set({ limitWarnedOn: sql`(now() at time zone 'Asia/Riyadh')::date` })
    .where(
      and(eq(mailSettings.id, settings.id), sql`${mailSettings.limitWarnedOn} is distinct from (now() at time zone 'Asia/Riyadh')::date`),
    )
    .returning({ id: mailSettings.id });
  if (claimed) await emitMailEvent(settings.organizationId, 'mail.limit_approaching', { sent: today, limit: settings.dailyLimit });
}

async function noteFallback(settings: typeof mailSettings.$inferSelect, reason: MailErrorCode | null) {
  // Alert once per spell: the first fallback after a configured success (or ever).
  const [claimed] = await dbAdmin
    .update(mailSettings)
    .set({ fallbackSince: new Date() })
    .where(and(eq(mailSettings.id, settings.id), sql`${mailSettings.fallbackSince} is null`))
    .returning({ id: mailSettings.id });
  if (claimed) await emitMailEvent(settings.organizationId, 'mail.fallback_used', { errorCode: reason ?? 'unknown' });
}

/** Cron step: retries due messages and drops the log after 90 days. */
export async function runMailSweep(): Promise<{ sent: number; failed: number; deferred: number; purged: number }> {
  let total = { sent: 0, failed: 0, deferred: 0 };
  for (let i = 0; i < 10; i++) {
    const r = await processEmailQueue({ limit: 50 });
    total = { sent: total.sent + r.sent, failed: total.failed + r.failed, deferred: total.deferred + r.deferred };
    if (r.sent + r.failed + r.deferred < 50) break;
  }
  const purged = await dbAdmin
    .delete(emailOutbox)
    .where(lt(emailOutbox.createdAt, new Date(Date.now() - OUTBOX_RETENTION_DAYS * 86_400_000)))
    .returning({ id: emailOutbox.id });
  return { ...total, purged: purged.length };
}
