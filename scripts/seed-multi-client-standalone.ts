/**
 * Adds the FR4 multi-client demo persona (`hala@group.test`) to a database that already has the demo seed (used by
 * `scripts/deploy-db.ts`). Refuses to run unless the demo organization exists; does nothing when the user exists.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { databaseUrl } from '../src/lib/db/url';
import * as schema from '../src/lib/db/schema';
import { MULTI_CLIENT_EMAIL, seedMultiClientUser } from './seed-multi-client';

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
    if (!org?.n) {
      process.stdout.write('[seed-multi-client] demo organization missing — nothing to do\n');
      return;
    }
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const id = await seedMultiClientUser(drizzle(client, { schema }), supabase, ORG_ID, 'Passw0rd!');
    process.stdout.write(
      id
        ? `[seed-multi-client] added ${MULTI_CLIENT_EMAIL} to three clients\n`
        : '[seed-multi-client] already present or clients missing — nothing to do\n',
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
