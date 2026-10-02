import 'server-only';

import { dbAdmin } from '@/lib/db/client';
import { organizations } from '@/lib/db/schema';
import { catchUpIndex } from '@/modules/ai/server/indexer';
import { analyzeAllCampaigns } from '@/modules/ai/server/insights';

export type AiSweepResult = { campaigns: number; insights: number; resolved: number; indexed: number };

/**
 * Cron step (service path): the daily detector run over live campaigns (insights resolve and reopen here too), then
 * the assistant index catches up on records it missed while AI was off or a delivery failed.
 */
export async function runAiSweep(): Promise<AiSweepResult> {
  const analysis = await analyzeAllCampaigns();
  let indexed = 0;
  for (const org of await dbAdmin.select({ id: organizations.id }).from(organizations)) {
    try {
      indexed += await catchUpIndex(org.id, 500);
    } catch (error) {
      console.error('[ai] index catch-up failed', org.id, error);
    }
  }
  return { campaigns: analysis.campaigns, insights: analysis.created, resolved: analysis.resolved, indexed };
}
