import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * For service paths that bypass RLS (sweeps, consumers): the row's client is not in the Trash. RLS already hides a
 * deleted client's data from users (ADR-080); background work has to say it explicitly.
 */
export function liveClient(clientId: AnyPgColumn): SQL {
  return sql`not exists (select 1 from public.clients live_c where live_c.id = ${clientId} and live_c.deleted_at is not null)`;
}
