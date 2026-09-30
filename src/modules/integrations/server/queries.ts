import 'server-only';

import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { withRls } from '@/lib/db/rls';
import {
  campaignChannels,
  campaigns,
  clients,
  deals,
  integrationAccounts,
  integrationCampaignLinks,
  integrationConnections,
  integrationSyncRuns,
  integrationWebhookEvents,
  leads,
  profiles,
  whatsappMessages,
  whatsappOptIns,
  whatsappTemplates,
} from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import { normalizePhone } from '@/modules/crm/leads';
import {
  channelPlatformsFor,
  connectionHealth,
  providerCatalog,
  providerKeys,
  type AccountKind,
  type ConnectionHealth,
  type ConnectionMode,
  type MessageStatus,
  type ProviderKey,
  type SyncStatus,
} from '@/modules/integrations/constants';
import { missingEnv, sandboxEnabled } from '@/modules/integrations/providers';

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export type ConnectionSummary = {
  id: string;
  provider: ProviderKey;
  mode: ConnectionMode;
  name: string;
  externalName: string | null;
  health: ConnectionHealth;
  tokenExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  accounts: number;
  mappedAccounts: number;
  lastRun: { status: SyncStatus; finishedAt: string | null; errorCode: string | null } | null;
};

export type ProviderCard = {
  key: ProviderKey;
  auth: 'oauth' | 'token';
  capabilities: readonly string[];
  missingEnv: string[];
  connections: ConnectionSummary[];
};

export type IntegrationsOverview = { sandbox: boolean; providers: ProviderCard[] };

export async function getIntegrationsOverview(): Promise<IntegrationsOverview> {
  const rows = await withRls(async (tx) => {
    const connections = await tx.select().from(integrationConnections).orderBy(asc(integrationConnections.createdAt));
    const ids = connections.map((c) => c.id);
    const counts = ids.length
      ? await tx
          .select({
            connectionId: integrationAccounts.connectionId,
            total: sql<number>`count(*)::int`,
            mapped: sql<number>`count(${integrationAccounts.clientId})::int`,
          })
          .from(integrationAccounts)
          .where(inArray(integrationAccounts.connectionId, ids))
          .groupBy(integrationAccounts.connectionId)
      : [];
    const runs = ids.length
      ? await tx
          .selectDistinctOn([integrationSyncRuns.connectionId], {
            connectionId: integrationSyncRuns.connectionId,
            status: integrationSyncRuns.status,
            finishedAt: integrationSyncRuns.finishedAt,
            errorCode: integrationSyncRuns.errorCode,
          })
          .from(integrationSyncRuns)
          .where(inArray(integrationSyncRuns.connectionId, ids))
          .orderBy(integrationSyncRuns.connectionId, desc(integrationSyncRuns.createdAt))
      : [];
    return { connections, counts, runs };
  });
  const summaries: ConnectionSummary[] = rows.connections.map((c) => {
    const count = rows.counts.find((x) => x.connectionId === c.id);
    const run = rows.runs.find((r) => r.connectionId === c.id);
    return {
      id: c.id,
      provider: c.provider as ProviderKey,
      mode: c.mode as ConnectionMode,
      name: c.name,
      externalName: c.externalName,
      health: connectionHealth({ status: c.status as ConnectionHealth & 'connected', tokenExpiresAt: c.tokenExpiresAt }),
      tokenExpiresAt: iso(c.tokenExpiresAt),
      lastSyncedAt: iso(c.lastSyncedAt),
      lastCheckedAt: iso(c.lastCheckedAt),
      lastErrorCode: c.lastErrorCode,
      accounts: count?.total ?? 0,
      mappedAccounts: count?.mapped ?? 0,
      lastRun: run ? { status: run.status as SyncStatus, finishedAt: iso(run.finishedAt), errorCode: run.errorCode } : null,
    };
  });
  return {
    sandbox: sandboxEnabled(),
    providers: providerKeys.map((key) => ({
      key,
      auth: providerCatalog[key].auth,
      capabilities: providerCatalog[key].capabilities,
      missingEnv: missingEnv(key),
      connections: summaries.filter((s) => s.provider === key),
    })),
  };
}

export type AccountRow = {
  id: string;
  kind: AccountKind;
  externalId: string;
  name: string;
  currency: string | null;
  clientId: string | null;
  syncEnabled: boolean;
  lastSyncedAt: string | null;
};

