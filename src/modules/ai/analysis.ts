/**
 * Runs the detectors for one campaign and reconciles `ai_insights` / `ai_recommendations` (ADR-074): new findings are
 * inserted, known ones refreshed, cleared conditions resolved and returning ones reopened — idempotent per dedupe key.
 * Deliberately not `server-only` (like `campaigns/snapshot.ts`): the seed runs it too. Callers pass `emit` to record
 * domain events in the same transaction.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db/client';
import { aiInsights, aiRecommendations, campaignChannels, campaigns } from '@/lib/db/schema';
import type { DomainEventPayloads } from '@/lib/events/registry';
import {
  channelStats,
  detectInsights,
  isHistoric,
  recommend,
  type InsightKind,
  type InsightSeverity,
  type Sensitivity,
} from '@/modules/ai/insights-core';
import { addDays } from '@/modules/campaigns/metrics';
import { loadKpis, loadMetricRows, shapeOf } from '@/modules/campaigns/snapshot';
import { liveClient } from '@/lib/db/live';

export type AnalysisEvent =
  | { type: 'ai_insight.detected'; payload: DomainEventPayloads['ai_insight.detected'] }
  | { type: 'ai_insight.status_changed'; payload: DomainEventPayloads['ai_insight.status_changed'] };

export type AnalysisResult = { detected: number; created: number; reopened: number; resolved: number };

const rank: Record<InsightSeverity, number> = { info: 0, warning: 1, critical: 2 };

/** Statuses that still count as "known" (a returning condition doesn't notify again unless it was resolved). */
const live = ['open', 'acknowledged', 'dismissed'] as const;

export async function analyzeCampaignInsights(
  tx: Tx,
  campaignId: string,
  opts: { today: string; sensitivity: Sensitivity; emit?: (organizationId: string, event: AnalysisEvent) => Promise<void> },
): Promise<AnalysisResult> {
  const result: AnalysisResult = { detected: 0, created: 0, reopened: 0, resolved: 0 };
  const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c) return result;
  const [kpis, channels, rows] = await Promise.all([
    loadKpis(tx, [c.id]),
    tx
      .select({ id: campaignChannels.id, platform: campaignChannels.platform, name: campaignChannels.name })
      .from(campaignChannels)
      .where(eq(campaignChannels.campaignId, c.id)),
    loadMetricRows(tx, [c.id], { from: c.startDate < addDays(opts.today, -60) ? addDays(opts.today, -60) : c.startDate, to: opts.today }),
  ]);
  // Pacing needs the whole flight; the anomaly window needs only the last weeks (loaded above for long flights).
  const flightRows = c.startDate < addDays(opts.today, -60) ? await loadMetricRows(tx, [c.id], { from: c.startDate, to: c.endDate }) : rows;
  const input = {
    campaign: { ...shapeOf(c, kpis), id: c.id, status: c.status, currency: c.currency },
    channels,
    rows: flightRows,
    today: opts.today,
    sensitivity: opts.sensitivity,
  };
  const found = detectInsights(input);
  result.detected = found.length;
  const ctx = { currency: c.currency, channels: channelStats(channels, flightRows, opts.today) };

  const existing = await tx.select().from(aiInsights).where(eq(aiInsights.campaignId, c.id));
  const byKey = new Map(existing.map((i) => [i.dedupeKey, i]));
  const now = new Date();
  const seen = new Set<string>();

  for (const f of found) {
    seen.add(f.dedupeKey);
    const prior = byKey.get(f.dedupeKey);
    let insightId: string;
    let notify: { reopened: boolean } | null = null;
    const detection = {
      kind: f.kind,
      metric: f.metric,
      channelId: f.channelId,
      severity: f.severity,
      detectedOn: f.detectedOn,
      facts: f.facts,
      lastDetectedAt: now,
    };
    if (!prior) {
      insightId = crypto.randomUUID();
      await tx.insert(aiInsights).values({
        id: insightId,
        organizationId: c.organizationId,
        clientId: c.clientId,
        campaignId: c.id,
        dedupeKey: f.dedupeKey,
        status: 'open',
        firstDetectedAt: now,
        ...detection,
      });
      result.created++;
      notify = { reopened: false };
    } else {
      insightId = prior.id;
      const reopen = prior.status === 'resolved';
      await tx
        .update(aiInsights)
        .set({
          ...detection,
          ...(reopen
            ? { status: 'open', resolvedAt: null, dismissReason: null, actedBy: null, actedAt: null, explanation: null, explainedAt: null }
            : {}),
          // A changed finding invalidates the cached narrative.
          ...(!reopen && (prior.kind !== f.kind || prior.severity !== f.severity) ? { explanation: null, explainedAt: null } : {}),
        })
        .where(eq(aiInsights.id, prior.id));
      if (reopen) {
        result.reopened++;
        notify = { reopened: true };
      } else if (prior.status !== 'dismissed' && rank[f.severity] > rank[prior.severity as InsightSeverity]) {
        notify = { reopened: false };
      }
    }
    for (const r of recommend(f, ctx)) {
      await tx
        .insert(aiRecommendations)
        .values({ organizationId: c.organizationId, insightId, clientId: c.clientId, campaignId: c.id, kind: r.kind, facts: r.facts })
        .onConflictDoUpdate({
          target: [aiRecommendations.insightId, aiRecommendations.kind],
          set: { facts: r.facts, updatedAt: now },
          setWhere: eq(aiRecommendations.status, 'proposed'),
        });
    }
    if (notify && opts.emit) {
      await opts.emit(c.organizationId, {
        type: 'ai_insight.detected',
        payload: {
          insightId,
          campaignId: c.id,
          clientId: c.clientId,
          insightKind: f.kind,
          severity: f.severity,
          metric: f.metric,
          reopened: notify.reopened,
        },
      });
    }
  }

  // Cleared conditions resolve; one-day anomalies resolve once they are history.
  const toResolve = existing.filter(
    (i) =>
      (live as readonly string[]).includes(i.status) &&
      !seen.has(i.dedupeKey) &&
      (!['spike', 'drop'].includes(i.kind) || isHistoric(i.kind as InsightKind, i.detectedOn, opts.today)),
  );
  if (toResolve.length) {
    await tx
      .update(aiInsights)
      .set({ status: 'resolved', resolvedAt: now })
      .where(
        inArray(
          aiInsights.id,
          toResolve.map((i) => i.id),
        ),
      );
    result.resolved = toResolve.length;
    if (opts.emit) {
      for (const i of toResolve) {
        await opts.emit(c.organizationId, {
          type: 'ai_insight.status_changed',
          payload: { insightId: i.id, campaignId: c.id, clientId: c.clientId, from: i.status, to: 'resolved' },
        });
      }
    }
  }
  return result;
}

/** Campaigns the daily analysis covers: live ones, and ones that ended in the last two weeks (late data). */
export async function campaignsToAnalyze(tx: Tx, organizationId: string, today: string): Promise<string[]> {
  const rows = await tx
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.organizationId, organizationId),
        liveClient(campaigns.clientId),
        sql`(${campaigns.status} in ('active','paused') or (${campaigns.status} = 'completed' and ${campaigns.endDate} >= ${addDays(today, -14)}::date))`,
      ),
    );
  return rows.map((r) => r.id);
}
