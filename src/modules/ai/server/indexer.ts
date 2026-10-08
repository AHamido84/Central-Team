import 'server-only';

import { eq, sql } from 'drizzle-orm';
import { after } from 'next/server';

import { ActionFailure } from '@/lib/actions/errors';
import { dbAdmin } from '@/lib/db/client';
import { organizations } from '@/lib/db/schema';
import type { StoredEvent } from '@/lib/events/dispatcher';
import type { Locale } from '@/lib/i18n/localized';
import { indexSources, indexStatus, pruneOrphans, staleSources } from '@/modules/ai/indexer-core';
import { textKit } from '@/modules/ai/kit';
import { assertAiReady, currentEmbedder, embedTexts } from '@/modules/ai/server/runtime';
import type { SourceType } from '@/modules/ai/types';

type Target = { type: SourceType; id: string };

/** Which records an event touches (the index follows them). */
export function targetsOf(event: StoredEvent): Target[] {
  const p = event.payload as Record<string, unknown>;
  const pick = (type: SourceType, ...keys: string[]) =>
    keys
      .map((k) => p[k])
      .filter((v): v is string => typeof v === 'string')
      .map((id) => ({ type, id }));
  const [area] = event.type.split('.');
  switch (area) {
    case 'client':
      return pick('client', 'clientId');
    case 'campaign':
    case 'metrics':
      return pick('campaign', 'campaignId');
    case 'request':
      return pick('request', 'requestId');
    case 'task':
      return pick('task', 'taskId');
    case 'report':
      return pick('report', 'reportId');
    case 'lead':
      return pick('lead', 'leadId', 'mergedId');
    case 'deal':
      return pick('deal', 'dealId');
    case 'trash': {
      // A lead in the Trash leaves the index; restored, it comes back (FR5). Other types follow their own events.
      if (p.entityType !== 'lead') return [];
      return typeof p.entityId === 'string' ? [{ type: 'lead', id: p.entityId }] : [];
    }
    case 'ai_insight':
      // The campaign's chunk carries its open-insight count.
      return [...pick('insight', 'insightId'), ...pick('campaign', 'campaignId')];
    default:
      return [];
  }
}

async function orgLocale(organizationId: string): Promise<{ locale: Locale; tz: string }> {
  const [org] = await dbAdmin
    .select({ locale: organizations.defaultLocale, tz: organizations.defaultTimezone })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return { locale: org?.locale === 'en' ? 'en' : 'ar', tz: org?.tz ?? 'Asia/Riyadh' };
}

/**
 * Indexes some records of one organization (service path, ADR-075): chunks are written for the whole organization
 * and filtered per reader by the chunk policy. Nothing happens while AI is off or the budget is spent (ADR-076) —
 * the daily catch-up fills the gap once it is back on.
 */
export async function indexTargets(organizationId: string, targets: readonly Target[]): Promise<number> {
  if (targets.length === 0) return 0;
  try {
    await assertAiReady(organizationId);
  } catch (error) {
    if (error instanceof ActionFailure) return 0;
    throw error;
  }
  const embedder = await currentEmbedder(organizationId);
  if (!embedder) return 0;
  const { locale, tz } = await orgLocale(organizationId);
  const kit = textKit(locale, tz);
  const byType = new Map<SourceType, string[]>();
  for (const t of targets) byType.set(t.type, [...new Set([...(byType.get(t.type) ?? []), t.id])]);
  let embedded = 0;
  for (const [type, ids] of byType) {
    const r = await dbAdmin.transaction((tx) =>
      indexSources(tx, type, ids, {
        kit,
        locale,
        embedder,
        embed: (texts) => embedTexts(embedder, { organizationId, userId: null }, texts, 'document'),
      }),
    );
    embedded += r.embedded;
  }
  return embedded;
}

export async function reindexForEvent(event: StoredEvent): Promise<void> {
  await indexTargets(event.organizationId, targetsOf(event));
}

/** Works through missing / outdated chunks in batches (daily catch-up, and "Rebuild index" with a larger cap). */
export async function catchUpIndex(organizationId: string, maxSources = 300): Promise<number> {
  const embedder = await currentEmbedder(organizationId);
  if (!embedder) return 0;
  try {
    await assertAiReady(organizationId);
  } catch (error) {
    if (error instanceof ActionFailure) return 0;
    throw error;
  }
  // Chunks of records deleted without an event (cascades) are dropped first.
  await dbAdmin.transaction((tx) => pruneOrphans(tx, organizationId));
  let done = 0;
  while (done < maxSources) {
    const batch = await dbAdmin.transaction((tx) => staleSources(tx, organizationId, embedder.model, Math.min(100, maxSources - done)));
    if (batch.length === 0) break;
    // Every source in a batch is embedded, marked checked or dropped, so the next batch moves on.
    await indexTargets(organizationId, batch);
    done += batch.length;
  }
  return done;
}

export type IndexHealth = {
  /** The embedding model the index follows; null = no embedder, so the assistant uses keyword search (ADR-090). */
  model: string | null;
  byType: Record<string, number>;
  /** Chunks embedded with the current model, and with another one (replaced as the re-index works through them). */
  chunks: number;
  otherModel: number;
  stale: number;
  lastBuiltAt: string | null;
  /** Share of indexable records whose chunk is current (0–100). */
  progress: number;
};

/** Index health for `/admin/ai` (FR3.4) — service path: the index covers the whole organization (ADR-075). */
export async function getIndexStatus(organizationId: string): Promise<IndexHealth> {
  const embedder = await currentEmbedder(organizationId);
  return dbAdmin.transaction(async (tx) => {
    const model = embedder?.model ?? null;
    const base = await indexStatus(tx, organizationId, model ?? '');
    const [row] = await tx.execute<{ chunks: number; other: number; last: string | null }>(sql`
      select count(*) filter (where embedding_model = ${model ?? ''})::int as chunks,
        count(*) filter (where embedding_model <> ${model ?? ''})::int as other,
        max(indexed_at) filter (where embedding_model = ${model ?? ''}) as last
      from public.ai_chunks where organization_id = ${organizationId}`);
    const chunks = Number(row?.chunks ?? 0);
    const stale = model ? base.stale : 0;
    const total = chunks + stale;
    const last = row?.last
      ? new Date(
          String(row.last)
            .replace(' ', 'T')
            .replace(/([+-]\d\d)$/, '$1:00'),
        )
      : null;
    return {
      model,
      byType: model ? base.byType : {},
      chunks,
      otherModel: Number(row?.other ?? 0),
      stale,
      lastBuiltAt: last && !Number.isNaN(last.getTime()) ? last.toISOString() : null,
      progress: total === 0 ? 100 : Math.floor((Math.max(0, total - stale) / total) * 100),
    };
  });
}

/**
 * Re-index in the background after the embedder changes (FR3.4): chunks of another model count as stale, so the
 * catch-up re-embeds them — the upsert replaces each chunk, models are never mixed. Runs after the response.
 */
export function scheduleReindex(organizationId: string): void {
  after(async () => {
    try {
      await catchUpIndex(organizationId, 2000);
    } catch (error) {
      console.error('[ai] background re-index failed', error);
    }
  });
}
