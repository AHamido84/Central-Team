import 'server-only';

import { eq, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db/client';
import { campaigns } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import type { CampaignHealth } from '@/modules/campaigns/constants';
import { analyzeCampaign, type CampaignAnalysis } from '@/modules/campaigns/metrics';
import { loadKpis, loadMetricRows, shapeOf } from '@/modules/campaigns/snapshot';

export { buildReportSnapshot, loadKpis, loadMetricRows, shapeOf } from '@/modules/campaigns/snapshot';

const alerting: readonly CampaignHealth[] = ['at_risk', 'off_track'];

/**
 * Recomputes a campaign's cached health after its metrics, KPIs, budget or dates change, and emits
 * `campaign.health_changed` when it gets worse than what the owner was last told (so an alert fires once per change).
 * Runs as the caller (RLS) or as the sweep (service connection).
 */
export async function refreshCampaignHealth(tx: Tx, campaignId: string, actorId: string | null): Promise<CampaignAnalysis | null> {
  const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) return null;
  const [kpis, rows] = await Promise.all([loadKpis(tx, [c.id]), loadMetricRows(tx, [c.id], { from: c.startDate, to: c.endDate })]);
  const analysis = analyzeCampaign(shapeOf(c, kpis), rows);
  const live = c.status === 'active' || c.status === 'paused';
  let notified = c.healthNotified;
  if (live && alerting.includes(analysis.health) && analysis.health !== c.healthNotified) {
    await emitEvent(tx, {
      type: 'campaign.health_changed',
      organizationId: c.organizationId,
      actorId,
      aggregate: { type: 'campaign', id: c.id },
      clientId: c.clientId,
      payload: { campaignId: c.id, clientId: c.clientId, from: c.healthNotified ?? c.health, to: analysis.health },
    });
    notified = analysis.health;
  } else if (analysis.health === 'on_track') {
    // Back on track: the next slip alerts again.
    notified = null;
  }
  if (analysis.health !== c.health || analysis.through !== c.metricsThrough || notified !== c.healthNotified) {
    await tx.execute(sql`select app.campaign_store_health(${c.id}::uuid, ${analysis.health}, ${analysis.through}::date, ${notified})`);
  }
  return analysis;
}
