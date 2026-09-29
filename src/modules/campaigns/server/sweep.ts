import 'server-only';

import { and, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { createTranslator } from 'next-intl';

import { dbAdmin } from '@/lib/db/client';
import { campaigns, organizations, reportSchedules, reportSections, reports } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { createFormatters } from '@/lib/i18n/format';
import { loadMessages } from '@/i18n/messages';
import { STALE_METRICS_DAYS } from '@/modules/campaigns/constants';
import { addDays, daysBetween } from '@/modules/campaigns/metrics';
import { defaultReportSections, nextRunAfter, periodEndingBefore } from '@/modules/campaigns/periods';
import { buildReportSnapshot, refreshCampaignHealth } from '@/modules/campaigns/server/analysis';
import { dayInZone } from '@/modules/tasks/constants';

export type CampaignSweepResult = { started: number; completed: number; stale: number; reports: number };

/**
 * Daily campaign upkeep, run from the cron route with the service connection (listed service path, CLAUDE.md §6):
 * planned → active on the start date and active → completed after the end date, health refresh for live campaigns,
 * a "no new numbers" reminder once per stale spell, and scheduled reports for periods that just ended. It only writes
 * campaign state, reports and domain events; notifications come from the event consumers.
 */
export async function runCampaignSweep(now = new Date()): Promise<CampaignSweepResult> {
  const result: CampaignSweepResult = { started: 0, completed: 0, stale: 0, reports: 0 };
  const orgs = await dbAdmin.select({ id: organizations.id, tz: organizations.defaultTimezone }).from(organizations);
  for (const org of orgs) {
    const today = dayInZone(now, org.tz);
    await dbAdmin.transaction(async (tx) => {
      const toStart = await tx
        .select({ id: campaigns.id, clientId: campaigns.clientId, status: campaigns.status })
        .from(campaigns)
        .where(and(eq(campaigns.organizationId, org.id), eq(campaigns.status, 'planned'), lte(campaigns.startDate, today)));
      const toComplete = await tx
        .select({ id: campaigns.id, clientId: campaigns.clientId, status: campaigns.status })
        .from(campaigns)
        .where(and(eq(campaigns.organizationId, org.id), inArray(campaigns.status, ['active', 'paused']), lt(campaigns.endDate, today)));
      if (toStart.length)
        await tx
          .update(campaigns)
          .set({ status: 'active' })
          .where(
            inArray(
              campaigns.id,
              toStart.map((c) => c.id),
            ),
          );
      if (toComplete.length)
        await tx
          .update(campaigns)
          .set({ status: 'completed' })
          .where(
            inArray(
              campaigns.id,
              toComplete.map((c) => c.id),
            ),
          );
      const changes = [
        ...toStart.map((c) => ({ ...c, from: c.status, to: 'active' })),
        ...toComplete.map((c) => ({ ...c, from: c.status, to: 'completed' })),
      ];
      for (const c of changes) {
        if (c.to === 'active') result.started++;
        else result.completed++;
        await emitEvent(tx, {
          type: 'campaign.status_changed',
          organizationId: org.id,
          actorId: null,
          aggregate: { type: 'campaign', id: c.id },
          clientId: c.clientId,
          payload: { campaignId: c.id, clientId: c.clientId, from: c.from, to: c.to },
        });
      }

      const live = await tx
        .select({ id: campaigns.id })
        .from(campaigns)
        .where(and(eq(campaigns.organizationId, org.id), inArray(campaigns.status, ['active', 'paused'])));
      for (const c of live) await refreshCampaignHealth(tx, c.id, null);

      // Stale: an active campaign that started a while ago with no numbers for STALE_METRICS_DAYS.
      const cutoff = addDays(today, -STALE_METRICS_DAYS);
      const stale = await tx
        .update(campaigns)
        .set({ staleNotifiedAt: now })
        .where(
          and(
            eq(campaigns.organizationId, org.id),
            eq(campaigns.status, 'active'),
            lte(campaigns.startDate, cutoff),
            isNull(campaigns.staleNotifiedAt),
            or(isNull(campaigns.metricsThrough), lt(campaigns.metricsThrough, cutoff)),
          ),
        )
        .returning({ id: campaigns.id, clientId: campaigns.clientId, through: campaigns.metricsThrough, start: campaigns.startDate });
      for (const c of stale) {
        result.stale++;
        await emitEvent(tx, {
          type: 'campaign.metrics_stale',
          organizationId: org.id,
          actorId: null,
          aggregate: { type: 'campaign', id: c.id },
          clientId: c.clientId,
          payload: {
            campaignId: c.id,
            clientId: c.clientId,
            lastDate: c.through,
            days: daysBetween(c.through ?? addDays(c.start, -1), today),
          },
        });
      }

      // Scheduled reports for periods that just ended.
      const due = await tx
        .select({ s: reportSchedules, campaignName: campaigns.name })
        .from(reportSchedules)
        .leftJoin(campaigns, eq(campaigns.id, reportSchedules.campaignId))
        .where(and(eq(reportSchedules.organizationId, org.id), eq(reportSchedules.isActive, true), lte(reportSchedules.nextRunOn, today)));
      for (const { s, campaignName } of due) {
        const period = periodEndingBefore(s.cadence as 'weekly' | 'monthly', s.nextRunOn);
        const locale = s.locale === 'en' ? 'en' : 'ar';
        const t = createTranslator({ locale, messages: await loadMessages(locale), namespace: 'reports' });
        const f = createFormatters({ locale, timeZone: org.tz });
        const noon = (iso: string) => `${iso}T12:00:00Z`;
        const base =
          s.cadence === 'monthly'
            ? t('autoTitle.monthly', { period: f.monthYear(noon(period.start)) })
            : t('autoTitle.weekly', { period: `${f.date(noon(period.start))} – ${f.date(noon(period.end))}` });
        const title = campaignName ? t('autoTitle.campaign', { campaign: campaignName, title: base }) : base;
        const publish = s.autoPublish;
        // Always inserted as a draft: sections can only be written while the report isn't published.
        const [report] = await tx
          .insert(reports)
          .values({
            organizationId: org.id,
            clientId: s.clientId,
            campaignId: s.campaignId,
            scheduleId: s.id,
            title: title.slice(0, 200),
            periodStart: period.start,
            periodEnd: period.end,
            locale,
            createdBy: s.createdBy,
          })
          .returning({ id: reports.id });
        const sections = s.sections.length ? s.sections : defaultReportSections;
        await tx.insert(reportSections).values(
          sections.map((sec, i) => ({
            reportId: report!.id,
            organizationId: org.id,
            clientId: s.clientId,
            kind: sec.kind,
            config: sec.config ?? {},
            sortOrder: i,
          })),
        );
        if (publish) {
          const snapshot = await buildReportSnapshot(tx, {
            clientId: s.clientId,
            campaignId: s.campaignId,
            periodStart: period.start,
            periodEnd: period.end,
          });
          await tx.update(reports).set({ status: 'published', snapshot, publishedAt: now }).where(eq(reports.id, report!.id));
        }
        await tx
          .update(reportSchedules)
          .set({ lastRunAt: now, nextRunOn: nextRunAfter(s.cadence as 'weekly' | 'monthly', s.nextRunOn) })
          .where(eq(reportSchedules.id, s.id));
        await emitEvent(tx, {
          type: publish ? 'report.published' : 'report.draft_ready',
          organizationId: org.id,
          actorId: null,
          aggregate: { type: 'report', id: report!.id },
          clientId: s.clientId,
          payload: publish
            ? { reportId: report!.id, clientId: s.clientId }
            : { reportId: report!.id, clientId: s.clientId, scheduleId: s.id },
        });
        result.reports++;
      }
    });
  }
  return result;
}
