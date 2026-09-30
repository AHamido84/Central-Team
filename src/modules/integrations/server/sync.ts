import 'server-only';

import { and, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import {
  campaignChannels,
  campaigns,
  integrationAccounts,
  integrationCampaignLinks,
  integrationConnections,
  integrationSyncRuns,
  metricsDaily,
  organizations,
} from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { refreshCampaignHealth } from '@/modules/campaigns/server/analysis';
import { SYNC, terminalErrors, type ProviderErrorCode } from '@/modules/integrations/constants';
import { aggregateToChannels, flightDays } from '@/modules/integrations/metrics';
import { ProviderError } from '@/modules/integrations/providers/types';
import { serviceTx, withConnection } from '@/modules/integrations/server/connections';
import { addDays, dayInZone } from '@/modules/tasks/constants';

export type SyncRun = typeof integrationSyncRuns.$inferSelect;

type RunOutcome = { rows: number; campaigns: number };

/** Claims a due run (queued, or failed with attempts left) so two workers never pull the same range twice. */
async function claim(runId: string): Promise<SyncRun | null> {
  const [run] = await dbAdmin
    .update(integrationSyncRuns)
    .set({ status: 'running', attempts: sql`${integrationSyncRuns.attempts} + 1`, startedAt: new Date(), finishedAt: null })
    .where(
      and(
        eq(integrationSyncRuns.id, runId),
        or(
          eq(integrationSyncRuns.status, 'queued'),
          and(eq(integrationSyncRuns.status, 'failed'), sql`${integrationSyncRuns.attempts} < ${SYNC.maxAttempts}`),
        ),
        lte(integrationSyncRuns.nextAttemptAt, new Date()),
      ),
    )
    .returning();
  return run ?? null;
}

/**
 * Pulls one run's range from the platform and writes `metrics_daily` (ADR-069):
 * accounts = the run's account, or every sync-enabled ad account of the connection that is mapped to a client;
 * for each, the platform campaigns linked to one of our channels are fetched per day, summed per channel and
 * upserted on (channel, day) with `source = 'api'` — days in the campaign's flight with no platform row become zeros.
 * The same range always ends in the same rows, so re-running (retries, overlapping scheduled runs) is safe.
 */
async function pull(run: SyncRun): Promise<RunOutcome> {
  return withConnection(run.connectionId, async ({ connection, provider, ctx }) => {
    if (!provider.fetchDailyMetrics) return { rows: 0, campaigns: 0 };
    const accounts = await dbAdmin
      .select()
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.connectionId, connection.id),
          eq(integrationAccounts.kind, 'ad_account'),
          isNotNull(integrationAccounts.clientId),
          run.accountId ? eq(integrationAccounts.id, run.accountId) : eq(integrationAccounts.syncEnabled, true),
        ),
      );
    let rowsWritten = 0;
    const touched = new Set<string>();
    for (const account of accounts) {
      const links = await dbAdmin
        .select({
          externalCampaignId: integrationCampaignLinks.externalCampaignId,
          channelId: campaignChannels.id,
          campaignId: campaigns.id,
          clientId: campaigns.clientId,
          startDate: campaigns.startDate,
          endDate: campaigns.endDate,
        })
        .from(integrationCampaignLinks)
        .innerJoin(campaignChannels, eq(campaignChannels.id, integrationCampaignLinks.channelId))
        .innerJoin(campaigns, eq(campaigns.id, campaignChannels.campaignId))
        .where(and(eq(integrationCampaignLinks.accountId, account.id), eq(campaigns.clientId, account.clientId!)));
      if (!links.length) continue;

      const rows = await provider.fetchDailyMetrics(
        ctx,
        {
          externalId: account.externalId,
          kind: 'ad_account',
          metadata: { ...account.metadata, ...(account.timezone ? { timezone: account.timezone } : {}) },
        },
        { campaignIds: [...new Set(links.map((l) => l.externalCampaignId))], from: run.dateFrom, to: run.dateTo },
      );
      const channelByCampaign = new Map(links.map((l) => [l.externalCampaignId, l.channelId]));
      const channelInfo = new Map(links.map((l) => [l.channelId, l]));
      const channelDays = new Map(
        [...channelInfo.values()].map((l) => [l.channelId, flightDays(run.dateFrom, run.dateTo, l.startDate, l.endDate)]),
      );
      const perChannel = aggregateToChannels(rows, channelByCampaign, channelDays);

      await serviceTx(null, async (tx) => {
        for (const [channelId, days] of perChannel) {
          const info = channelInfo.get(channelId)!;
          const values = [...days].map(([date, d]) => ({
            organizationId: connection.organizationId,
            clientId: info.clientId,
            campaignId: info.campaignId,
            channelId,
            date,
            ...d,
            source: 'api' as const,
            importId: null,
            updatedBy: null,
          }));
          if (!values.length) continue;
          await tx
            .insert(metricsDaily)
            .values(values)
            .onConflictDoUpdate({
              target: [metricsDaily.channelId, metricsDaily.date],
              set: {
                impressions: sql`excluded.impressions`,
                reach: sql`excluded.reach`,
                clicks: sql`excluded.clicks`,
                spendMinor: sql`excluded.spend_minor`,
                conversions: sql`excluded.conversions`,
                leads: sql`excluded.leads`,
                videoViews: sql`excluded.video_views`,
                engagements: sql`excluded.engagements`,
                revenueMinor: sql`excluded.revenue_minor`,
                source: sql`excluded.source`,
                importId: null,
                updatedBy: null,
                updatedAt: new Date(),
              },
            });
          rowsWritten += values.length;
          touched.add(info.campaignId);
        }
        await tx.update(integrationAccounts).set({ lastSyncedAt: new Date() }).where(eq(integrationAccounts.id, account.id));
      });
    }

    await serviceTx(null, async (tx) => {
      for (const campaignId of touched) {
        await refreshCampaignHealth(tx, campaignId, null);
        const [c] = await tx.select({ clientId: campaigns.clientId }).from(campaigns).where(eq(campaigns.id, campaignId));
        await emitEvent(tx, {
          type: 'metrics.synced',
          organizationId: connection.organizationId,
          actorId: null,
          aggregate: { type: 'campaign', id: campaignId },
          clientId: c!.clientId,
          payload: {
            campaignId,
            clientId: c!.clientId,
            runId: run.id,
            rows: rowsWritten,
            from: run.dateFrom,
            to: run.dateTo,
          },
        });
      }
      await tx.update(integrationConnections).set({ lastSyncedAt: new Date() }).where(eq(integrationConnections.id, connection.id));
    });
    return { rows: rowsWritten, campaigns: touched.size };
  });
}

