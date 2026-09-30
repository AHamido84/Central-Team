import 'server-only';

import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import {
  integrationAccounts,
  integrationCampaignLinks,
  integrationConnections,
  integrationWebhookEvents,
  whatsappMessages,
} from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { env } from '@/lib/env';
import { cities } from '@/modules/clients/constants';
import { normalizeEmail, normalizePhone } from '@/modules/crm/leads';
import { ingestLead } from '@/modules/crm/server/intake';
import type { ProviderKey } from '@/modules/integrations/constants';
import { sandboxEnabled, signingSecret } from '@/modules/integrations/providers';
import {
  verifyGoogleKey,
  verifyMetaSignature,
  verifySandboxSignature,
  verifySnapSignature,
  verifyTikTokSignature,
} from '@/modules/integrations/signatures';
import { serviceTx, withConnection } from '@/modules/integrations/server/connections';
import { leadFieldsFrom, parseWebhook, type WebhookItem } from '@/modules/integrations/webhook-parsers';

export const SANDBOX_SIGNATURE_HEADER = 'x-central-signature';
const MAX_ATTEMPTS = 5;

const providerLabel: Record<ProviderKey, string> = {
  meta: 'Meta',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
  google: 'Google',
};

/**
 * Signature check per platform (ADR-069). The sandbox signs with our own key; it is accepted only while sandbox
 * providers are enabled. Returns the mode the payload came from, or null when it must be rejected.
 */
export function verifyInbound(provider: ProviderKey, rawBody: string, headers: Headers, body: unknown): 'live' | 'sandbox' | null {
  const sandboxHeader = headers.get(SANDBOX_SIGNATURE_HEADER);
  if (sandboxHeader) return sandboxEnabled() && verifySandboxSignature(rawBody, sandboxHeader, signingSecret()) ? 'sandbox' : null;
  const e = env();
  switch (provider) {
    case 'meta':
    case 'whatsapp':
      return verifyMetaSignature(rawBody, headers.get('x-hub-signature-256'), e.META_APP_SECRET) ? 'live' : null;
    case 'tiktok':
      return verifyTikTokSignature(rawBody, headers.get('tiktok-signature'), e.TIKTOK_APP_SECRET) ? 'live' : null;
    case 'snapchat':
      return verifySnapSignature(rawBody, headers.get('x-snap-signature'), e.SNAPCHAT_WEBHOOK_SECRET) ? 'live' : null;
    case 'google':
      return verifyGoogleKey((body as { google_key?: unknown } | null)?.google_key, e.GOOGLE_LEAD_WEBHOOK_KEY) ? 'live' : null;
  }
}

type Routed = { organizationId: string; connectionId: string; accountId: string | null; mode: string };

/** Which connection (and so organization) an item belongs to: by account id, or by platform campaign (Google). */
async function route(provider: ProviderKey, item: WebhookItem, mode: 'live' | 'sandbox'): Promise<Routed | null> {
  const providers = provider === 'whatsapp' || provider === 'meta' ? (['meta', 'whatsapp'] as const) : [provider];
  if ('campaignId' in item.route) {
    const [row] = await dbAdmin
      .select({
        organizationId: integrationAccounts.organizationId,
        connectionId: integrationAccounts.connectionId,
        accountId: integrationAccounts.id,
        mode: integrationConnections.mode,
      })
      .from(integrationCampaignLinks)
      .innerJoin(integrationAccounts, eq(integrationAccounts.id, integrationCampaignLinks.accountId))
      .innerJoin(integrationConnections, eq(integrationConnections.id, integrationAccounts.connectionId))
      .where(
        and(
          eq(integrationCampaignLinks.externalCampaignId, item.route.campaignId),
          inArray(integrationConnections.provider, [...providers]),
          eq(integrationConnections.mode, mode),
        ),
      )
      .limit(1);
    return row ?? null;
  }
  const [row] = await dbAdmin
    .select({
      organizationId: integrationAccounts.organizationId,
      connectionId: integrationAccounts.connectionId,
      accountId: integrationAccounts.id,
      mode: integrationConnections.mode,
    })
    .from(integrationAccounts)
    .innerJoin(integrationConnections, eq(integrationConnections.id, integrationAccounts.connectionId))
    .where(
      and(
        eq(integrationAccounts.kind, item.route.kind),
        eq(integrationAccounts.externalId, item.route.externalId),
        inArray(integrationConnections.provider, [...providers]),
        eq(integrationConnections.mode, mode),
      ),
    )
    .orderBy(sql`${integrationConnections.status} = 'connected' desc`)
    .limit(1);
  return row ?? null;
}

