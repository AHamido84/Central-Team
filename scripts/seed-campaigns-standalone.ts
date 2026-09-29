/**
 * Loads only the Phase 4 demo campaigns into a database that already has the earlier demo seed (used by
 * `scripts/deploy-db.ts` when a deployment predates Phase 4). Refuses to run unless the demo organization exists and
 * has no campaigns yet, so it can never duplicate data or touch a real agency.
 */
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { databaseUrl } from '../src/lib/db/url';
import * as schema from '../src/lib/db/schema';
import { seedCampaignsData } from './seed-campaigns';

config({ path: '.env.local' });

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const staff = ['sara', 'faisal', 'noura', 'abdulrahman', 'reem', 'khalid', 'lama', 'omar', 'hind', 'turki'];

async function main() {
  const url = databaseUrl(process.env, 'direct') ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  if (!/127\.0\.0\.1|localhost/.test(url) && process.env.SEED_ALLOW_REMOTE !== '1') {
    throw new Error('Refusing to seed a non-local database. Set SEED_ALLOW_REMOTE=1 to override.');
  }
  const client = postgres(url, { max: 2 });
  try {
    const [org] = await client<{ n: number }[]>`select count(*)::int as n from public.organizations where id = ${ORG_ID} and slug = 'ofoq'`;
    const [existing] = await client<{ n: number }[]>`select count(*)::int as n from public.campaigns where organization_id = ${ORG_ID}`;
    if (!org?.n || (existing?.n ?? 0) > 0) {
      process.stdout.write('[seed-campaigns] demo organization missing or campaigns already present — nothing to do\n');
      return;
    }
    const people = await client<{ email: string; id: string }[]>`
      select email, id from public.profiles where email = any(${staff.map((k) => `${k}@ofoq.test`)})`;
    const ids = Object.fromEntries(people.map((p) => [p.email.split('@')[0]!, p.id]));
    const clients = await client<{ slug: string; id: string }[]>`select slug, id from public.clients where organization_id = ${ORG_ID}`;
    const clientIds = Object.fromEntries(clients.map((c) => [c.slug, c.id]));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(),
    );
    await seedCampaignsData({ db: drizzle(client, { schema }), ids, clientIds, orgId: ORG_ID, today });
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[seed-campaigns] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
