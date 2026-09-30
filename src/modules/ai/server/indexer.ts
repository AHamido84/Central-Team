import 'server-only';

import { eq } from 'drizzle-orm';

import { ActionFailure } from '@/lib/actions/errors';
import { dbAdmin } from '@/lib/db/client';
import { organizations } from '@/lib/db/schema';
import type { StoredEvent } from '@/lib/events/dispatcher';
import type { Locale } from '@/lib/i18n/localized';
import { indexSources, indexStatus, staleSources } from '@/modules/ai/indexer-core';
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
  const embedder = currentEmbedder();
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
  const embedder = currentEmbedder();
  if (!embedder) return 0;
  try {
    await assertAiReady(organizationId);
  } catch (error) {
    if (error instanceof ActionFailure) return 0;
    throw error;
  }
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

export async function getIndexStatus(organizationId: string) {
  const embedder = currentEmbedder();
  return dbAdmin.transaction((tx) => indexStatus(tx, organizationId, embedder?.model ?? ''));
}
