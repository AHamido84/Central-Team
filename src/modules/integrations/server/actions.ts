'use server';

import { randomBytes } from 'node:crypto';

import { and, eq, ne, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { after } from 'next/server';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure, type ActionErrorCode } from '@/lib/actions/errors';
import type { Tx } from '@/lib/db/client';
import {
  deals,
  integrationAccounts,
  integrationCampaignLinks,
  integrationConnections,
  integrationSyncRuns,
  leads,
  whatsappOptIns,
  whatsappTemplates,
} from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { normalizePhone } from '@/modules/crm/leads';
import { OAUTH_NONCE_COOKIE, OAUTH_TTL_MS, type ProviderErrorCode } from '@/modules/integrations/constants';
import { callbackUrl, getProvider, signingSecret } from '@/modules/integrations/providers';
import { ProviderError } from '@/modules/integrations/providers/types';
import {
  connectionIdSchema,
  connectWhatsAppSchema,
  linkCampaignSchema,
  mapAccountSchema,
  notificationTemplateSchema,
  optInSchema,
  renameConnectionSchema,
  retryRunSchema,
  sendWhatsAppSchema,
  startOAuthSchema,
  syncSchema,
} from '@/modules/integrations/schemas';
import { signState } from '@/modules/integrations/signatures';
import { checkConnection, disconnectConnection, discover, saveConnection } from '@/modules/integrations/server/connections';
import { executeRunsQuietly } from '@/modules/integrations/server/sync';
import { sendWhatsApp } from '@/modules/integrations/server/whatsapp';

const paths = (id?: string) => ['/admin/integrations', ...(id ? [`/admin/integrations/${id}`] : [])];

/** Platform failures → translated action errors (the detail stays in the server log). */
function providerFailure(error: unknown): ActionFailure {
  if (error instanceof ActionFailure) return error;
  if (!(error instanceof ProviderError)) throw error;
  const map: Partial<Record<ProviderErrorCode, ActionErrorCode>> = {
    not_configured: 'integration_not_configured',
    auth_expired: 'integration_auth_failed',
    auth_revoked: 'integration_auth_failed',
    permission_denied: 'integration_permission_denied',
    rate_limited: 'integration_rate_limited',
    invalid_phone: 'invalid_phone',
    template_not_approved: 'template_not_approved',
    no_connection: 'connection_not_connected',
  };
  console.warn('[integrations] provider error', error.code, error.detail);
  return new ActionFailure(map[error.code] ?? 'integration_unavailable');
}

/** RLS probe: the connection is visible to the caller and they may manage integrations (DB-side check). */
async function managedConnection(tx: Tx, organizationId: string, connectionId: string) {
  const [row] = await tx
    .select({ id: integrationConnections.id, provider: integrationConnections.provider, status: integrationConnections.status })
    .from(integrationConnections)
    .where(and(eq(integrationConnections.id, connectionId), sql`app.integrations_can(${organizationId}::uuid, 'integrations:manage')`));
  if (!row) throw new ActionFailure('not_found');
  return row;
}

/**
 * Starts an OAuth connection: a signed `state` (organization, user, provider, mode, 10 min) bound to a random nonce
 * in an httpOnly cookie; the callback route verifies both before exchanging the code (ADR-067).
 */
export const startOAuthAction = defineAction({
  input: startOAuthSchema,
  side: 'agency',
  permission: 'integrations:manage',
  async handler({ input, tx, ctx }) {
    if (input.connectionId) await managedConnection(tx, ctx.organization.id, input.connectionId);
    let provider;
    try {
      provider = getProvider(input.provider, input.mode);
    } catch (error) {
      throw providerFailure(error);
    }
    if (!provider.authorizeUrl) throw new ActionFailure('validation');
    const nonce = randomBytes(24).toString('base64url');
    const state = signState(
      {
        organizationId: ctx.organization.id,
        userId: ctx.session.userId,
        provider: input.provider,
        mode: input.mode,
        connectionId: input.connectionId,
        nonce,
        exp: Date.now() + OAUTH_TTL_MS,
      },
      signingSecret(),
    );
    (await cookies()).set(OAUTH_NONCE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/integrations',
      maxAge: OAUTH_TTL_MS / 1000,
    });
    return { url: provider.authorizeUrl({ state, redirectUri: callbackUrl(input.provider) }) };
  },
});