/** Executes a run now if it is due. Returns the final state (or null if another worker has it / not due). */
export async function executeSyncRun(runId: string): Promise<SyncRun | null> {
  const run = await claim(runId);
  if (!run) return null;
  try {
    const outcome = await pull(run);
    const [done] = await dbAdmin
      .update(integrationSyncRuns)
      .set({
        status: 'succeeded',
        rowsWritten: outcome.rows,
        campaigns: outcome.campaigns,
        errorCode: null,
        errorMessage: null,
        finishedAt: new Date(),
      })
      .where(eq(integrationSyncRuns.id, run.id))
      .returning();
    return done ?? null;
  } catch (error) {
    const failure = error instanceof ProviderError ? error : new ProviderError('platform_error', String(error));
    if (!(error instanceof ProviderError)) console.error('[integrations] sync run crashed', run.id, error);
    const final = terminalErrors.includes(failure.code as ProviderErrorCode) || run.attempts >= SYNC.maxAttempts;
    const delay = SYNC.retryMinutes[Math.min(run.attempts - 1, SYNC.retryMinutes.length - 1)] ?? 60;
    return serviceTx(null, async (tx) => {
      const [failed] = await tx
        .update(integrationSyncRuns)
        .set({
          status: 'failed',
          errorCode: failure.code,
          errorMessage: failure.detail.slice(0, 500),
          finishedAt: new Date(),
          // A final failure keeps attempts at the maximum so the retry query skips it.
          attempts: final ? SYNC.maxAttempts : run.attempts,
          nextAttemptAt: new Date(Date.now() + delay * 60_000),
        })
        .where(eq(integrationSyncRuns.id, run.id))
        .returning();
      if (final) {
        const [c] = await tx
          .select({ provider: integrationConnections.provider })
          .from(integrationConnections)
          .where(eq(integrationConnections.id, run.connectionId));
        await emitEvent(tx, {
          type: 'integration.sync_failed',
          organizationId: run.organizationId,
          actorId: null,
          aggregate: { type: 'integration_connection', id: run.connectionId },
          payload: { runId: run.id, connectionId: run.connectionId, provider: c?.provider ?? '', errorCode: failure.code },
        });
      }
      return failed ?? null;
    });
  }
}

