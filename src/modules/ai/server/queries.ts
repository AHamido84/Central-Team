import 'server-only';

import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import type { AgencyContext } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import { env } from '@/lib/env';
import {
  aiCredentials,
  aiInsights,
  aiRecommendations,
  aiSettings,
  campaignChannels,
  campaigns,
  clients,
  profiles,
  tasks,
} from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import { can } from '@/lib/permissions/can';
import type { InsightKind, InsightSeverity, InsightStatus, RecommendationKind } from '@/modules/ai/insights-core';
import { missingAiEnv, type AiMode } from '@/modules/ai/providers';
import { getAIClient } from '@/modules/ai/server/client';
import type { InsightFacts, RecommendationFacts } from '@/modules/ai/types';

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export type InsightFilters = {
  clientId?: string;
  campaignId?: string;
  severity?: InsightSeverity;
  kind?: InsightKind;
  /** `active` = open + acknowledged (the default view). */
  status?: InsightStatus | 'active' | 'all';
};

export type InsightListItem = {
  id: string;
  kind: InsightKind;
  metric: string | null;
  severity: InsightSeverity;
  status: InsightStatus;
  detectedOn: string;
  lastDetectedAt: string;
  facts: InsightFacts;
  campaign: { id: string; name: string };
  client: { id: string; name: LocalizedText };
  recommendations: number;
};

const severityOrder = sql`case ${aiInsights.severity} when 'critical' then 0 when 'warning' then 1 else 2 end`;

export async function listInsights(filters: InsightFilters = {}): Promise<InsightListItem[]> {
  const status = filters.status ?? 'active';
  const where: (SQL | undefined)[] = [
    filters.clientId ? eq(aiInsights.clientId, filters.clientId) : undefined,
    filters.campaignId ? eq(aiInsights.campaignId, filters.campaignId) : undefined,
    filters.severity ? eq(aiInsights.severity, filters.severity) : undefined,
    filters.kind ? eq(aiInsights.kind, filters.kind) : undefined,
    status === 'all'
      ? undefined
      : status === 'active'
        ? inArray(aiInsights.status, ['open', 'acknowledged'])
        : eq(aiInsights.status, status),
  ];
  const rows = await withRls((tx) =>
    tx
      .select({
        i: aiInsights,
        campaignName: campaigns.name,
        clientName: clients.name,
        recommendations: sql<number>`(select count(*)::int from public.ai_recommendations r where r.insight_id = ${aiInsights.id} and r.status = 'proposed')`,
      })
      .from(aiInsights)
      .innerJoin(campaigns, eq(campaigns.id, aiInsights.campaignId))
      .innerJoin(clients, eq(clients.id, aiInsights.clientId))
      .where(and(...where))
      .orderBy(sql`${aiInsights.status} in ('resolved','dismissed')`, severityOrder, desc(aiInsights.lastDetectedAt))
      .limit(200),
  );
  return rows.map((r) => ({
    id: r.i.id,
    kind: r.i.kind as InsightKind,
    metric: r.i.metric,
    severity: r.i.severity as InsightSeverity,
    status: r.i.status as InsightStatus,
    detectedOn: r.i.detectedOn,
    lastDetectedAt: iso(r.i.lastDetectedAt)!,
    facts: r.i.facts,
    campaign: { id: r.i.campaignId, name: r.campaignName },
    client: { id: r.i.clientId, name: r.clientName },
    recommendations: r.recommendations,
  }));
}

export type RecommendationItem = {
  id: string;
  kind: RecommendationKind;
  status: 'proposed' | 'accepted' | 'dismissed';
  facts: RecommendationFacts;
  taskId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  dismissReason: string | null;
};

export type InsightDetail = InsightListItem & {
  channel: { id: string; platform: string; name: string } | null;
  explanation: string | null;
  explanationLocale: 'ar' | 'en' | null;
  explainedAt: string | null;
  firstDetectedAt: string;
  resolvedAt: string | null;
  dismissReason: string | null;
  actedBy: string | null;
  actedAt: string | null;
  recommendationList: RecommendationItem[];
};

