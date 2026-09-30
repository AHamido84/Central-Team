/**
 * Deploy-time database step (Vercel build, see `vercel.json`): applies pending SQL migrations from
 * `supabase/migrations` and, when `SEED_ON_DEPLOY=1` and the database has no users yet, loads the demo seed.
 *
 * It runs in the build because the Vercel ↔ Supabase integration stores the connection strings as sensitive
 * variables that only builds and functions can read. Applied versions are recorded in
 * `supabase_migrations.schema_migrations` — the table the Supabase CLI uses — so `supabase db push` can take over
 * later without re-running anything. Skipped outside Vercel production builds unless `DEPLOY_DB=1`.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import postgres from 'postgres';

import { databaseUrl } from '../src/lib/db/url';

const log = (message: string) => process.stdout.write(`[deploy-db] ${message}\n`);

async function main() {
  if (process.env.VERCEL_ENV !== 'production' && process.env.DEPLOY_DB !== '1') {
    log('not a production build — skipping');
    return;
  }
  const url = databaseUrl(process.env, 'direct');
  if (!url) throw new Error('No database URL (POSTGRES_URL_NON_POOLING / DATABASE_URL) is set.');

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`create schema if not exists supabase_migrations`;
    await sql`create table if not exists supabase_migrations.schema_migrations (
      version text primary key, statements text[], name text)`;
    const applied = new Set(
      (await sql<{ version: string }[]>`select version from supabase_migrations.schema_migrations`).map((r) => r.version),
    );

    const dir = path.resolve(__dirname, '../supabase/migrations');
    const files = readdirSync(dir)
      .filter((f) => /^\d+_.+\.sql$/.test(f))
      .sort();
    for (const file of files) {
      const [version = '', ...rest] = file.replace(/\.sql$/, '').split('_');
      if (applied.has(version)) continue;
      log(`applying ${file}`);
      const body = readFileSync(path.join(dir, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into supabase_migrations.schema_migrations (version, name) values (${version}, ${rest.join('_')})`;
      });
    }
    log(`migrations up to date (${files.length} files)`);

    if (process.env.SEED_ON_DEPLOY === '1') {
      // Gate on auth users rather than organizations: the demo organization comes from `supabase/seed.sql`, which
      // `supabase db reset` runs locally and this step runs here before the TypeScript seed.
      const [row] = await sql<{ count: number }[]>`select count(*)::int as count from auth.users`;
      if ((row?.count ?? 0) > 0) {
        log('database already has users — skipping the demo seed');
        // Deployments seeded before Phase 4 get the demo campaigns once (the script checks it's the demo agency).
        const result = spawnSync('pnpm', ['exec', 'tsx', 'scripts/seed-campaigns-standalone.ts'], {
          stdio: 'inherit',
          env: { ...process.env, SEED_ALLOW_REMOTE: '1' },
        });
        if (result.status !== 0) throw new Error(`campaign seed failed with exit code ${result.status}`);
        // Same for Phase 5: the demo SLA policies, holidays and breach log, once.
        const sla = spawnSync('pnpm', ['exec', 'tsx', 'scripts/seed-sla-standalone.ts'], {
          stdio: 'inherit',
          env: { ...process.env, SEED_ALLOW_REMOTE: '1' },
        });
        if (sla.status !== 0) throw new Error(`SLA seed failed with exit code ${sla.status}`);
        // And Phase 6: the demo sales team, pipeline, leads, deals and capacity settings, once.
        const crm = spawnSync('pnpm', ['exec', 'tsx', 'scripts/seed-crm-standalone.ts'], {
          stdio: 'inherit',
          env: { ...process.env, SEED_ALLOW_REMOTE: '1' },
        });
        if (crm.status !== 0) throw new Error(`CRM seed failed with exit code ${crm.status}`);
      } else {
        const [org] = await sql<{ count: number }[]>`select count(*)::int as count from public.organizations`;
        if ((org?.count ?? 0) === 0) {
          log('applying supabase/seed.sql');
          const seedSql = readFileSync(path.resolve(__dirname, '../supabase/seed.sql'), 'utf8');
          await sql.begin((tx) => tx.unsafe(seedSql));
        }
        log('loading the demo seed');
        const result = spawnSync('pnpm', ['exec', 'tsx', 'scripts/seed.ts'], {
          stdio: 'inherit',
          env: { ...process.env, SEED_ALLOW_REMOTE: '1' },
        });
        if (result.status !== 0) throw new Error(`seed failed with exit code ${result.status}`);
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[deploy-db] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