/** Queued runs and failed runs whose retry is due, oldest first. */
export async function processDueSyncRuns(limit = 20): Promise<{ succeeded: number; failed: number }> {
  const due = await dbAdmin
    .select({ id: integrationSyncRuns.id })
    .from(integrationSyncRuns)
    .where(
      and(
        lte(integrationSyncRuns.nextAttemptAt, new Date()),
        or(
          eq(integrationSyncRuns.status, 'queued'),
          and(eq(integrationSyncRuns.status, 'failed'), sql`${integrationSyncRuns.attempts} < ${SYNC.maxAttempts}`),
        ),
      ),
    )
    .orderBy(integrationSyncRuns.createdAt)
    .limit(limit);
  const result = { succeeded: 0, failed: 0 };
  for (const { id } of due) {
    const run = await executeSyncRun(id);
    if (run?.status === 'succeeded') result.succeeded++;
    else if (run?.status === 'failed') result.failed++;
  }
  return result;
}

/**
 * Daily: one scheduled run per connected connection that has a sync-enabled, client-mapped ad account, covering the
 * last `SYNC.scheduledDays` days in the organization's time zone. Idempotent per connection and day.
 */
export async function scheduleDailySyncs(now = new Date()): Promise<number> {
  const candidates = await dbAdmin
    .selectDistinct({
      id: integrationConnections.id,
      organizationId: integrationConnections.organizationId,
      tz: organizations.defaultTimezone,
    })
    .from(integrationConnections)
    .innerJoin(organizations, eq(organizations.id, integrationConnections.organizationId))
    .innerJoin(integrationAccounts, eq(integrationAccounts.connectionId, integrationConnections.id))
    .where(
      and(
        eq(integrationConnections.status, 'connected'),
        eq(integrationAccounts.syncEnabled, true),
        eq(integrationAccounts.kind, 'ad_account'),
        isNotNull(integrationAccounts.clientId),
      ),
    );
  let created = 0;
  for (const c of candidates) {
    const today = dayInZone(now, c.tz);
    const from = addDays(today, -(SYNC.scheduledDays - 1));
    const [exists] = await dbAdmin
      .select({ id: integrationSyncRuns.id })
      .from(integrationSyncRuns)
      .where(
        and(
          eq(integrationSyncRuns.connectionId, c.id),
          eq(integrationSyncRuns.trigger, 'scheduled'),
          eq(integrationSyncRuns.dateTo, today),
        ),
      );
    if (exists) continue;
    await dbAdmin.insert(integrationSyncRuns).values({
      organizationId: c.organizationId,
      connectionId: c.id,
      trigger: 'scheduled',
      dateFrom: from,
      dateTo: today,
    });
    created++;
  }
  return created;
}

/** Runs ids in the background of a request (after the response) — used by "Sync now" and "Backfill". */
export async function executeRunsQuietly(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await executeSyncRun(id);
    } catch (error) {
      console.error('[integrations] sync run failed to execute', id, error);
    }
  }
}

export async function runIdsFor(connectionIds: string[]): Promise<string[]> {
  if (!connectionIds.length) return [];
  const rows = await dbAdmin
    .select({ id: integrationSyncRuns.id })
    .from(integrationSyncRuns)
    .where(and(inArray(integrationSyncRuns.connectionId, connectionIds), eq(integrationSyncRuns.status, 'queued')));
  return rows.map((r) => r.id);
}