export async function getInsight(insightId: string): Promise<InsightDetail | null> {
  return withRls(async (tx) => {
    const [r] = await tx
      .select({
        i: aiInsights,
        campaignName: campaigns.name,
        clientName: clients.name,
        channel: { id: campaignChannels.id, platform: campaignChannels.platform, name: campaignChannels.name },
        actedBy: profiles.fullName,
      })
      .from(aiInsights)
      .innerJoin(campaigns, eq(campaigns.id, aiInsights.campaignId))
      .innerJoin(clients, eq(clients.id, aiInsights.clientId))
      .leftJoin(campaignChannels, eq(campaignChannels.id, aiInsights.channelId))
      .leftJoin(profiles, eq(profiles.id, aiInsights.actedBy))
      .where(eq(aiInsights.id, insightId));
    if (!r) return null;
    const recs = await tx
      .select({ r: aiRecommendations, decidedBy: profiles.fullName, taskVisible: tasks.id })
      .from(aiRecommendations)
      .leftJoin(profiles, eq(profiles.id, aiRecommendations.decidedBy))
      .leftJoin(tasks, eq(tasks.id, aiRecommendations.taskId))
      .where(eq(aiRecommendations.insightId, insightId))
      .orderBy(aiRecommendations.createdAt);
    return {
      id: r.i.id,
      kind: r.i.kind as InsightKind,
      metric: r.i.metric,
      severity: r.i.severity as InsightSeverity,
      status: r.i.status as InsightStatus,
      detectedOn: r.i.detectedOn,
      lastDetectedAt: iso(r.i.lastDetectedAt)!,
      firstDetectedAt: iso(r.i.firstDetectedAt)!,
      resolvedAt: iso(r.i.resolvedAt),
      facts: r.i.facts,
      campaign: { id: r.i.campaignId, name: r.campaignName },
      client: { id: r.i.clientId, name: r.clientName },
      channel: r.channel?.id ? r.channel : null,
      explanation: r.i.explanation,
      explanationLocale: (r.i.explanationLocale as 'ar' | 'en' | null) ?? null,
      explainedAt: iso(r.i.explainedAt),
      dismissReason: r.i.dismissReason,
      actedBy: r.actedBy,
      actedAt: iso(r.i.actedAt),
      recommendations: recs.filter((x) => x.r.status === 'proposed').length,
      recommendationList: recs.map((x) => ({
        id: x.r.id,
        kind: x.r.kind as RecommendationKind,
        status: x.r.status as RecommendationItem['status'],
        facts: x.r.facts,
        // Only link a task the reader can open.
        taskId: x.taskVisible ?? null,
        decidedBy: x.decidedBy,
        decidedAt: iso(x.r.decidedAt),
        dismissReason: x.r.dismissReason,
      })),
    };
  });
}