export type ReceiveResult = { status: 200 | 401; accepted: string[]; duplicates: number };

/**
 * Records an inbound webhook: rejected (bad signature, no payload kept) or one row per item, deduplicated on the
 * platform's id — a replayed delivery inserts nothing and is not processed again. Returns the new event ids, which
 * the caller processes after responding (platforms expect a fast 200).
 */
export async function receiveWebhook(provider: ProviderKey, rawBody: string, headers: Headers): Promise<ReceiveResult> {
  let body: unknown = null;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = null;
  }
  const mode = verifyInbound(provider, rawBody, headers, body);
  if (!mode || body === null) {
    await dbAdmin
      .insert(integrationWebhookEvents)
      .values({ provider, signatureValid: false, status: 'rejected', topic: 'other', error: mode ? 'invalid_json' : 'invalid_signature' });
    return { status: 401, accepted: [], duplicates: 0 };
  }
  const items = parseWebhook(provider, body);
  const accepted: string[] = [];
  let duplicates = 0;
  for (const item of items) {
    const routed = await route(provider, item, mode);
    const [row] = await dbAdmin
      .insert(integrationWebhookEvents)
      .values({
        provider,
        organizationId: routed?.organizationId ?? null,
        connectionId: routed?.connectionId ?? null,
        accountId: routed?.accountId ?? null,
        externalId: `${mode}:${item.externalId}`,
        topic: item.topic,
        signatureValid: true,
        status: routed ? (item.topic === 'message' ? 'ignored' : 'received') : 'ignored',
        error: routed ? (item.topic === 'message' ? 'inbound_messages_not_supported' : null) : 'unknown_account',
        payload: item,
      })
      .onConflictDoNothing()
      .returning({ id: integrationWebhookEvents.id, status: integrationWebhookEvents.status });
    if (!row) duplicates++;
    else if (row.status === 'received') accepted.push(row.id);
  }
  if (!items.length)
    await dbAdmin
      .insert(integrationWebhookEvents)
      .values({ provider, signatureValid: true, status: 'ignored', topic: 'other', error: 'no_items', payload: body });
  return { status: 200, accepted, duplicates };
}

async function processLead(event: typeof integrationWebhookEvents.$inferSelect, item: Extract<WebhookItem, { topic: 'lead' }>) {
  let fields = item.fields;
  if (!fields || !Object.keys(fields).length) {
    fields = await withConnection(event.connectionId!, async ({ provider, ctx }) => {
      if (!provider.fetchLead) return {};
      return provider.fetchLead(ctx, item.leadId);
    });
  }
  const f = leadFieldsFrom(fields);
  const phone = normalizePhone(f.phone);
  const email = normalizeEmail(f.email);
  if (!phone && !email) throw new Error('lead_without_contact');
  const provider = event.provider as ProviderKey;
  const city = (cities as readonly string[]).find((c) => c === f.city?.toLowerCase()) ?? null;
  const result = await ingestLead(
    event.organizationId!,
    {
      fullName: f.fullName ?? phone ?? email ?? 'Lead',
      company: f.company,
      phone,
      email,
      source: 'lead_ad',
      sourceDetail: `${providerLabel[provider]}${item.formId ? ` · ${item.formId}` : ''}`.slice(0, 200),
      externalRef: `${provider === 'whatsapp' ? 'meta' : provider}:${item.leadId}`,
      services: [],
      budgetRange: 'unknown',
      city,
      ownerId: null,
      tags: [provider],
      notes: '',
      message: f.message,
    },
    'lead_ad',
  );
  return result.leadId;
}

