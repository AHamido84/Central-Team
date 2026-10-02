import 'server-only';

import { and, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';

import { ActionFailure } from '@/lib/actions/errors';
import { dbAdmin, type Tx } from '@/lib/db/client';
import { aiInsights, aiRecommendations, clients, organizations, reportSections, reports } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { localized, type Locale } from '@/lib/i18n/localized';
import { textKit } from '@/modules/ai/kit';
import { reportFacts, reportPrompt } from '@/modules/ai/prompts';
import { generate, loadAiSettings } from '@/modules/ai/server/runtime';
import { buildReportSnapshot } from '@/modules/campaigns/server/analysis';

export type DraftSection = 'commentary' | 'next_steps';

export type PreparedDraft = {
  reportId: string;
  clientId: string;
  locale: Locale;
  lines: Record<DraftSection, string[]>;
  meta: { client: string; period: string };
};

/**
 * Facts for a report's AI draft (ADR-077), read in the caller's transaction: the user's (RLS) from the builder, the
 * service connection for scheduled drafts. Uses the report's own snapshot and the period's warning / critical insights.
 */
export async function prepareReportDraft(tx: Tx, reportId: string, timeZone: string): Promise<PreparedDraft> {
  const [r] = await tx
    .select({ r: reports, client: clients.name })
    .from(reports)
    .innerJoin(clients, eq(clients.id, reports.clientId))
    .where(eq(reports.id, reportId));
  if (!r) throw new ActionFailure('not_found');
  if (r.r.status === 'published') throw new ActionFailure('report_published');
  const locale: Locale = r.r.locale === 'en' ? 'en' : 'ar';
  const snapshot = await buildReportSnapshot(tx, {
    clientId: r.r.clientId,
    campaignId: r.r.campaignId,
    periodStart: r.r.periodStart,
    periodEnd: r.r.periodEnd,
  });
  const campaignIds = snapshot.campaigns.map((c) => c.id);
  const insightRows = campaignIds.length
    ? await tx
        .select()
        .from(aiInsights)
        .where(
          and(
            inArray(aiInsights.campaignId, campaignIds),
            ne(aiInsights.status, 'dismissed'),
            gte(aiInsights.detectedOn, r.r.periodStart),
            lte(aiInsights.detectedOn, r.r.periodEnd),
            sql`${aiInsights.severity} <> 'info'`,
          ),
        )
        .limit(8)
    : [];
  const recRows = insightRows.length
    ? await tx
        .select()
        .from(aiRecommendations)
        .where(
          and(
            inArray(
              aiRecommendations.insightId,
              insightRows.map((i) => i.id),
            ),
            ne(aiRecommendations.status, 'dismissed'),
          ),
        )
    : [];
  const kit = textKit(locale, timeZone);
  const facts = reportFacts(
    kit,
    snapshot,
    insightRows.map((i) => ({
      insight: { kind: i.kind, metric: i.metric, facts: i.facts },
      recs: recRows.filter((x) => x.insightId === i.id),
    })),
  );
  return {
    reportId: r.r.id,
    clientId: r.r.clientId,
    locale,
    lines: { commentary: facts.commentary, next_steps: facts.nextSteps },
    meta: { client: localized(r.client, locale), period: `${r.r.periodStart} → ${r.r.periodEnd}` },
  };
}

/** One section's draft from prepared facts (model call + usage + `ai_report.drafted`). */
export async function writeReportDraft(
  prepared: PreparedDraft,
  section: DraftSection,
  ctx: { organizationId: string; userId: string | null },
): Promise<string> {
  const result = await generate(ctx, reportPrompt(prepared.locale, section, prepared.lines[section], prepared.meta));
  if (result.stop === 'refusal' || !result.text) throw new ActionFailure('ai_refused');
  await dbAdmin.transaction((tx) =>
    emitEvent(tx, {
      type: 'ai_report.drafted',
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      aggregate: { type: 'report', id: prepared.reportId },
      clientId: prepared.clientId,
      payload: { reportId: prepared.reportId, clientId: prepared.clientId, section },
    }),
  );
  return result.text.slice(0, 10000);
}

/**
 * Scheduled drafts (`report.draft_ready`) get AI text in their empty commentary / next-steps sections when the
 * organization turned `auto_draft_reports` on. Service path: the schedule acts for the organization, like the sweep
 * that generated the draft; the report stays a draft for the team to review.
 */
export async function autoDraftScheduledReport(organizationId: string, reportId: string): Promise<number> {
  const settings = await loadAiSettings(organizationId);
  if (!settings.enabled || !settings.autoDraftReports) return 0;
  const sections = await dbAdmin
    .select()
    .from(reportSections)
    .where(and(eq(reportSections.reportId, reportId), inArray(reportSections.kind, ['commentary', 'next_steps'])));
  const empty = sections.filter((s) => s.body.trim() === '');
  if (!empty.length) return 0;
  const [org] = await dbAdmin.select({ tz: organizations.defaultTimezone }).from(organizations).where(eq(organizations.id, organizationId));
  let prepared: PreparedDraft;
  try {
    prepared = await dbAdmin.transaction((tx) => prepareReportDraft(tx, reportId, org?.tz ?? 'Asia/Riyadh'));
  } catch (error) {
    if (error instanceof ActionFailure) return 0;
    throw error;
  }
  let written = 0;
  for (const s of empty) {
    try {
      const text = await writeReportDraft(prepared, s.kind as DraftSection, { organizationId, userId: null });
      await dbAdmin.update(reportSections).set({ body: text }).where(eq(reportSections.id, s.id));
      written++;
    } catch (error) {
      // Budget, refusal or provider trouble: leave the section empty for the team.
      if (!(error instanceof ActionFailure)) throw error;
    }
  }
  return written;
}