/** Open + acknowledged insights per campaign (for the campaign tab badge). */
export async function countActiveInsights(campaignId: string): Promise<number> {
  const [row] = await withRls((tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(aiInsights)
      .where(and(eq(aiInsights.campaignId, campaignId), inArray(aiInsights.status, ['open', 'acknowledged']))),
  );
  return row?.n ?? 0;
}

export type AiAvailability = {
  /** The organization switched AI on. */
  enabled: boolean;
  mode: AiMode;
  /** The viewer may use AI features (explain, draft, assistant) right now. */
  usable: boolean;
};

export async function getAiAvailability(ctx: AgencyContext): Promise<AiAvailability> {
  // Never throws (FR3.2): a provider-side problem (e.g. a key that can't be decrypted) must not take the page down —
  // the composer stays available and the reply explains what is wrong.
  let mode: AiMode = 'off';
  try {
    mode = (await getAIClient(ctx.organization.id)).mode;
  } catch (error) {
    console.error('[ai] availability check failed', error);
    mode = 'live';
  }
  if (!can(ctx.permissions, 'ai:use') && !can(ctx.permissions, 'ai:manage')) return { enabled: false, mode, usable: false };
  const [row] = await withRls((tx) => tx.select({ enabled: aiSettings.enabled }).from(aiSettings).limit(1));
  const enabled = Boolean(row?.enabled);
  return { enabled, mode, usable: enabled && mode !== 'off' && can(ctx.permissions, 'ai:use') };
}

export type AiAdminView = {
  settings: { enabled: boolean; sensitivity: 'low' | 'normal' | 'high'; autoDraftReports: boolean; monthlyTokenBudget: number };
  mode: AiMode;
  missing: string[];
  model: string;
  embeddingModel: string;
  /** The embedder in use; null = none, so the assistant searches by keyword through its tools (Voyage is optional). */
  embedder: string | null;
  usage: { total: number; byPurpose: Record<string, number> };
  /** Provider keys stored for the organization — masked; the key never leaves the server (ADR-085). */
  credentials: AiCredentialView[];
  /** Per provider: an active organization credential is in use (otherwise the environment keys, if any). */
  sources: { anthropic: boolean; voyage: boolean };
  envKeys: { anthropic: boolean; voyage: boolean };
};

export type AiCredentialView = {
  id: string;
  provider: 'anthropic' | 'voyage';
  displayName: string;
  keyHint: string;
  defaultModel: string | null;
  monthlyTokenLimit: number | null;
  isActive: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  usedThisMonth: number;
};

export async function getAiAdmin(organizationId: string): Promise<AiAdminView> {
  const client = await getAIClient(organizationId);
  return withRls(async (tx) => {
    const [s] = await tx.select().from(aiSettings).limit(1);
    const usage = await tx.execute<{ purpose: string; n: number }>(sql`
      select purpose, coalesce(sum(input_tokens + output_tokens), 0)::int as n from public.ai_usage
      where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
      group by purpose`);
    const byPurpose = Object.fromEntries(usage.map((u) => [u.purpose, u.n]));
    const byProvider = await tx.execute<{ provider: string; n: number }>(sql`
      select provider, coalesce(sum(input_tokens + output_tokens), 0)::int as n from public.ai_usage
      where created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
      group by provider`);
    // Every column but `secret_id`, which users may not select (ADR-085).
    const creds = await tx
      .select({
        id: aiCredentials.id,
        provider: aiCredentials.provider,
        displayName: aiCredentials.displayName,
        keyHint: aiCredentials.keyHint,
        defaultModel: aiCredentials.defaultModel,
        monthlyTokenLimit: aiCredentials.monthlyTokenLimit,
        isActive: aiCredentials.isActive,
        lastTestedAt: aiCredentials.lastTestedAt,
        lastTestOk: aiCredentials.lastTestOk,
        lastTestError: aiCredentials.lastTestError,
      })
      .from(aiCredentials)
      .orderBy(asc(aiCredentials.provider), asc(aiCredentials.createdAt));
    const mode = client.mode;
    return {
      settings: {
        enabled: Boolean(s?.enabled),
        sensitivity: (s?.sensitivity as 'low' | 'normal' | 'high') ?? 'normal',
        autoDraftReports: Boolean(s?.autoDraftReports),
        monthlyTokenBudget: s?.monthlyTokenBudget ?? 0,
      },
      mode,
      // Only the writer is required: without Voyage the assistant uses keyword search (ADR-090).
      missing: mode === 'off' ? missingAiEnv().filter((k) => k === 'ANTHROPIC_API_KEY' && !client.sources.anthropic) : [],
      model: client.completer?.model ?? env().AI_MODEL,
      embeddingModel: client.embedder?.model ?? env().AI_EMBEDDING_MODEL,
      embedder: client.embedder?.model ?? null,
      usage: { total: Object.values(byPurpose).reduce((a, b) => a + b, 0), byPurpose },
      credentials: creds.map((c) => ({
        id: c.id,
        provider: c.provider as AiCredentialView['provider'],
        displayName: c.displayName,
        keyHint: c.keyHint,
        defaultModel: c.defaultModel,
        monthlyTokenLimit: c.monthlyTokenLimit,
        isActive: c.isActive,
        lastTestedAt: c.lastTestedAt?.toISOString() ?? null,
        lastTestOk: c.lastTestOk,
        lastTestError: c.lastTestError,
        usedThisMonth: byProvider.find((p) => p.provider === c.provider)?.n ?? 0,
      })),
      sources: { anthropic: Boolean(client.sources.anthropic), voyage: Boolean(client.sources.voyage) },
      envKeys: { anthropic: Boolean(env().ANTHROPIC_API_KEY), voyage: Boolean(env().VOYAGE_API_KEY) },
    };
  });
}