async function processStatus(event: typeof integrationWebhookEvents.$inferSelect, item: Extract<WebhookItem, { topic: 'message_status' }>) {
  await serviceTx(null, async (tx) => {
    const [msg] = await tx.select().from(whatsappMessages).where(eq(whatsappMessages.externalId, item.messageId)).for('update');
    if (!msg || msg.organizationId !== event.organizationId) return;
    // Items come back from the jsonb payload, so the timestamp is an ISO string here.
    const at = new Date(item.at);
    const stamp =
      item.status === 'delivered'
        ? { deliveredAt: at }
        : item.status === 'read'
          ? { readAt: at, deliveredAt: msg.deliveredAt ?? at }
          : item.status === 'failed'
            ? { failedAt: at }
            : { sentAt: msg.sentAt ?? at };
    await tx
      .update(whatsappMessages)
      .set({
        status: item.status,
        ...stamp,
        ...(item.status === 'failed'
          ? { errorCode: item.errorCode ?? 'platform_error', errorMessage: item.errorTitle?.slice(0, 300) ?? null }
          : {}),
      })
      .where(eq(whatsappMessages.id, msg.id));
    if (item.status === 'failed' && msg.status !== 'failed')
      await emitEvent(tx, {
        type: 'whatsapp.message_failed',
        organizationId: msg.organizationId,
        actorId: null,
        aggregate: { type: 'whatsapp_message', id: msg.id },
        payload: { messageId: msg.id, errorCode: item.errorCode ?? 'platform_error' },
      });
  });
}

/** Processes recorded events (idempotent: lead ads dedupe on `external_ref`, statuses only move forward). */
export async function processWebhookEvents(ids: string[]): Promise<{ processed: number; failed: number }> {
  const result = { processed: 0, failed: 0 };
  for (const id of ids) {
    const [event] = await dbAdmin
      .update(integrationWebhookEvents)
      .set({ attempts: sql`${integrationWebhookEvents.attempts} + 1` })
      .where(and(eq(integrationWebhookEvents.id, id), inArray(integrationWebhookEvents.status, ['received', 'failed'])))
      .returning();
    if (!event?.organizationId || !event.connectionId) continue;
    const item = event.payload as WebhookItem;
    try {
      let leadId: string | null = null;
      if (item.topic === 'lead') leadId = await processLead(event, item);
      else if (item.topic === 'message_status') await processStatus(event, item);
      await dbAdmin
        .update(integrationWebhookEvents)
        .set({ status: 'processed', processedAt: new Date(), error: null, leadId })
        .where(eq(integrationWebhookEvents.id, id));
      result.processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[integrations] webhook event failed', id, message);
      await dbAdmin
        .update(integrationWebhookEvents)
        .set({ status: 'failed', error: message.slice(0, 500) })
        .where(eq(integrationWebhookEvents.id, id));
      result.failed++;
    }
  }
  return result;
}

/** Sweep: events still waiting (a crashed request) or failed with attempts left, older than a minute. */
export async function retryWebhookEvents(limit = 50) {
  const due = await dbAdmin
    .select({ id: integrationWebhookEvents.id })
    .from(integrationWebhookEvents)
    .where(
      and(
        inArray(integrationWebhookEvents.status, ['received', 'failed']),
        lt(integrationWebhookEvents.attempts, MAX_ATTEMPTS),
        lt(integrationWebhookEvents.receivedAt, new Date(Date.now() - 60_000)),
      ),
    )
    .limit(limit);
  return processWebhookEvents(due.map((d) => d.id));
}
