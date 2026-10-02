import 'server-only';

import { and, eq, gt, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { integrationConnections } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { scheduleEventDispatch } from '@/lib/events/schedule';
import { EXPIRING_DAYS } from '@/modules/integrations/constants';
import { recordConnectionError, openConnection, serviceTx } from '@/modules/integrations/server/connections';
import { processDueSyncRuns, scheduleDailySyncs } from '@/modules/integrations/server/sync';
import { retryWebhookEvents } from '@/modules/integrations/server/webhooks';
import { retryFailedMessages } from '@/modules/integrations/server/whatsapp';

export type IntegrationSweepResult = {
  expired: number;
  expiring: number;
  scheduled: number;
  synced: number;
  syncFailed: number;
  webhooks: number;
  messages: number;
};

/**
 * Personal connections whose token expires within EXPIRING_DAYS (FR1.6): one warning to the owner per expiry date
 * (`expiry_notified_for` remembers it; a new token with a new expiry warns again).
 */
export async function warnExpiringPersonal(now: Date): Promise<number> {
  const soon = await dbAdmin
    .select({
      id: integrationConnections.id,
      organizationId: integrationConnections.organizationId,
      provider: integrationConnections.provider,
      ownerId: integrationConnections.ownerId,
      tokenExpiresAt: integrationConnections.tokenExpiresAt,
    })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.status, 'connected'),
        isNotNull(integrationConnections.ownerId),
        isNotNull(integrationConnections.tokenExpiresAt),
        gt(integrationConnections.tokenExpiresAt, now),
        lte(integrationConnections.tokenExpiresAt, new Date(now.getTime() + EXPIRING_DAYS * 86_400_000)),
        or(
          isNull(integrationConnections.expiryNotifiedFor),
          ne(integrationConnections.expiryNotifiedFor, integrationConnections.tokenExpiresAt),
        ),
      ),
    );
  for (const c of soon) {
    await serviceTx(null, async (tx) => {
      // Copied in SQL: a JS Date drops the microseconds and would never compare equal again.
      await tx
        .update(integrationConnections)
        .set({ expiryNotifiedFor: sql`${integrationConnections.tokenExpiresAt}` })
        .where(eq(integrationConnections.id, c.id));
      await emitEvent(tx, {
        type: 'integration.connection_expiring',
        organizationId: c.organizationId,
        actorId: null,
        aggregate: { type: 'integration_connection', id: c.id },
        payload: { connectionId: c.id, provider: c.provider, expiresAt: c.tokenExpiresAt!.toISOString() },
      });
    });
  }
  if (soon.length) scheduleEventDispatch();
  return soon.length;
}

/**
 * Cron step (service path, ADR-068/069): tokens past their expiry are refreshed (or the connection is marked expired
 * and its managers told once), the daily sync is scheduled, due and retrying sync runs execute, stuck webhook events
 * are processed again and failed WhatsApp sends get one retry.
 */
export async function runIntegrationSweep(now = new Date()): Promise<IntegrationSweepResult> {
  const result: IntegrationSweepResult = { expired: 0, expiring: 0, scheduled: 0, synced: 0, syncFailed: 0, webhooks: 0, messages: 0 };
  const due = await dbAdmin
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.status, 'connected'),
        isNotNull(integrationConnections.tokenExpiresAt),
        lte(integrationConnections.tokenExpiresAt, new Date(now.getTime() + 10 * 60_000)),
      ),
    );
  for (const c of due) {
    try {
      await openConnection(c.id); // refreshes when the platform allows it
    } catch (error) {
      const failure = await recordConnectionError(c.id, error);
      if (failure.code === 'auth_expired' || failure.code === 'auth_revoked') result.expired++;
    }
  }
  result.expiring = await warnExpiringPersonal(now);
  result.scheduled = await scheduleDailySyncs(now);
  const runs = await processDueSyncRuns();
  result.synced = runs.succeeded;
  result.syncFailed = runs.failed;
  result.webhooks = (await retryWebhookEvents()).processed;
  result.messages = await retryFailedMessages();
  return result;
}
