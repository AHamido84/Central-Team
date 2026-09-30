/**
 * Phase 7 seed: sandbox platform connections (Meta with two ad accounts and a page, TikTok, WhatsApp Business, an
 * expired Google connection), tokens in Supabase Vault, ad accounts mapped to demo clients and platform campaigns
 * linked to campaign channels, 14 days of synced numbers (the same deterministic sandbox data a sync would write), a
 * sync log with a retried failure, webhook events (a processed lead ad, a rejected signature, delivery statuses),
 * WhatsApp templates / messages / an opt-in, and example automations with a run history.
 * Runs as the table owner (listed service path): the guards treat every write as a trusted system change.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../src/lib/db/schema';
import { countTemplateParams } from '../src/modules/integrations/constants';
import { aggregateToChannels, flightDays } from '../src/modules/integrations/metrics';
import { SANDBOX_TEMPLATES, sandboxProvider } from '../src/modules/integrations/providers/sandbox';
import type { TokenSet } from '../src/modules/integrations/providers/types';
import type { AutomationAction, AutomationCondition } from '../src/modules/automations/types';

type Db = PostgresJsDatabase<typeof schema>;

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function seedIntegrationsData({
  db,
  ids,
  clientIds,
  orgId,
  today,
}: {
  db: Db;
  ids: Record<string, string>;
  clientIds: Record<string, string>;
  orgId: string;
  today: string;
}) {
  const putSecret = (connectionId: string, tokens: TokenSet) =>
    db.execute(sql`select app.integration_put_secret(${connectionId}::uuid, ${JSON.stringify(tokens)})`);

  async function connection(values: {
    provider: 'meta' | 'tiktok' | 'whatsapp' | 'google';
    name: string;
    status?: 'connected' | 'expired';
    expiresInDays: number | null;
    settings?: Record<string, string>;
    lastErrorCode?: string;
    connectedDaysAgo: number;
    connectedBy: string;
  }) {
    const id = crypto.randomUUID();
    const expiresAt = values.expiresInDays === null ? null : new Date(Date.now() + values.expiresInDays * 86_400_000);
    await db.insert(schema.integrationConnections).values({
      id,
      organizationId: orgId,
      provider: values.provider,
      mode: 'sandbox',
      name: values.name,
      status: values.status ?? 'connected',
      externalUserId: `sbx_user_${values.provider}`,
      externalName: `Sandbox ${values.provider}`,
      scopes: values.provider === 'whatsapp' ? ['whatsapp_business_messaging'] : ['ads_read', 'leads_retrieval'],
      tokenExpiresAt: expiresAt,
      settings: values.settings ?? {},
      lastCheckedAt: daysAgo(values.status === 'expired' ? 2 : 0),
      lastSyncedAt: values.provider === 'meta' || values.provider === 'tiktok' ? daysAgo(0) : null,
      lastErrorCode: values.lastErrorCode ?? null,
      lastErrorMessage: values.lastErrorCode ? 'sandbox token expired' : null,
      connectedBy: values.connectedBy,
      connectedAt: daysAgo(values.connectedDaysAgo),
    });
    await putSecret(id, {
      accessToken: `sbx_seed_${values.provider}_${id.slice(0, 8)}`,
      refreshToken: values.provider === 'whatsapp' || values.status === 'expired' ? null : `sbxr_seed_${values.provider}`,
      expiresAt: expiresAt?.toISOString() ?? null,
      scopes: ['sandbox'],
    });
    const accounts = await sandboxProvider(values.provider, 'http://localhost:3000').listAccounts({
      connectionId: id,
      mode: 'sandbox',
      tokens: { accessToken: 'sbx_seed' },
      settings: {},
    });
    const rows = await db
      .insert(schema.integrationAccounts)
      .values(
        accounts.map((a) => ({
          organizationId: orgId,
          connectionId: id,
          kind: a.kind,
          externalId: a.externalId,
          name: a.name,
          currency: a.currency ?? null,
          timezone: a.timezone ?? null,
          metadata: a.metadata ?? {},
        })),
      )
      .returning();
    return { id, accounts: rows };
  }

  // --- Connections ---------------------------------------------------------
  const meta = await connection({
    provider: 'meta',
    name: 'Meta — Ofoq Business',
    expiresInDays: 52,
    connectedDaysAgo: 20,
    connectedBy: ids.faisal!,
  });
  const tiktok = await connection({
    provider: 'tiktok',
    name: 'TikTok for Business',
    expiresInDays: null,
    connectedDaysAgo: 15,
    connectedBy: ids.faisal!,
  });
  const whatsapp = await connection({
    provider: 'whatsapp',
    name: 'WhatsApp — Ofoq',
    expiresInDays: null,
    settings: { phoneNumberId: 'sbx_wa_7001', wabaId: 'sbx_waba_7000' },
    connectedDaysAgo: 12,
    connectedBy: ids.sara!,
  });
  const google = await connection({
    provider: 'google',
    name: 'Google Ads — Ofoq MCC',
    status: 'expired',
    expiresInDays: -2,
    lastErrorCode: 'auth_expired',
    connectedDaysAgo: 40,
    connectedBy: ids.faisal!,
  });

  // --- Mapping: ad accounts → clients, platform campaigns → campaign channels -------------------------
  const channels = await db
    .select({
      id: schema.campaignChannels.id,
      platform: schema.campaignChannels.platform,
      clientId: schema.campaignChannels.clientId,
      campaignId: schema.campaigns.id,
      start: schema.campaigns.startDate,
      end: schema.campaigns.endDate,
      status: schema.campaigns.status,
    })
    .from(schema.campaignChannels)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignChannels.campaignId))
    .where(eq(schema.campaignChannels.organizationId, orgId));
  const channelFor = (client: string, platform: string) =>
    channels.find((c) => c.clientId === clientIds[client] && c.platform === platform && c.status === 'active');

  const plan = [
    { conn: meta, account: 'act_sbx_1001', client: 'future-smile', platform: 'meta' },
    { conn: meta, account: 'act_sbx_1002', client: 'lujain-fashion', platform: 'meta' },
    { conn: tiktok, account: 'sbx_tt_3001', client: 'darb-coffee', platform: 'tiktok' },
  ];
  let rowsWritten = 0;
  const from = addDays(today, -13);
  for (const p of plan) {
    const account = p.conn.accounts.find((a) => a.externalId === p.account)!;
    const channel = channelFor(p.client, p.platform);
    await db
      .update(schema.integrationAccounts)
      .set({ clientId: clientIds[p.client]!, syncEnabled: true, lastSyncedAt: daysAgo(0) })
      .where(eq(schema.integrationAccounts.id, account.id));
    const provider = sandboxProvider(p.conn === meta ? 'meta' : 'tiktok', 'http://localhost:3000');
    const ctx = { connectionId: p.conn.id, mode: 'sandbox' as const, tokens: { accessToken: 'sbx_seed' }, settings: {} };
    const campaigns = await provider.listCampaigns!(ctx, { externalId: account.externalId, kind: 'ad_account', metadata: {} });
    for (const [i, c] of campaigns.entries()) {
      await db.insert(schema.integrationCampaignLinks).values({
        organizationId: orgId,
        accountId: account.id,
        externalCampaignId: c.externalId,
        name: c.name,
        platformStatus: c.status,
        // The first platform campaign feeds the client's live campaign; the rest stay unlinked (to link in the UI).
        channelId: i === 0 && channel ? channel.id : null,
      });
    }
    if (!channel) continue;
    // Same numbers a sync of the last 14 days writes (deterministic sandbox data, summed per channel and day).
    const metrics = await provider.fetchDailyMetrics!(
      ctx,
      { externalId: account.externalId, kind: 'ad_account', metadata: {} },
      {
        campaignIds: [campaigns[0]!.externalId],
        from,
        to: today,
      },
    );
    const perChannel = aggregateToChannels(
      metrics,
      new Map([[campaigns[0]!.externalId, channel.id]]),
      new Map([[channel.id, flightDays(from, today, channel.start, channel.end)]]),
    );
    for (const [date, d] of perChannel.get(channel.id)!) {
      await db
        .insert(schema.metricsDaily)
        .values({
          organizationId: orgId,
          clientId: channel.clientId,
          campaignId: channel.campaignId,
          channelId: channel.id,
          date,
          ...d,
          source: 'api',
        })
        .onConflictDoUpdate({
          target: [schema.metricsDaily.channelId, schema.metricsDaily.date],
          set: { ...d, source: 'api', importId: null, updatedBy: null },
        });
      rowsWritten++;
    }
  }

  // --- Sync log ------------------------------------------------------------------------------------
  const run = (v: Partial<typeof schema.integrationSyncRuns.$inferInsert> & { connectionId: string }) =>
    db.insert(schema.integrationSyncRuns).values({
      organizationId: orgId,
      trigger: 'scheduled',
      dateFrom: addDays(today, -2),
      dateTo: today,
      status: 'succeeded',
      attempts: 1,
      startedAt: daysAgo(0),
      finishedAt: daysAgo(0),
      ...v,
    });
  await run({
    connectionId: meta.id,
    trigger: 'backfill',
    dateFrom: from,
    dateTo: addDays(today, -3),
    rowsWritten: 24,
    campaigns: 2,
    requestedBy: ids.faisal!,
    createdAt: daysAgo(14),
    startedAt: daysAgo(14),
    finishedAt: daysAgo(14),
  });
  await run({
    connectionId: meta.id,
    status: 'failed',
    attempts: 3,
    errorCode: 'rate_limited',
    errorMessage: 'Application request limit reached',
    dateFrom: addDays(today, -3),
    dateTo: addDays(today, -1),
    createdAt: daysAgo(1),
    startedAt: daysAgo(1),
    finishedAt: daysAgo(1),
  });
  await run({
    connectionId: meta.id,
    trigger: 'retry',
    dateFrom: addDays(today, -3),
    dateTo: addDays(today, -1),
    rowsWritten: 6,
    campaigns: 2,
    requestedBy: ids.faisal!,
    createdAt: daysAgo(1),
    startedAt: daysAgo(1),
    finishedAt: daysAgo(1),
  });
  await run({ connectionId: meta.id, rowsWritten: 6, campaigns: 2 });
  await run({
    connectionId: tiktok.id,
    trigger: 'backfill',
    dateFrom: from,
    dateTo: addDays(today, -1),
    rowsWritten: 13,
    campaigns: 1,
    requestedBy: ids.faisal!,
    createdAt: daysAgo(13),
    startedAt: daysAgo(13),
    finishedAt: daysAgo(13),
  });
  await run({ connectionId: tiktok.id, rowsWritten: 3, campaigns: 1 });
  await run({
    connectionId: google.id,
    status: 'failed',
    attempts: 3,
    errorCode: 'auth_expired',
    errorMessage: 'sandbox token expired',
    createdAt: daysAgo(2),
    startedAt: daysAgo(2),
    finishedAt: daysAgo(2),
  });

  // --- A lead that came from a Meta lead ad, and the webhook log around it -----------------------------
  const page = meta.accounts.find((a) => a.kind === 'page')!;
  const [lead] = await db
    .insert(schema.leads)
    .values({
      organizationId: orgId,
      fullName: 'ريم القحطاني',
      phone: '+966551230077',
      email: 'reem.q@example.com',
      source: 'lead_ad',
      sourceDetail: 'Meta · 77120',
      externalRef: 'meta:sbx_lead_90001',
      services: ['ads', 'social_media'],
      budgetRange: '15k_50k',
      city: 'riyadh',
      ownerId: ids.ruba!,
      status: 'contacted',
      score: 55,
      tags: ['meta'],
      notes: 'preferred_time: evening',
      createdAt: daysAgo(3),
      lastActivityAt: daysAgo(2),
    })
    .returning({ id: schema.leads.id });
  await db.insert(schema.integrationWebhookEvents).values([
    {
      organizationId: orgId,
      provider: 'meta',
      connectionId: meta.id,
      accountId: page.id,
      externalId: 'sandbox:sbx_lead_90001',
      topic: 'lead',
      signatureValid: true,
      status: 'processed',
      attempts: 1,
      payload: {
        topic: 'lead',
        externalId: 'sbx_lead_90001',
        leadId: 'sbx_lead_90001',
        formId: '77120',
        route: { kind: 'page', externalId: page.externalId },
        fields: null,
      },
      leadId: lead!.id,
      receivedAt: daysAgo(3),
      processedAt: daysAgo(3),
    },
    { provider: 'meta', signatureValid: false, status: 'rejected', topic: 'other', error: 'invalid_signature', receivedAt: daysAgo(1) },
  ]);

  // --- WhatsApp: templates (one notification template per language), messages, an opt-in ----------------
  const templates = await db
    .insert(schema.whatsappTemplates)
    .values(
      SANDBOX_TEMPLATES.map((t) => ({
        organizationId: orgId,
        connectionId: whatsapp.id,
        name: t.name,
        language: t.language,
        languageCode: t.language,
        category: t.category,
        status: t.status,
        body: t.body,
        paramCount: countTemplateParams(t.body),
        isNotification: t.name === 'central_notification',
      })),
    )
    .returning();
  const welcomeAr = templates.find((t) => t.name === 'lead_welcome' && t.language === 'ar')!;
  const notifyAr = templates.find((t) => t.name === 'central_notification' && t.language === 'ar')!;
  await db.insert(schema.whatsappMessages).values([
    {
      organizationId: orgId,
      connectionId: whatsapp.id,
      toPhone: '+966551230077',
      templateName: welcomeAr.name,
      language: 'ar',
      params: ['ريم', 'أفق'],
      body: 'أهلًا ريم، شكرًا لتواصلك مع أفق. سيتواصل معك أحد مستشارينا قريبًا.',
      purpose: 'lead',
      leadId: lead!.id,
      externalId: 'wamid.sbx.seed0001',
      status: 'read',
      attempts: 1,
      sentBy: ids.ruba!,
      sentAt: daysAgo(2),
      deliveredAt: daysAgo(2),
      readAt: daysAgo(2),
      createdAt: daysAgo(2),
    },
    {
      organizationId: orgId,
      connectionId: whatsapp.id,
      toPhone: '+966501110001',
      templateName: notifyAr.name,
      language: 'ar',
      params: ['صفقة مكسوبة', 'أُغلقت D-3'],
      body: 'صفقة مكسوبة\nأُغلقت D-3',
      purpose: 'notification',
      recipientUserId: ids.sara!,
      notificationType: 'deal_won',
      externalId: 'wamid.sbx.seed0002',
      status: 'delivered',
      attempts: 1,
      sentAt: daysAgo(1),
      deliveredAt: daysAgo(1),
      createdAt: daysAgo(1),
    },
  ]);
  await db.insert(schema.crmActivities).values({
    organizationId: orgId,
    leadId: lead!.id,
    type: 'whatsapp',
    subject: 'whatsapp_sent',
    body: 'أهلًا ريم، شكرًا لتواصلك مع أفق. سيتواصل معك أحد مستشارينا قريبًا.',
    ownerId: ids.ruba!,
    completedAt: daysAgo(2),
    createdAt: daysAgo(2),
  });
  await db
    .insert(schema.whatsappOptIns)
    .values({ userId: ids.sara!, organizationId: orgId, phone: '+966501110001', optedInAt: daysAgo(12) });
  for (const category of ['sales', 'integrations']) {
    await db
      .insert(schema.notificationPreferences)
      .values({ userId: ids.sara!, organizationId: orgId, category, inApp: true, email: true, whatsapp: true })
      .onConflictDoUpdate({
        target: [
          schema.notificationPreferences.userId,
          schema.notificationPreferences.organizationId,
          schema.notificationPreferences.category,
        ],
        set: { whatsapp: true },
      });
  }

  // --- Automations -------------------------------------------------------------------------------------
  const rule = async (v: {
    name: string;
    description: string;
    isActive: boolean;
    triggerType: string;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
    runs: { status: 'succeeded' | 'failed' | 'skipped'; skipReason?: 'conditions' | 'loop_self'; days: number; error?: string }[];
  }) => {
    const id = crypto.randomUUID();
    const done = v.runs.filter((r) => r.status !== 'skipped');
    await db.insert(schema.automations).values({
      id,
      organizationId: orgId,
      name: v.name,
      description: v.description,
      isActive: v.isActive,
      triggerType: v.triggerType,
      conditions: v.conditions,
      actions: v.actions,
      runCount: done.length,
      failureCount: done.filter((r) => r.status === 'failed').length,
      lastRunAt: v.runs.length ? daysAgo(Math.min(...v.runs.map((r) => r.days))) : null,
      createdBy: ids.sara!,
      updatedBy: ids.sara!,
      createdAt: daysAgo(10),
    });
    for (const r of v.runs)
      await db.insert(schema.automationRuns).values({
        organizationId: orgId,
        automationId: id,
        eventType: v.triggerType,
        status: r.status,
        skipReason: r.skipReason ?? null,
        conditions: v.conditions.map((c) => ({
          field: c.field,
          op: c.op,
          expected: c.value ?? null,
          actual: r.skipReason === 'conditions' ? 'jeddah' : (c.value ?? null),
          passed: r.skipReason !== 'conditions',
        })),
        actions:
          r.status === 'skipped'
            ? []
            : v.actions.map((a, i) => ({
                id: a.id,
                type: a.type,
                status: r.status === 'failed' && i === v.actions.length - 1 ? ('failed' as const) : ('succeeded' as const),
                ...(r.status === 'failed' && i === v.actions.length - 1 ? { error: r.error ?? 'action_failed' } : {}),
              })),
        error: r.status === 'failed' ? (r.error ?? 'action_failed') : null,
        attempts: r.status === 'failed' ? 3 : 1,
        startedAt: daysAgo(r.days),
        finishedAt: daysAgo(r.days),
      });
    return id;
  };

  await rule({
    name: 'عملاء إعلانات الرياض ← توزيع وترحيب واتساب',
    description: 'Lead ads from Riyadh: round-robin between Majed and Ruba, then the welcome template on WhatsApp.',
    isActive: true,
    triggerType: 'lead.created',
    conditions: [
      { field: 'lead.source', op: 'eq', value: 'lead_ad' },
      { field: 'lead.city', op: 'eq', value: 'riyadh' },
    ],
    actions: [
      { id: 'assign', type: 'assign', config: { userIds: [ids.majed!, ids.ruba!] } },
      {
        id: 'welcome',
        type: 'send_whatsapp',
        config: { to: 'record', phone: '', templateId: welcomeAr.id, params: ['{{lead.full_name}}', 'أفق'] },
      },
    ],
    runs: [
      { status: 'succeeded', days: 3 },
      { status: 'skipped', skipReason: 'conditions', days: 2 },
      { status: 'failed', days: 1, error: 'invalid_phone' },
    ],
  });
  await rule({
    name: 'SLA breach → follow-up task for the account manager',
    description: 'Creates a same-day task on the request and tells the client’s account manager.',
    isActive: true,
    triggerType: 'sla.breached',
    conditions: [],
    actions: [
      {
        id: 'task',
        type: 'create_task',
        config: {
          title: 'SLA follow-up: {{request.reference}}',
          description: '{{request.title}}',
          dueInDays: 0,
          priority: 'urgent',
          assigneeIds: [],
          departmentId: null,
        },
      },
      {
        id: 'notify',
        type: 'notify',
        config: {
          recipients: ['account_manager'],
          userIds: [],
          title: 'SLA breached on {{request.reference}}',
          body: '{{request.client_name}} · {{request.title}}',
        },
      },
    ],
    runs: [{ status: 'succeeded', days: 4 }],
  });
  await rule({
    name: 'Deal won → tell the leadership',
    description: 'Notifies Sara and Majed when any deal is won.',
    isActive: true,
    triggerType: 'deal.won',
    conditions: [{ field: 'deal.value_sar', op: 'gte', value: 10000 }],
    actions: [
      {
        id: 'notify',
        type: 'notify',
        config: {
          recipients: ['users'],
          userIds: [ids.sara!, ids.majed!],
          title: '🎉 {{deal.title}}',
          body: '{{deal.value_sar}} SAR · {{deal.reference}}',
        },
      },
    ],
    runs: [{ status: 'succeeded', days: 6 }],
  });
  await rule({
    name: 'Campaign off track → owner + BI webhook',
    description: 'Paused until the BI endpoint is ready.',
    isActive: false,
    triggerType: 'campaign.health_changed',
    conditions: [{ field: 'event.to', op: 'eq', value: 'off_track' }],
    actions: [
      { id: 'notify', type: 'notify', config: { recipients: ['owner'], userIds: [], title: '{{campaign.name}} is off track', body: '' } },
      { id: 'hook', type: 'webhook', config: { url: 'https://hooks.example.com/central/campaigns' } },
    ],
    runs: [],
  });

  // The expired Google connection keeps its accounts unmapped (it needs a reconnect first).
  await db
    .update(schema.integrationAccounts)
    .set({ syncEnabled: false })
    .where(and(eq(schema.integrationAccounts.connectionId, google.id)));

  console.info(
    `✓ Seeded 4 sandbox connections (tokens in Vault), ${plan.length} mapped ad accounts, ${rowsWritten} synced metric rows, a lead ad, ${templates.length} WhatsApp templates and 4 automations.`,
  );
}
