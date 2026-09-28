import 'server-only';

import { sql } from 'drizzle-orm';

import { getSession, type Session } from '@/lib/auth/session';
import { dbAdmin, type Tx } from '@/lib/db/client';

export class UnauthenticatedError extends Error {
  constructor() {
    super('unauthenticated');
  }
}

/**
 * Runs `fn` in a transaction as Postgres role `authenticated` with the user's verified JWT claims,
 * so every query is filtered by RLS and `auth.uid()` works in policies and triggers (ADR-003).
 */
export async function withRls<T>(fn: (tx: Tx) => Promise<T>, session?: Session | null): Promise<T> {
  const current = session ?? (await getSession());
  if (!current) throw new UnauthenticatedError();
  return runAs(current.claims, fn);
}

/** Lower-level variant used by tests and scripts that build claims themselves. */
export async function runAs<T>(claims: Record<string, unknown>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return dbAdmin.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true), set_config('role', 'authenticated', true)`,
    );
    return fn(tx);
  });
}