/** WhatsApp Business connects with a system-user token (or a generated sandbox token). */
export const connectWhatsAppAction = defineAction({
  input: connectWhatsAppSchema,
  side: 'agency',
  permission: 'integrations:manage',
  async handler({ input, tx, ctx }) {
    if (input.connectionId) await managedConnection(tx, ctx.organization.id, input.connectionId);
    try {
      const provider = getProvider('whatsapp', input.mode);
      const credentials =
        input.mode === 'sandbox'
          ? { accessToken: `sbx_${randomBytes(16).toString('base64url')}`, phoneNumberId: 'sbx_wa_7001', wabaId: 'sbx_waba_7000' }
          : { accessToken: input.accessToken, phoneNumberId: input.phoneNumberId, wabaId: input.wabaId };
      const { tokens, settings } = await provider.connectWithToken!(credentials);
      return await saveConnection({
        organizationId: ctx.organization.id,
        actorId: ctx.session.userId,
        provider: 'whatsapp',
        mode: input.mode,
        tokens,
        settings,
        connectionId: input.connectionId,
      });
    } catch (error) {
      throw providerFailure(error);
    }
  },
  revalidate: (_input, r) => paths(r.connectionId),
});

export const renameConnectionAction = defineAction({
  input: renameConnectionSchema,
  side: 'agency',
  permission: 'integrations:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .update(integrationConnections)
      .set({ name: input.name })
      .where(eq(integrationConnections.id, input.connectionId))
      .returning({ id: integrationConnections.id });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'integration.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'integration_connection', id: row.id },
      payload: { connectionId: row.id, fields: ['name'] },
    });
    return { connectionId: row.id };
  },
  revalidate: (input) => paths(input.connectionId),
});

export const disconnectAction = defineAction({
  input: connectionIdSchema,
  side: 'agency',
  permission: 'integrations:manage',
  async handler({ input, tx, ctx }) {
    await managedConnection(tx, ctx.organization.id, input.connectionId);
    await disconnectConnection(input.connectionId, ctx.session.userId);
    return { connectionId: input.connectionId };
  },
  revalidate: (input) => paths(input.connectionId),
});

export const testConnectionAction = defineAction({
  input: connectionIdSchema,
  side: 'agency',
  permission: 'integrations:manage',
  async handler({ input, tx, ctx }) {
    const c = await managedConnection(tx, ctx.organization.id, input.connectionId);
    if (c.status === 'disconnected') throw new ActionFailure('connection_not_connected');
    const result = await checkConnection(input.connectionId);
    if (!result.ok) throw providerFailure(new ProviderError(result.code as ProviderErrorCode));
    return { connectionId: input.connectionId };
  },
  revalidate: (input) => paths(input.connectionId),
});

/** Re-reads accounts, campaigns and templates from the platform. */
export const refreshDiscoveryAction = defineAction({
  input: connectionIdSchema,
  side: 'agency',
  permission: 'integrations:manage',
  async handler({ input, tx, ctx }) {
    const c = await managedConnection(tx, ctx.organization.id, input.connectionId);
    if (c.status !== 'connected') throw new ActionFailure('connection_not_connected');
    try {
      return await discover(input.connectionId);
    } catch (error) {
      throw providerFailure(error);
    }
  },
  revalidate: (input) => paths(input.connectionId),
});

export const mapAccountAction = defineAction({
  input: mapAccountSchema,
  side: 'agency',
  permission: 'integrations:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .update(integrationAccounts)
      .set({ clientId: input.clientId, syncEnabled: input.clientId ? input.syncEnabled : false })
      .where(eq(integrationAccounts.id, input.accountId))
      .returning({ id: integrationAccounts.id, connectionId: integrationAccounts.connectionId });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'integration.account_mapped',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'integration_account', id: row.id },
      clientId: input.clientId,
      payload: { accountId: row.id, clientId: input.clientId, syncEnabled: !!input.clientId && input.syncEnabled },
    });
    return { connectionId: row.connectionId };
  },
  revalidate: (_input, r) => paths(r.connectionId),
});