export type CampaignLinkRow = {
  id: string;
  accountId: string;
  externalCampaignId: string;
  name: string;
  platformStatus: string | null;
  channelId: string | null;
};

export type ChannelOption = { id: string; clientId: string; label: string; platform: string };

export type SyncRunRow = {
  id: string;
  trigger: string;
  dateFrom: string;
  dateTo: string;
  status: SyncStatus;
  attempts: number;
  rowsWritten: number;
  campaigns: number;
  errorCode: string | null;
  errorMessage: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  finishedAt: string | null;
  requestedBy: string | null;
};

export type WebhookRow = {
  id: string;
  topic: string;
  status: string;
  signatureValid: boolean;
  error: string | null;
  receivedAt: string;
  leadId: string | null;
  externalId: string | null;
};

export type TemplateRow = {
  id: string;
  name: string;
  language: 'ar' | 'en';
  category: string;
  status: string;
  body: string;
  paramCount: number;
  isNotification: boolean;
};

export type MessageRow = {
  id: string;
  toPhone: string;
  templateName: string;
  language: string;
  body: string;
  purpose: string;
  status: MessageStatus;
  errorCode: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  sentBy: string | null;
};

export type ConnectionDetail = {
  connection: ConnectionSummary & {
    scopes: string[];
    externalUserId: string | null;
    connectedAt: string;
    connectedBy: string | null;
    settings: Record<string, string>;
    lastErrorMessage: string | null;
  };
  auth: 'oauth' | 'token';
  accounts: AccountRow[];
  links: CampaignLinkRow[];
  channels: ChannelOption[];
  clients: { id: string; name: LocalizedText }[];
  runs: SyncRunRow[];
  webhooks: WebhookRow[];
  templates: TemplateRow[];
  messages: MessageRow[];
  people: Record<string, string>;
};

const messageRow = (m: typeof whatsappMessages.$inferSelect): MessageRow => ({
  id: m.id,
  toPhone: m.toPhone,
  templateName: m.templateName,
  language: m.language,
  body: m.body,
  purpose: m.purpose,
  status: m.status as MessageStatus,
  errorCode: m.errorCode,
  createdAt: m.createdAt.toISOString(),
  sentAt: iso(m.sentAt),
  deliveredAt: iso(m.deliveredAt),
  readAt: iso(m.readAt),
  sentBy: m.sentBy,
});

const templateRow = (t: typeof whatsappTemplates.$inferSelect): TemplateRow => ({
  id: t.id,
  name: t.name,
  language: t.language as 'ar' | 'en',
  category: t.category,
  status: t.status,
  body: t.body,
  paramCount: t.paramCount,
  isNotification: t.isNotification,
});

