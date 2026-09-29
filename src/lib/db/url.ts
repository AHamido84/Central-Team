/**
 * Postgres connection string for the app and scripts.
 *
 * Locally `DATABASE_URL` comes from `.env.local`. On Vercel the Supabase integration provides `POSTGRES_URL`
 * (transaction pooler) and `POSTGRES_URL_NON_POOLING` (direct) instead, and appends query parameters such as
 * `supa=base-pooler.x` that postgres.js would forward as server startup options (which Postgres rejects), so only
 * `sslmode` is kept. Not `server-only`: the deploy and seed scripts use it too.
 */
export function databaseUrl(
  env: Record<string, string | undefined> = process.env,
  kind: 'pooled' | 'direct' = 'pooled',
): string | undefined {
  const raw =
    kind === 'direct'
      ? (env.DATABASE_URL_DIRECT ?? env.POSTGRES_URL_NON_POOLING ?? env.DATABASE_URL)
      : (env.DATABASE_URL ?? env.POSTGRES_URL);
  if (!raw) return undefined;
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) if (key !== 'sslmode') url.searchParams.delete(key);
  return url.toString();
}
