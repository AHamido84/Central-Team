/**
 * Loads only the Phase 7 demo data (sandbox connections with Vault tokens, mappings, synced numbers, WhatsApp templates,
 * automations) into a database that already has the earlier demo seed (used by `scripts/deploy-db.ts` when a deployment
 * predates Phase 7). Refuses to run unless the demo organization exists and has no integration connections yet.
 */
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { databaseUrl } from '../src/lib/db/url';
import * as schema from '../src/lib/db/schema';
import { seedIntegrationsData } from './seed-integrations';

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
    const [existing] = await client<
      { n: number }[]
    >`select count(*)::int as n from public.integration_connections where organization_id = ${ORG_ID}`;
    const people = await client<{ email: string; id: string }[]>`
      select email, id from public.profiles where email = any(${['sara', 'faisal', 'majed', 'ruba'].map((k) => `${k}@ofoq.test`)})`;
    if (!org?.n || (existing?.n ?? 0) > 0 || people.length < 4) {
      process.stdout.write('[seed-integrations] demo organization missing, not fully seeded, or already has connections — nothing to do\n');
      return;
    }
    const db = drizzle(client, { schema });
    const ids = Object.fromEntries(people.map((p) => [p.email.split('@')[0]!, p.id]));
    const clients = await client<{ slug: string; id: string }[]>`select slug, id from public.clients where organization_id = ${ORG_ID}`;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(),
    );
    await seedIntegrationsData({ db, ids, clientIds: Object.fromEntries(clients.map((c) => [c.slug, c.id])), orgId: ORG_ID, today });
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[seed-integrations] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