export async function getConnectionDetail(connectionId: string): Promise<ConnectionDetail | null> {
  const data = await withRls(async (tx) => {
    const [c] = await tx.select().from(integrationConnections).where(eq(integrationConnections.id, connectionId));
    if (!c) return null;
    const accounts = await tx
      .select()
      .from(integrationAccounts)
      .where(eq(integrationAccounts.connectionId, c.id))
      .orderBy(asc(integrationAccounts.kind), asc(integrationAccounts.name));
    const accountIds = accounts.map((a) => a.id);
    const links = accountIds.length
      ? await tx
          .select()
          .from(integrationCampaignLinks)
          .where(inArray(integrationCampaignLinks.accountId, accountIds))
          .orderBy(asc(integrationCampaignLinks.name))
      : [];
    const clientIds = [...new Set(accounts.map((a) => a.clientId).filter(Boolean) as string[])];
    const channelRows = clientIds.length
      ? await tx
          .select({
            id: campaignChannels.id,
            clientId: campaignChannels.clientId,
            platform: campaignChannels.platform,
            channelName: campaignChannels.name,
            campaignName: campaigns.name,
            campaignNumber: campaigns.number,
          })
          .from(campaignChannels)
          .innerJoin(campaigns, eq(campaigns.id, campaignChannels.campaignId))
          .where(
            and(
              inArray(campaignChannels.clientId, clientIds),
              inArray(campaignChannels.platform, [...channelPlatformsFor[c.provider as ProviderKey]]),
              inArray(campaigns.status, ['draft', 'planned', 'active', 'paused', 'completed']),
            ),
          )
          .orderBy(desc(campaigns.number))
      : [];
    const clientRows = await tx
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(eq(clients.status, 'active'))
      .orderBy(asc(clients.slug));
    const runs = await tx
      .select()
      .from(integrationSyncRuns)
      .where(eq(integrationSyncRuns.connectionId, c.id))
      .orderBy(desc(integrationSyncRuns.createdAt))
      .limit(25);
    const webhooks = await tx
      .select()
      .from(integrationWebhookEvents)
      .where(eq(integrationWebhookEvents.connectionId, c.id))
      .orderBy(desc(integrationWebhookEvents.receivedAt))
      .limit(25);
    const templates = await tx
      .select()
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.connectionId, c.id))
      .orderBy(asc(whatsappTemplates.name), asc(whatsappTemplates.language));
    const messages = await tx
      .select()
      .from(whatsappMessages)
      .where(eq(whatsappMessages.connectionId, c.id))
      .orderBy(desc(whatsappMessages.createdAt))
      .limit(25);
    const peopleIds = [
      ...new Set([c.connectedBy, ...runs.map((r) => r.requestedBy), ...messages.map((m) => m.sentBy)].filter(Boolean) as string[]),
    ];
    const people = peopleIds.length
      ? await tx.select({ id: profiles.id, name: profiles.fullName }).from(profiles).where(inArray(profiles.id, peopleIds))
      : [];
    const counts = { total: accounts.length, mapped: accounts.filter((a) => a.clientId).length };
    return { c, accounts, links, channelRows, clientRows, runs, webhooks, templates, messages, people, counts };
  });
  if (!data) return null;
  const { c } = data;
  const last = data.runs[0];
  return {
    connection: {
      id: c.id,
      provider: c.provider as ProviderKey,
      mode: c.mode as ConnectionMode,
      name: c.name,
      externalName: c.externalName,
      externalUserId: c.externalUserId,
      health: connectionHealth({ status: c.status as 'connected', tokenExpiresAt: c.tokenExpiresAt }),
      tokenExpiresAt: iso(c.tokenExpiresAt),
      lastSyncedAt: iso(c.lastSyncedAt),
      lastCheckedAt: iso(c.lastCheckedAt),
      lastErrorCode: c.lastErrorCode,
      lastErrorMessage: c.lastErrorMessage,
      accounts: data.counts.total,
      mappedAccounts: data.counts.mapped,
      lastRun: last ? { status: last.status as SyncStatus, finishedAt: iso(last.finishedAt), errorCode: last.errorCode } : null,
      scopes: c.scopes,
      connectedAt: c.connectedAt.toISOString(),
      connectedBy: c.connectedBy,
      settings: c.settings,
    },
    auth: providerCatalog[c.provider as ProviderKey].auth,
    accounts: data.accounts.map((a) => ({
      id: a.id,
      kind: a.kind as AccountKind,
      externalId: a.externalId,
      name: a.name,
      currency: a.currency,
      clientId: a.clientId,
      syncEnabled: a.syncEnabled,
      lastSyncedAt: iso(a.lastSyncedAt),
    })),
    links: data.links.map((l) => ({
      id: l.id,
      accountId: l.accountId,
      externalCampaignId: l.externalCampaignId,
      name: l.name,
      platformStatus: l.platformStatus,
      channelId: l.channelId,
    })),
    channels: data.channelRows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      platform: r.platform,
      label: `C-${r.campaignNumber} · ${r.campaignName}${r.channelName ? ` · ${r.channelName}` : ''}`,
    })),
    clients: data.clientRows,
    runs: data.runs.map((r) => ({
      id: r.id,
      trigger: r.trigger,
      dateFrom: r.dateFrom,
      dateTo: r.dateTo,
      status: r.status as SyncStatus,
      attempts: r.attempts,
      rowsWritten: r.rowsWritten,
      campaigns: r.campaigns,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      nextAttemptAt: r.status === 'failed' && r.attempts < 3 ? iso(r.nextAttemptAt) : null,
      createdAt: r.createdAt.toISOString(),
      finishedAt: iso(r.finishedAt),
      requestedBy: r.requestedBy,
    })),
    webhooks: data.webhooks.map((w) => ({
      id: w.id,
      topic: w.topic,
      status: w.status,
      signatureValid: w.signatureValid,
      error: w.error,
      receivedAt: w.receivedAt.toISOString(),
      leadId: w.leadId,
      externalId: w.externalId,
    })),
    templates: data.templates.map(templateRow),
    messages: data.messages.map(messageRow),
    people: Object.fromEntries(data.people.map((p) => [p.id, p.name])),
  };
}

