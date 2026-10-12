import 'server-only';

import { and, eq, lte } from 'drizzle-orm';

import type { AgencyContext } from '@/lib/auth/context';
import { dbAdmin } from '@/lib/db/client';
import { runWithSession } from '@/lib/db/rls';
import { executiveSchedules, organizations } from '@/lib/db/schema';
import { renderActionEmail } from '@/lib/email/send';
import { env } from '@/lib/env';
import { emitEvent } from '@/lib/events/emit';
import { scheduleEventDispatch } from '@/lib/events/schedule';
import { localized, type Locale } from '@/lib/i18n/localized';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { briefLines } from '@/modules/executive/brief';
import { viewSearch } from '@/modules/executive/config';
import { executiveKit } from '@/modules/executive/kit';
import { nextRunOn, schedulePreset, type Cadence } from '@/modules/executive/schedule-dates';
import { logExecutiveEvent } from '@/modules/executive/server/audit';
import { renderBoardFile } from '@/modules/executive/server/board-export';
import { agencyContextFor } from '@/modules/executive/server/run-as';
import type { ExecutiveViewConfig } from '@/modules/executive/types';
import { enqueueEmail, EXPORTS_BUCKET } from '@/modules/mail/server/outbox';
import { dayInZone } from '@/modules/tasks/constants';

type Schedule = typeof executiveSchedules.$inferSelect;

/**
 * Renders the board report PDF as `ctx` and queues one email per recipient with it attached (FR7, ADR-097). The file
 * is server-written to the private `exports` bucket and read back by the outbox when each message is sent.
 */
export async function deliverSchedule(
  ctx: AgencyContext,
  schedule: Pick<Schedule, 'id' | 'cadence' | 'locale' | 'recipients'>,
): Promise<number> {
  const locale: Locale = schedule.locale === 'en' ? 'en' : 'ar';
  const config: ExecutiveViewConfig = {
    tab: 'overview',
    preset: schedulePreset(schedule.cadence as Cadence),
    compare: 'previous',
    filters: {},
  };
  const file = await renderBoardFile(ctx, config, 'pdf', locale);
  const orgId = ctx.organization.id;
  const today = dayInZone(new Date(), ctx.organization.defaultTimezone);
  const storagePath = `${orgId}/${schedule.id}/${today}-${crypto.randomUUID().slice(0, 8)}.pdf`;
  // Service path: a server-generated file in a private bucket nobody can list; only the outbox reads it back.
  const { error } = await supabaseAdmin()
    .storage.from(EXPORTS_BUCKET)
    .upload(storagePath, file.data, { contentType: file.contentType, upsert: false });
  if (error) throw new Error(`exports upload failed: ${error.message}`);

  const kit = executiveKit(locale, ctx.organization.defaultTimezone);
  const { t, f } = kit;
  const organization = localized(ctx.organization.name, locale);
  const period = t('periodRange', {
    from: f.date(`${file.report.period.from}T12:00:00Z`),
    to: f.date(`${file.report.period.to}T12:00:00Z`),
  });
  const subject = t('email.subject', { organization, period });
  const { html, text } = await renderActionEmail({
    locale,
    brand: { name: ctx.organization.name, primaryColor: ctx.organization.brand?.primaryColor ?? null },
    subject,
    content: {
      heading: t('email.heading', { period }),
      paragraphs: [t('email.intro'), ...briefLines(kit, file.report).map((l) => l.text)],
      cta: { label: t('email.cta'), href: `${env().NEXT_PUBLIC_APP_URL}/executive${viewSearch(config)}` },
      note: t('email.note', { time: f.dateTime(new Date()) }),
    },
  });
  const recipients = [...new Set(schedule.recipients.map((r) => r.trim().toLowerCase()))];
  for (const to of recipients) {
    await enqueueEmail({
      organizationId: orgId,
      kind: 'report',
      to,
      locale,
      subject,
      html,
      text,
      tags: { schedule: schedule.id },
      createdBy: ctx.session.userId,
      attachments: [{ filename: file.filename, contentType: file.contentType, storagePath }],
    });
  }
  await logExecutiveEvent(
    'executive_schedule_sent',
    { scheduleId: schedule.id, recipients: recipients.length, period: file.report.period },
    ctx.session,
  );
  await dbAdmin.transaction((tx) =>
    emitEvent(tx, {
      type: 'executive.report_sent',
      organizationId: orgId,
      actorId: ctx.session.userId,
      aggregate: { type: 'executive_schedule', id: schedule.id },
      payload: { scheduleId: schedule.id, recipients: recipients.length },
    }),
  );
  scheduleEventDispatch();
  return recipients.length;
}

/**
 * Cron step: sends every active schedule due today (organization time zone). Each run is claimed by moving
 * `next_run_on` forward first, so overlapping sweeps never send twice. It runs as the schedule's creator — skipped
 * when they are gone or lost `executive:schedule` (service-path lookup, ADR-097).
 */
export async function runExecutiveSchedules(now = new Date()): Promise<{ sent: number; skipped: number; failed: number }> {
  const out = { sent: 0, skipped: 0, failed: 0 };
  const orgs = await dbAdmin.select({ id: organizations.id, tz: organizations.defaultTimezone }).from(organizations);
  for (const org of orgs) {
    const today = dayInZone(now, org.tz);
    const due = await dbAdmin
      .select()
      .from(executiveSchedules)
      .where(
        and(eq(executiveSchedules.organizationId, org.id), eq(executiveSchedules.isActive, true), lte(executiveSchedules.nextRunOn, today)),
      );
    for (const s of due) {
      const [claimed] = await dbAdmin
        .update(executiveSchedules)
        .set({ nextRunOn: nextRunOn(s.cadence as Cadence, today), lastRunAt: now })
        .where(and(eq(executiveSchedules.id, s.id), eq(executiveSchedules.nextRunOn, s.nextRunOn)))
        .returning({ id: executiveSchedules.id });
      if (!claimed) continue;
      const ctx = s.createdBy ? await agencyContextFor(s.createdBy, org.id, 'executive:schedule') : null;
      if (!ctx) {
        console.warn('[executive] schedule owner can no longer send it', s.id);
        out.skipped++;
        continue;
      }
      try {
        await runWithSession(ctx.session, () => deliverSchedule(ctx, s));
        out.sent++;
      } catch (error) {
        console.error('[executive] scheduled board report failed', s.id, error);
        out.failed++;
      }
    }
  }
  return out;
}
