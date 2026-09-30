/**
 * Phase 8 seed: AI switched on for the demo agency, one realistic anomaly (yesterday's leads on the orthodontics
 * campaign's busiest channel collapse, so its cost per lead spikes), the detectors run over every live campaign
 * (insights + recommendations), the assistant's index built with the mock embedder, and a sample conversation.
 * Runs as the table owner (listed service path). Everything is computed by the same pure modules the app uses.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../src/lib/db/schema';
import { analyzeCampaignInsights, campaignsToAnalyze } from '../src/modules/ai/analysis';
import { indexSources, staleSources } from '../src/modules/ai/indexer-core';
import { textKit } from '../src/modules/ai/kit';
import { resolveCitations } from '../src/modules/ai/prompts';
import { composeMock, MOCK_MODEL } from '../src/modules/ai/providers/mock';
import { MOCK_EMBEDDING_MODEL, mockEmbed, mockEmbedder } from '../src/modules/ai/providers/mock-embedder';
import type { SourceType } from '../src/modules/ai/types';

type Db = PostgresJsDatabase<typeof schema>;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function seedAiData({ db, ids, orgId, today }: { db: Db; ids: Record<string, string>; orgId: string; today: string }) {
  await db
    .insert(schema.aiSettings)
    .values({ organizationId: orgId, enabled: true })
    .onConflictDoUpdate({ target: schema.aiSettings.organizationId, set: { enabled: true, updatedBy: ids.sara ?? null } });

  // A believable bad day: leads on the orthodontics campaign's busiest channel drop to ~15 % while spend holds.
  const [ortho] = await db
    .select()
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.organizationId, orgId), eq(schema.campaigns.name, 'عروض تقويم الأسنان')));
  if (ortho) {
    const yesterday = addDays(today, -1);
    const [busiest] = await db.execute<{ channel_id: string }>(sql`
      select channel_id from public.metrics_daily where campaign_id = ${ortho.id} and date < ${yesterday}::date
      group by channel_id order by sum(leads) desc limit 1`);
    if (busiest) {
      await db.execute(sql`
        update public.metrics_daily set leads = greatest(round(leads * 0.15), 0), conversions = greatest(round(conversions * 0.15), 0)
        where campaign_id = ${ortho.id} and channel_id = ${busiest.channel_id} and date = ${yesterday}::date`);
    }
  }

  let insights = 0;
  await db.transaction(async (tx) => {
    for (const id of await campaignsToAnalyze(tx, orgId, today)) {
      const r = await analyzeCampaignInsights(tx, id, { today, sensitivity: 'normal' });
      insights += r.created;
    }
  });

  // The assistant's index, with the mock embedder (the sweep re-embeds with the live model once keys are set).
  const kit = textKit('ar');
  let indexed = 0;
  await db.transaction(async (tx) => {
    for (;;) {
      const batch = await staleSources(tx, orgId, MOCK_EMBEDDING_MODEL, 200);
      if (!batch.length) break;
      const byType = new Map<SourceType, string[]>();
      for (const b of batch) byType.set(b.type, [...(byType.get(b.type) ?? []), b.id]);
      for (const [type, list] of byType) {
        await indexSources(tx, type, list, {
          kit,
          locale: 'ar',
          embedder: mockEmbedder,
          embed: async (texts) => (await mockEmbedder.embed(texts, 'document')).vectors,
        });
      }
      indexed += batch.length;
    }
  });

  // A sample conversation for Sara (Super Admin: she can read every source, so the owner connection's search matches).
  if (ids.sara) {
    const question = 'لخّص وضع حملة عروض تقويم الأسنان';
    const vector = `[${mockEmbed(question).join(',')}]`;
    const rows = await db.execute<{ source_type: SourceType; source_id: string; title: string; url: string; content: string }>(sql`
      select source_type, source_id, title, url, content from public.ai_chunks
      where organization_id = ${orgId} and embedding_model = ${MOCK_EMBEDDING_MODEL}
      order by embedding operator(extensions.<=>) ${vector}::extensions.vector limit 8`);
    const sources = rows.map((r, i) => ({
      n: i + 1,
      sourceType: r.source_type,
      sourceId: r.source_id,
      title: r.title,
      url: r.url,
      content: r.content,
    }));
    const text = composeMock({
      purpose: 'assistant',
      locale: 'ar',
      system: '',
      messages: [],
      grounding: { kind: 'assistant', question, sources },
    });
    const { text: answer, citations } = resolveCitations(text, sources);
    const [conversation] = await db
      .insert(schema.aiConversations)
      .values({ organizationId: orgId, userId: ids.sara, title: question })
      .returning({ id: schema.aiConversations.id });
    await db.insert(schema.aiMessages).values([
      { organizationId: orgId, conversationId: conversation!.id, role: 'user', content: question },
      { organizationId: orgId, conversationId: conversation!.id, role: 'assistant', content: answer, citations, model: MOCK_MODEL },
    ]);
  }

  process.stdout.write(`[seed-ai] ${insights} insights, ${indexed} records indexed\n`);
}