export const linkCampaignAction = defineAction({
  input: linkCampaignSchema,
  side: 'agency',
  permission: 'integrations:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .update(integrationCampaignLinks)
      .set({ channelId: input.channelId })
      .where(eq(integrationCampaignLinks.id, input.linkId))
      .returning({ id: integrationCampaignLinks.id, accountId: integrationCampaignLinks.accountId });
    if (!row) throw new ActionFailure('not_found');
    const [account] = await tx
      .select({ connectionId: integrationAccounts.connectionId })
      .from(integrationAccounts)
      .where(eq(integrationAccounts.id, row.accountId));
    await emitEvent(tx, {
      type: 'integration.campaign_linked',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'integration_campaign_link', id: row.id },
      payload: { linkId: row.id, channelId: input.channelId },
    });
    return { connectionId: account!.connectionId };
  },
  revalidate: (_input, r) => paths(r.connectionId),
});

/** "Sync now" and "Backfill": queues a run (RLS insert, guard trigger owns its state) and runs it after the response. */
export const requestSyncAction = defineAction({
  input: syncSchema,
  side: 'agency',
  permission: 'integrations:manage',
  async handler({ input, tx, ctx }) {
    const c = await managedConnection(tx, ctx.organization.id, input.connectionId);
    if (c.status !== 'connected') throw new ActionFailure('connection_not_connected');
    const id = crypto.randomUUID();
    await tx.insert(integrationSyncRuns).values({
      id,
      organizationId: ctx.organization.id,
      connectionId: input.connectionId,
      accountId: input.accountId,
      trigger: input.trigger,
      dateFrom: input.from,
      dateTo: input.to,
    });
    await emitEvent(tx, {
      type: 'integration.sync_requested',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'integration_connection', id: input.connectionId },
      payload: { runId: id, connectionId: input.connectionId, from: input.from, to: input.to },
    });
    return { runId: id, connectionId: input.connectionId };
  },
  after: async ({ result }) => {
    after(() => executeRunsQuietly([result.runId]));
  },
  revalidate: (input) => paths(input.connectionId),
});

export const retrySyncAction = defineAction({
  input: retryRunSchema,
  side: 'agency',
  permission: 'integrations:manage',
  async handler({ input, tx, ctx }) {
    const [run] = await tx.select().from(integrationSyncRuns).where(eq(integrationSyncRuns.id, input.runId));
    if (!run) throw new ActionFailure('not_found');
    const c = await managedConnection(tx, ctx.organization.id, run.connectionId);
    if (c.status !== 'connected') throw new ActionFailure('connection_not_connected');
    const id = crypto.randomUUID();
    await tx.insert(integrationSyncRuns).values({
      id,
      organizationId: ctx.organization.id,
      connectionId: run.connectionId,
      accountId: run.accountId,
      trigger: 'retry',
      dateFrom: run.dateFrom,
      dateTo: run.dateTo,
    });
    return { runId: id, connectionId: run.connectionId };
  },
  after: async ({ result }) => {
    after(() => executeRunsQuietly([result.runId]));
  },
  revalidate: (_input, r) => paths(r.connectionId),
});

/** Marks the template WhatsApp notifications go through (one per language). */
export const setNotificationTemplateAction = defineAction({
  input: notificationTemplateSchema,
  side: 'agency',
  permission: 'integrations:manage',
  async handler({ input, tx, ctx }) {
    const [t] = await tx.select().from(whatsappTemplates).where(eq(whatsappTemplates.id, input.templateId));
    if (!t) throw new ActionFailure('not_found');
    if (input.isNotification) {
      if (t.status !== 'approved') throw new ActionFailure('template_not_approved');
      await tx
        .update(whatsappTemplates)
        .set({ isNotification: false })
        .where(and(eq(whatsappTemplates.language, t.language), eq(whatsappTemplates.isNotification, true), ne(whatsappTemplates.id, t.id)));
    }
    await tx.update(whatsappTemplates).set({ isNotification: input.isNotification }).where(eq(whatsappTemplates.id, t.id));
    await emitEvent(tx, {
      type: 'whatsapp.template_updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'whatsapp_template', id: t.id },
      payload: { templateId: t.id, isNotification: input.isNotification },
    });
    return { connectionId: t.connectionId };
  },
  revalidate: (_input, r) => paths(r.connectionId),
});