/** Recent rejected / unrouted webhook deliveries across providers (they have no connection). */
export async function getUnroutedWebhooks(): Promise<number> {
  const [row] = await withRls((tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(integrationWebhookEvents)
      .where(and(eq(integrationWebhookEvents.status, 'ignored'), sql`${integrationWebhookEvents.receivedAt} > now() - interval '7 days'`)),
  );
  return row?.n ?? 0;
}

/* -------------------------------------------------------------------------- */
/* WhatsApp on the lead / deal page and in notification settings              */
/* -------------------------------------------------------------------------- */

export type WhatsAppPanelData = {
  phone: string | null;
  name: string;
  templates: TemplateRow[];
  messages: MessageRow[];
  people: Record<string, string>;
};

/** Templates the caller may send (approved, readable with `whatsapp:send`) and the history for a lead or deal. */
export async function getWhatsAppPanel(subject: { leadId: string } | { dealId: string }): Promise<WhatsAppPanelData | null> {
  return withRls(async (tx) => {
    let phone: string | null = null;
    let name = '';
    if ('leadId' in subject) {
      const [l] = await tx.select({ phone: leads.phone, name: leads.fullName }).from(leads).where(eq(leads.id, subject.leadId));
      if (!l) return null;
      phone = l.phone;
      name = l.name;
    } else {
      const [d] = await tx
        .select({
          leadPhone: leads.phone,
          leadName: leads.fullName,
          title: deals.title,
          contactPhone: sql<
            string | null
          >`(select c.phone from public.deal_contacts c where c.deal_id = deals.id order by c.is_primary desc limit 1)`,
          contactName: sql<
            string | null
          >`(select c.full_name from public.deal_contacts c where c.deal_id = deals.id order by c.is_primary desc limit 1)`,
        })
        .from(deals)
        .leftJoin(leads, eq(leads.id, deals.leadId))
        .where(eq(deals.id, subject.dealId));
      if (!d) return null;
      phone = normalizePhone(d.contactPhone) ?? d.leadPhone;
      name = d.contactName ?? d.leadName ?? d.title;
    }
    const templates = await tx
      .select({ t: whatsappTemplates })
      .from(whatsappTemplates)
      .where(and(eq(whatsappTemplates.status, 'approved'), sql`app.integration_connected(${whatsappTemplates.connectionId})`))
      .orderBy(asc(whatsappTemplates.name), asc(whatsappTemplates.language));
    const messages = await tx
      .select()
      .from(whatsappMessages)
      .where('leadId' in subject ? eq(whatsappMessages.leadId, subject.leadId) : eq(whatsappMessages.dealId, subject.dealId))
      .orderBy(desc(whatsappMessages.createdAt))
      .limit(20);
    const ids = [...new Set(messages.map((m) => m.sentBy).filter(Boolean) as string[])];
    const people = ids.length
      ? await tx.select({ id: profiles.id, name: profiles.fullName }).from(profiles).where(inArray(profiles.id, ids))
      : [];
    return {
      phone,
      name,
      templates: templates.map((r) => templateRow(r.t)),
      messages: messages.map(messageRow),
      people: Object.fromEntries(people.map((p) => [p.id, p.name])),
    };
  });
}

export type WhatsAppChannel = {
  available: boolean;
  optedIn: boolean;
  phone: string | null;
  optedInAt: string | null;
  suggestedPhone: string | null;
};

export async function getWhatsAppChannel(userId: string, organizationId: string): Promise<WhatsAppChannel> {
  return withRls(async (tx) => {
    const [avail] = await tx.execute<{ ok: boolean }>(sql`select app.whatsapp_notifications_available(${organizationId}::uuid) as ok`);
    const [opt] = await tx
      .select()
      .from(whatsappOptIns)
      .where(
        and(eq(whatsappOptIns.userId, userId), eq(whatsappOptIns.organizationId, organizationId), isNotNull(whatsappOptIns.optedInAt)),
      );
    const [me] = await tx.select({ phone: profiles.phone, whatsapp: profiles.whatsapp }).from(profiles).where(eq(profiles.id, userId));
    const optedIn = !!opt && !opt.optedOutAt;
    return {
      available: !!avail?.ok,
      optedIn,
      phone: optedIn ? opt!.phone : null,
      optedInAt: optedIn ? iso(opt!.optedInAt) : null,
      suggestedPhone: normalizePhone(me?.whatsapp) ?? normalizePhone(me?.phone),
    };
  });
}
