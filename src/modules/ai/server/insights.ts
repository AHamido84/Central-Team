import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { organizations } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { analyzeCampaignInsights, campaignsToAnalyze, type AnalysisResult } from '@/modules/ai/analysis';
import type { Sensitivity } from '@/modules/ai/insights-core';
import { loadAiSettings } from '@/modules/ai/server/runtime';
import { dayInZone } from '@/modules/tasks/constants';

async function orgContext(organizationId: string): Promise<{ on: boolean; today: string; sensitivity: Sensitivity }> {
  const [org] = await dbAdmin
    .select({ tz: organizations.defaultTimezone, on: sql<boolean>`app.feature_enabled(${organizations.id}, 'module.ai')` })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  const settings = await loadAiSettings(organizationId);
  return {
    on: Boolean(org?.on),
    today: dayInZone(new Date(), org?.tz ?? 'Asia/Riyadh'),
    sensitivity: settings.sensitivity as Sensitivity,
  };
}

/**
 * Runs the detectors for one campaign (service path: the analysis consumer and the cron act for the whole
 * organization, like the campaign sweep). Detection is code, not AI, so it runs even when the AI switch is off.
 */
export async function runCampaignAnalysis(campaignId: string): Promise<AnalysisResult | null> {
  const [row] = await dbAdmin.execute<{ organization_id: string }>(
    sql`select organization_id from public.campaigns where id = ${campaignId}`,
  );
  if (!row) return null;
  const ctx = await orgContext(row.organization_id);
  if (!ctx.on) return null;
  return dbAdmin.transaction((tx) =>
    analyzeCampaignInsights(tx, campaignId, {
      today: ctx.today,
      sensitivity: ctx.sensitivity,
      emit: (organizationId, e) =>
        emitEvent(tx, {
          type: e.type,
          organizationId,
          actorId: null,
          aggregate: { type: 'campaign', id: e.payload.campaignId },
          clientId: e.payload.clientId,
          payload: e.payload as never,
        }).then(() => undefined),
    }),
  );
}

/** Cron step: every live campaign of every organization with the AI module on. */
export async function analyzeAllCampaigns(): Promise<{ campaigns: number; created: number; resolved: number }> {
  const out = { campaigns: 0, created: 0, resolved: 0 };
  const orgs = await dbAdmin.select({ id: organizations.id }).from(organizations);
  for (const org of orgs) {
    const ctx = await orgContext(org.id);
    if (!ctx.on) continue;
    const ids = await dbAdmin.transaction((tx) => campaignsToAnalyze(tx, org.id, ctx.today));
    for (const id of ids) {
      try {
        const r = await runCampaignAnalysis(id);
        out.campaigns++;
        out.created += (r?.created ?? 0) + (r?.reopened ?? 0);
        out.resolved += r?.resolved ?? 0;
      } catch (error) {
        console.error('[ai] campaign analysis failed', id, error);
      }
    }
  }
  return out;
}