/**
 * Sends a template to a lead (or a deal's primary contact). The lead / deal and the template are looked up under RLS
 * (the caller must be able to read both), then the platform call and the log go through the service path.
 */
export const sendWhatsAppAction = defineAction({
  input: sendWhatsAppSchema,
  side: 'agency',
  permission: 'whatsapp:send',
  rateLimit: { key: 'whatsapp-send', max: 30, windowSeconds: 600 },
  async handler({ input, tx, ctx }) {
    let phone: string | null = null;
    let leadId: string | null = input.leadId;
    if (input.leadId) {
      const [l] = await tx.select({ phone: leads.phone }).from(leads).where(eq(leads.id, input.leadId));
      if (!l) throw new ActionFailure('not_found');
      phone = l.phone;
    } else {
      const [d] = await tx
        .select({
          leadId: deals.leadId,
          leadPhone: leads.phone,
          contactPhone: sql<
            string | null
          >`(select c.phone from public.deal_contacts c where c.deal_id = deals.id order by c.is_primary desc limit 1)`,
        })
        .from(deals)
        .leftJoin(leads, eq(leads.id, deals.leadId))
        .where(eq(deals.id, input.dealId!));
      if (!d) throw new ActionFailure('not_found');
      phone = normalizePhone(d.contactPhone) ?? d.leadPhone;
      leadId = null;
    }
    if (!phone) throw new ActionFailure('no_phone');
    const [template] = await tx
      .select()
      .from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.id, input.templateId), sql`app.integration_connected(${whatsappTemplates.connectionId})`));
    if (!template) throw new ActionFailure('connection_not_connected');
    if (template.status !== 'approved') throw new ActionFailure('template_not_approved');
    if (input.params.length !== template.paramCount) throw new ActionFailure('validation', { params: ['count'] });
    const result = await sendWhatsApp({
      organizationId: ctx.organization.id,
      template,
      to: phone,
      params: input.params,
      purpose: 'lead',
      leadId,
      dealId: input.dealId,
      sentBy: ctx.session.userId,
    });
    if (result.status === 'failed') throw providerFailure(new ProviderError((result.errorCode ?? 'platform_error') as ProviderErrorCode));
    return result;
  },
  revalidate: (input) => [input.leadId ? `/crm/leads/${input.leadId}` : `/crm/deals/${input.dealId}`],
});

export const whatsappOptInAction = defineAction({
  input: optInSchema,
  side: 'agency',
  async handler({ input, tx, ctx }) {
    const phone = normalizePhone(input.phone);
    if (!phone) throw new ActionFailure('validation', { phone: ['invalid_phone'] });
    const now = new Date();
    await tx
      .insert(whatsappOptIns)
      .values({ userId: ctx.session.userId, organizationId: ctx.organization.id, phone, optedInAt: now, optedOutAt: null })
      .onConflictDoUpdate({
        target: [whatsappOptIns.userId, whatsappOptIns.organizationId],
        set: { phone, optedInAt: now, optedOutAt: null },
      });
    await emitEvent(tx, {
      type: 'whatsapp.opt_in_changed',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'user', id: ctx.session.userId },
      payload: { userId: ctx.session.userId, optedIn: true },
    });
    return { phone };
  },
  revalidate: ['/settings/notifications'],
});

export const whatsappOptOutAction = defineAction({
  input: connectionIdSchema.pick({}),
  side: 'agency',
  async handler({ tx, ctx }) {
    await tx
      .update(whatsappOptIns)
      .set({ optedOutAt: new Date() })
      .where(and(eq(whatsappOptIns.userId, ctx.session.userId), eq(whatsappOptIns.organizationId, ctx.organization.id)));
    await emitEvent(tx, {
      type: 'whatsapp.opt_in_changed',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'user', id: ctx.session.userId },
      payload: { userId: ctx.session.userId, optedIn: false },
    });
    return null;
  },
  revalidate: ['/settings/notifications'],
});
