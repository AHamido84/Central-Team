/**
 * Loads only the Phase 8 demo data (AI switched on, detector insights, the mock-embedded assistant index, a sample
 * conversation) into a database that already has the earlier demo seed (used by `scripts/deploy-db.ts` when a deployment
 * predates Phase 8). Refuses to run unless the demo organization exists and has no AI data yet.
 */
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { databaseUrl } from '../src/lib/db/url';
import * as schema from '../src/lib/db/schema';
import { seedAiData } from './seed-ai';

config({ path: '.env.local' });

const ORG_ID = '00000000-0000-4000-8000-000000000001';

async function main() {
  const url = databaseUrl(process.env, 'direct') ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  if (!/127\.0\.0\.1|localhost/.test(url) && process.env.SEED_ALLOW_REMOTE !== '1') {
    throw new Error('Refusing to seed a non-local database. Set SEED_ALLOW_REMOTE=1 to override.');
  }
  const client = postgres(url, { max: 2 });
  try {
    const [org] = await client<{ n: number }[]>`select count(*)::int as n from public.organizations where id = ${ORG_ID} and slug = 'ofoq'`;
    const [existing] = await client<{ n: number }[]>`
      select (select count(*) from public.ai_chunks where organization_id = ${ORG_ID})
           + (select count(*) from public.ai_insights where organization_id = ${ORG_ID})
           + (select count(*) from public.ai_conversations where organization_id = ${ORG_ID}) as n`;
    const [sara] = await client<{ id: string }[]>`select id from public.profiles where email = 'sara@ofoq.test'`;
    if (!org?.n || Number(existing?.n ?? 0) > 0 || !sara) {
      process.stdout.write('[seed-ai] demo organization missing, not fully seeded, or already has AI data — nothing to do\n');
      return;
    }
    const db = drizzle(client, { schema });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(),
    );
    await seedAiData({ db, ids: { sara: sara.id }, orgId: ORG_ID, today });
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[seed-ai] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
