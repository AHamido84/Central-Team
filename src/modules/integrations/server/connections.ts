import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import { dbAdmin, type Tx } from '@/lib/db/client';
import { integrationAccounts, integrationCampaignLinks, integrationConnections, whatsappTemplates } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { countTemplateParams, type ConnectionMode, type ProviderKey } from '@/modules/integrations/constants';
import { getProvider } from '@/modules/integrations/providers';
import { ProviderError, type ConnectionContext, type IntegrationProvider, type TokenSet } from '@/modules/integrations/providers/types';

export type Connection = typeof integrationConnections.$inferSelect;

/**
 * Service transaction for integration bookkeeping (listed service path, CLAUDE.md §6 / ADR-067): token storage in
 * Vault and platform results can't be written as the user. When a person caused it, their id goes into the JWT
 * claims (role unchanged) so the audit trail names them.
 */
export async function serviceTx<T>(actorId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return dbAdmin.transaction(async (tx) => {
    if (actorId) await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: actorId })}, true)`);
    return fn(tx);
  });
}

async function readSecret(connectionId: string): Promise<TokenSet | null> {
  const [row] = await dbAdmin.execute<{ secret: string | null }>(sql`select app.integration_get_secret(${connectionId}::uuid) as secret`);
  if (!row?.secret) return null;
  return JSON.parse(row.secret) as TokenSet;
}

export async function storeSecret(tx: Tx, connectionId: string, tokens: TokenSet): Promise<void> {
  await tx.execute(sql`select app.integration_put_secret(${connectionId}::uuid, ${JSON.stringify(tokens)})`);
}

const REFRESH_MARGIN_MS = 5 * 60_000;

/**
 * Loads a connection with its tokens (from Vault) and provider, refreshing an access token that is about to expire.
 * Throws `ProviderError('no_connection')` for disconnected or missing connections.
 */
export async function openConnection(
  connectionId: string,
): Promise<{ connection: Connection; provider: IntegrationProvider; ctx: ConnectionContext }> {
  const [connection] = await dbAdmin.select().from(integrationConnections).where(eq(integrationConnections.id, connectionId));
  if (!connection || connection.status === 'disconnected') throw new ProviderError('no_connection');
  const provider = getProvider(connection.provider as ProviderKey, connection.mode as ConnectionMode);
  let tokens = await readSecret(connectionId);
  if (!tokens) throw new ProviderError('auth_revoked', 'no token stored');
  if (tokens.expiresAt && new Date(tokens.expiresAt).getTime() - Date.now() < REFRESH_MARGIN_MS) {
    if (!provider.refresh) throw new ProviderError('auth_expired', 'token expired');
    tokens = await provider.refresh(tokens);
    const fresh = tokens;
    await serviceTx(null, async (tx) => {
      await storeSecret(tx, connectionId, fresh);
      await tx
        .update(integrationConnections)
        .set({ tokenExpiresAt: fresh.expiresAt ? new Date(fresh.expiresAt) : null })
        .where(eq(integrationConnections.id, connectionId));
    });
  }
  return {
    connection,
    provider,
    ctx: { connectionId, mode: connection.mode as ConnectionMode, tokens, settings: connection.settings },
  };
}

/**
 * Records what a platform failure means for the connection: an expired / revoked token marks it `expired` (once —
 * the event and notification fire on the change), a permission problem marks it `error`. Other failures (network,
 * rate limits) belong to the sync run or message that hit them, not to the connection.
 */
export async function recordConnectionError(connectionId: string, error: unknown): Promise<ProviderError> {
  const failure = error instanceof ProviderError ? error : new ProviderError('platform_error', String(error));
  const status =
    failure.code === 'auth_expired' || failure.code === 'auth_revoked' ? 'expired' : failure.code === 'permission_denied' ? 'error' : null;
  if (!status) return failure;
  await serviceTx(null, async (tx) => {
    const [before] = await tx
      .select({
        status: integrationConnections.status,
        organizationId: integrationConnections.organizationId,
        provider: integrationConnections.provider,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, connectionId))
      .for('update');
    if (!before || before.status === 'disconnected') return;
    await tx
      .update(integrationConnections)
      .set({ status, lastErrorCode: failure.code, lastErrorMessage: failure.detail.slice(0, 500), lastCheckedAt: new Date() })
      .where(eq(integrationConnections.id, connectionId));
    if (status === 'expired' && before.status !== 'expired')
      await emitEvent(tx, {
        type: 'integration.connection_expired',
        organizationId: before.organizationId,
        actorId: null,
        aggregate: { type: 'integration_connection', id: connectionId },
        payload: { connectionId, provider: before.provider, errorCode: failure.code },
      });
  });
  return failure;
}

/** Runs `fn` with an open connection; connection-level failures are recorded before the error is re-thrown. */
export async function withConnection<T>(
  connectionId: string,
  fn: (open: { connection: Connection; provider: IntegrationProvider; ctx: ConnectionContext }) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await openConnection(connectionId));
  } catch (error) {
    throw await recordConnectionError(connectionId, error);
  }
}

/**
 * Pulls accounts (and their campaigns, and WhatsApp templates) from the platform and upserts them. Existing mappings
 * (client, sync switch, campaign → channel) are kept; names and statuses are refreshed.
 */
export async function discover(connectionId: string): Promise<{ accounts: number; campaigns: number; templates: number }> {
  return withConnection(connectionId, async ({ connection, provider, ctx }) => {
    const accounts = await provider.listAccounts(ctx);
    const campaignsByAccount = new Map<string, Awaited<ReturnType<NonNullable<IntegrationProvider['listCampaigns']>>>>();
    if (provider.listCampaigns)
      for (const a of accounts.filter((x) => x.kind === 'ad_account'))
        campaignsByAccount.set(
          a.externalId,
          await provider.listCampaigns(ctx, { externalId: a.externalId, kind: a.kind, metadata: a.metadata ?? {} }),
        );
    const templates = provider.listTemplates ? await provider.listTemplates(ctx) : [];

    return serviceTx(null, async (tx) => {
      let campaigns = 0;
      for (const a of accounts) {
        const [row] = await tx
          .insert(integrationAccounts)
          .values({
            organizationId: connection.organizationId,
            connectionId,
            kind: a.kind,
            externalId: a.externalId,
            name: a.name.slice(0, 200),
            currency: a.currency?.toUpperCase().slice(0, 3) ?? null,
            timezone: a.timezone ?? null,
            metadata: a.metadata ?? {},
          })
          .onConflictDoUpdate({
            target: [integrationAccounts.connectionId, integrationAccounts.kind, integrationAccounts.externalId],
            set: {
              name: a.name.slice(0, 200),
              currency: a.currency?.toUpperCase().slice(0, 3) ?? null,
              timezone: a.timezone ?? null,
              metadata: a.metadata ?? {},
            },
          })
          .returning({ id: integrationAccounts.id });
        for (const c of campaignsByAccount.get(a.externalId) ?? []) {
          campaigns++;
          await tx
            .insert(integrationCampaignLinks)
            .values({
              organizationId: connection.organizationId,
              accountId: row!.id,
              externalCampaignId: c.externalId,
              name: c.name.slice(0, 200),
              platformStatus: c.status,
            })
            .onConflictDoUpdate({
              target: [integrationCampaignLinks.accountId, integrationCampaignLinks.externalCampaignId],
              set: { name: c.name.slice(0, 200), platformStatus: c.status, lastSeenAt: new Date() },
            });
        }
      }
      for (const t of templates) {
        await tx
          .insert(whatsappTemplates)
          .values({
            organizationId: connection.organizationId,
            connectionId,
            name: t.name,
            language: t.language,
            languageCode: t.languageCode ?? t.language,
            category: t.category,
            status: t.status,
            body: t.body,
            paramCount: Math.min(countTemplateParams(t.body), 10),
            syncedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [whatsappTemplates.connectionId, whatsappTemplates.name, whatsappTemplates.language],
            set: {
              languageCode: t.languageCode ?? t.language,
              category: t.category,
              status: t.status,
              body: t.body,
              paramCount: Math.min(countTemplateParams(t.body), 10),
              syncedAt: new Date(),
              // A template that lost its approval can't stay the notification template.
              ...(t.status !== 'approved' ? { isNotification: false } : {}),
            },
          });
      }
      if (templates.length)
        await emitEvent(tx, {
          type: 'whatsapp.templates_synced',
          organizationId: connection.organizationId,
          actorId: null,
          aggregate: { type: 'integration_connection', id: connectionId },
          payload: { connectionId, count: templates.length },
        });
      await tx.update(integrationConnections).set({ lastCheckedAt: new Date() }).where(eq(integrationConnections.id, connectionId));
      return { accounts: accounts.length, campaigns, templates: templates.length };
    });
  });
}

/**
 * Creates a connection (or re-authorizes an existing one) from a fresh token set: identifies the platform user,
 * stores the tokens in Vault, marks it connected and discovers accounts. One transaction for the row + secret.
 */
export async function saveConnection(input: {
  organizationId: string;
  actorId: string;
  provider: ProviderKey;
  mode: ConnectionMode;
  tokens: TokenSet;
  settings?: Record<string, string>;
  /** Reconnect this connection instead of creating a new one. */
  connectionId?: string | null;
}): Promise<{ connectionId: string; reconnected: boolean }> {
  const provider = getProvider(input.provider, input.mode);
  const settings = input.settings ?? {};
  const probe: ConnectionContext = { connectionId: input.connectionId ?? 'new', mode: input.mode, tokens: input.tokens, settings };
  const identity = await provider.identify(probe);

  const result = await serviceTx(input.actorId, async (tx) => {
    let connectionId = input.connectionId ?? null;
    if (connectionId) {
      const [existing] = await tx
        .select({
          id: integrationConnections.id,
          provider: integrationConnections.provider,
          organizationId: integrationConnections.organizationId,
        })
        .from(integrationConnections)
        .where(eq(integrationConnections.id, connectionId));
      if (!existing || existing.organizationId !== input.organizationId || existing.provider !== input.provider)
        throw new ProviderError('no_connection');
    } else {
      // Re-authorizing the same platform user (e.g. an expired connection) reuses its row and mappings.
      const [same] = await tx
        .select({ id: integrationConnections.id })
        .from(integrationConnections)
        .where(
          and(
            eq(integrationConnections.organizationId, input.organizationId),
            eq(integrationConnections.provider, input.provider),
            eq(integrationConnections.mode, input.mode),
            eq(integrationConnections.externalUserId, identity.externalUserId),
          ),
        );
      connectionId = same?.id ?? null;
    }
    const reconnected = !!connectionId;
    const values = {
      status: 'connected' as const,
      externalUserId: identity.externalUserId,
      externalName: identity.name.slice(0, 200),
      scopes: identity.scopes.slice(0, 50),
      tokenExpiresAt: input.tokens.expiresAt ? new Date(input.tokens.expiresAt) : null,
      settings,
      lastCheckedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
      disconnectedAt: null,
    };
    if (connectionId) {
      await tx
        .update(integrationConnections)
        .set({ ...values, connectedBy: input.actorId, connectedAt: new Date() })
        .where(eq(integrationConnections.id, connectionId));
    } else {
      connectionId = crypto.randomUUID();
      await tx.insert(integrationConnections).values({
        id: connectionId,
        organizationId: input.organizationId,
        provider: input.provider,
        mode: input.mode,
        name: identity.name.slice(0, 120) || input.provider,
        connectedBy: input.actorId,
        ...values,
      });
    }
    await storeSecret(tx, connectionId, input.tokens);
    await emitEvent(tx, {
      type: reconnected ? 'integration.reconnected' : 'integration.connected',
      organizationId: input.organizationId,
      actorId: input.actorId,
      aggregate: { type: 'integration_connection', id: connectionId },
      payload: reconnected ? { connectionId, provider: input.provider } : { connectionId, provider: input.provider, mode: input.mode },
    } as never);
    return { connectionId, reconnected };
  });
  await discover(result.connectionId).catch((error) =>
    console.warn('[integrations] discovery after connect failed', (error as Error).message),
  );
  return result;
}

/** Revokes (best effort), drops the Vault secret and marks the connection disconnected. Mappings stay for history. */
export async function disconnectConnection(connectionId: string, actorId: string): Promise<void> {
  try {
    const open = await openConnection(connectionId);
    await open.provider.revoke?.(open.ctx);
  } catch (error) {
    console.warn('[integrations] revoke on disconnect failed', (error as Error).message);
  }
  await serviceTx(actorId, async (tx) => {
    const [row] = await tx
      .update(integrationConnections)
      .set({ status: 'disconnected', disconnectedAt: new Date(), tokenExpiresAt: null })
      .where(eq(integrationConnections.id, connectionId))
      .returning({ organizationId: integrationConnections.organizationId, provider: integrationConnections.provider });
    if (!row) return;
    await tx.execute(sql`select app.integration_drop_secret(${connectionId}::uuid)`);
    await tx.update(integrationAccounts).set({ syncEnabled: false }).where(eq(integrationAccounts.connectionId, connectionId));
    await tx.update(whatsappTemplates).set({ isNotification: false }).where(eq(whatsappTemplates.connectionId, connectionId));
    await emitEvent(tx, {
      type: 'integration.disconnected',
      organizationId: row.organizationId,
      actorId,
      aggregate: { type: 'integration_connection', id: connectionId },
      payload: { connectionId, provider: row.provider },
    });
  });
}

/** "Test connection": identifies against the platform and refreshes discovery; failures are recorded and returned. */
export async function checkConnection(connectionId: string): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    await withConnection(connectionId, async ({ provider, ctx }) => provider.identify(ctx));
    await serviceTx(null, (tx) =>
      tx
        .update(integrationConnections)
        .set({ status: 'connected', lastCheckedAt: new Date(), lastErrorCode: null, lastErrorMessage: null })
        .where(and(eq(integrationConnections.id, connectionId), inArray(integrationConnections.status, ['connected', 'error']))),
    );
    await discover(connectionId);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error instanceof ProviderError ? error.code : 'platform_error' };
  }
}
