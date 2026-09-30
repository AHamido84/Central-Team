'use server';

import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { AgencyContext } from '@/lib/auth/context';
import type { Tx } from '@/lib/db/client';
import { integrationAccounts, integrationCampaignLinks, integrationConnections } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { can } from '@/lib/permissions/can';
import { connectionModes, personalProviderKeys } from '@/modules/integrations/constants';
import { sandboxEnabled } from '@/modules/integrations/providers';
import { discover, disconnectConnection, saveConnection } from '@/modules/integrations/server/connections';
import { providerFailure } from '@/modules/integrations/server/failure';

const paths = ['/settings/connections', '/admin/integrations'];

/** A token never comes back; the owner recognises it by its ends. */
const hint = (token: string) => (token.length <= 10 ? '••••' : `${token.slice(0, 4)}…${token.slice(-4)}`);

/**
 * RLS probe (FR1.6): the caller owns this personal connection, or manages the organization's integrations. Everything
 * after this runs on the service path (tokens come from Vault), so this check gates it.
 */
async function ownOrManaged(tx: Tx, ctx: AgencyContext, connectionId: string) {
  const [row] = await tx
    .select({
      id: integrationConnections.id,
      ownerId: integrationConnections.ownerId,
      provider: integrationConnections.provider,
      status: integrationConnections.status,
    })
    .from(integrationConnections)
    .where(eq(integrationConnections.id, connectionId));
  if (!row || !row.ownerId) throw new ActionFailure('not_found');
  if (row.ownerId !== ctx.session.userId && !can(ctx.permissions, 'integrations:manage')) throw new ActionFailure('forbidden');
  return row;
}

const connectSchema = z.object({
  provider: z.enum(personalProviderKeys),
  mode: z.enum(connectionModes),
  name: z.string().trim().max(120).optional(),
  accessToken: z.string().trim().min(8, { message: 'invalid_token' }).max(4000),
  refreshToken: z.string().trim().max(4000).optional(),
  /** When the token expires (YYYY-MM-DD), if the platform said so. */
  expiresAt: z.iso.date({ message: 'invalid_date' }).nullable().optional(),
  /** Google Ads customer id (digits) — the account the token should read. */
  customerId: z
    .string()
    .trim()
    .regex(/^[\d-]{0,20}$/, { message: 'invalid' })
    .optional(),
});

/** Connect your own account with a pasted token (OAuth-shaped storage, so an OAuth flow can replace pasting later). */
export const connectPersonalAction = defineAction({
  input: connectSchema,
  side: 'agency',
  permission: 'integrations:connect',
  rateLimit: { key: 'personal_connect', max: 20, windowSeconds: 600 },
  async handler({ input, ctx }) {
    if (input.mode === 'sandbox' && !sandboxEnabled()) throw new ActionFailure('integration_not_configured');
    try {
      return await saveConnection({
        organizationId: ctx.organization.id,
        actorId: ctx.session.userId,
        ownerId: ctx.session.userId,
        provider: input.provider,
        mode: input.mode,
        name: input.name || null,
        tokens: {
          accessToken: input.accessToken,
          refreshToken: input.refreshToken || null,
          expiresAt: input.expiresAt ? new Date(`${input.expiresAt}T23:59:59Z`).toISOString() : null,
        },
        settings: {
          tokenHint: hint(input.accessToken),
          source: 'pasted',
          ...(input.customerId ? { customerId: input.customerId.replace(/-/g, '') } : {}),
        },
      });
    } catch (error) {
      throw providerFailure(error);
    }
  },
  revalidate: paths,
});

/** "Test connection": re-reads the ad accounts (and their campaigns) from the platform so they can be mapped. */
export const testPersonalConnectionAction = defineAction({
  input: z.object({ connectionId: z.uuid() }),
  side: 'agency',
  permission: 'integrations:connect',
  async handler({ input, tx, ctx }) {
    const c = await ownOrManaged(tx, ctx, input.connectionId);
    if (c.status === 'disconnected') throw new ActionFailure('connection_not_connected');
    try {
      return await discover(input.connectionId);
    } catch (error) {
      throw providerFailure(error);
    }
  },
  revalidate: paths,
});

/** "Fetch campaigns" for one ad account (Meta first; LinkedIn and the other platforms with a campaign list too). */
export const fetchCampaignsAction = defineAction({
  input: z.object({ accountId: z.uuid() }),
  side: 'agency',
  permission: 'integrations:connect',
  async handler({ input, tx, ctx }) {
    const [account] = await tx
      .select({ id: integrationAccounts.id, connectionId: integrationAccounts.connectionId, kind: integrationAccounts.kind })
      .from(integrationAccounts)
      .where(eq(integrationAccounts.id, input.accountId));
    if (!account || account.kind !== 'ad_account') throw new ActionFailure('not_found');
    await ownOrManaged(tx, ctx, account.connectionId);
    try {
      await discover(account.connectionId);
    } catch (error) {
      throw providerFailure(error);
    }
    const campaigns = await tx
      .select({ id: integrationCampaignLinks.id, name: integrationCampaignLinks.name, status: integrationCampaignLinks.platformStatus })
      .from(integrationCampaignLinks)
      .where(eq(integrationCampaignLinks.accountId, account.id));
    return { campaigns };
  },
  revalidate: paths,
});

/** Map your ad account to a client you can reach (RLS: owner, and the client must be accessible). */
export const mapPersonalAccountAction = defineAction({
  input: z.object({ accountId: z.uuid(), clientId: z.uuid().nullable() }),
  side: 'agency',
  permission: 'integrations:connect',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .update(integrationAccounts)
      .set({ clientId: input.clientId, syncEnabled: false })
      .where(eq(integrationAccounts.id, input.accountId))
      .returning({ id: integrationAccounts.id });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'integration.account_mapped',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'integration_account', id: row.id },
      clientId: input.clientId,
      payload: { accountId: row.id, clientId: input.clientId, syncEnabled: false },
    });
    return { accountId: row.id };
  },
  revalidate: paths,
});

export const disconnectPersonalAction = defineAction({
  input: z.object({ connectionId: z.uuid() }),
  side: 'agency',
  permission: 'integrations:connect',
  async handler({ input, tx, ctx }) {
    await ownOrManaged(tx, ctx, input.connectionId);
    await disconnectConnection(input.connectionId, ctx.session.userId);
    return { connectionId: input.connectionId };
  },
  revalidate: paths,
});

/** Admins hand a personal connection to someone else (e.g. when its owner leaves). */
export const reassignConnectionAction = defineAction({
  input: z.object({ connectionId: z.uuid(), ownerId: z.uuid() }),
  side: 'agency',
  permission: 'integrations:manage',
  async handler({ input, tx, ctx }) {
    const [target] = await tx.execute<{ ok: boolean }>(
      sql`select app.member_has_permission(${ctx.organization.id}::uuid, ${input.ownerId}::uuid, 'integrations:connect') as ok`,
    );
    if (!target?.ok) throw new ActionFailure('invalid_assignee');
    const [before] = await tx
      .select({ ownerId: integrationConnections.ownerId })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, input.connectionId));
    if (!before?.ownerId) throw new ActionFailure('not_found');
    const [row] = await tx
      .update(integrationConnections)
      .set({ ownerId: input.ownerId })
      .where(and(eq(integrationConnections.id, input.connectionId)))
      .returning({ id: integrationConnections.id });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'integration.reassigned',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'integration_connection', id: row.id },
      payload: { connectionId: row.id, from: before.ownerId, to: input.ownerId },
    });
    return { connectionId: row.id };
  },
  revalidate: paths,
});
