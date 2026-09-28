import 'server-only';

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/lib/db/schema';

export type Database = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const globalForDb = globalThis as unknown as { __sql?: postgres.Sql; __db?: Database };

function create(): Database {
  const sqlClient =
    globalForDb.__sql ??
    postgres(process.env.DATABASE_URL!, {
      // Supabase's transaction pooler does not support prepared statements.
      prepare: false,
      max: process.env.NODE_ENV === 'production' ? 5 : 10,
    });
  globalForDb.__sql = sqlClient;
  return drizzle(sqlClient, { schema, casing: 'snake_case' });
}

/**
 * Raw database handle connected as the table owner — it BYPASSES RLS.
 * Use `withRls()` for anything done on behalf of a user; use `dbAdmin` only in the
 * service paths listed in CLAUDE.md §6 (seed, invitation acceptance, notification fan-out).
 */
export const dbAdmin: Database = (globalForDb.__db ??= create());
