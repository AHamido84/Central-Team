import 'server-only';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';

/**
 * Fixed-window rate limiter backed by Postgres (`rate_limits`), so it works across serverless instances
 * without extra infrastructure. Returns false when the limit is exceeded.
 */
export async function checkRateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const rows = await dbAdmin.execute<{ count: number }>(sql`
    insert into public.rate_limits as r (key, window_start, count)
    values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when r.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else r.count + 1 end,
      window_start = case when r.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else r.window_start end
    returning count
  `);
  return (rows[0]?.count ?? 0) <= max;
}
