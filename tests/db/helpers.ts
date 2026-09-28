import postgres from 'postgres';

/** Direct connection as the table owner; each helper switches to `authenticated` inside a rolled-back transaction. */
export const sql = postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', {
  max: 4,
  onnotice: () => undefined,
});

const ids = new Map<string, string>();

export async function userId(email: string): Promise<string> {
  const cached = ids.get(email);
  if (cached) return cached;
  const [row] = await sql<{ id: string }[]>`select id from auth.users where email = ${email}`;
  if (!row) throw new Error(`Seed user ${email} not found — run pnpm db:reset`);
  ids.set(email, row.id);
  return row.id;
}

export async function clientId(slug: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`select id from public.clients where slug = ${slug}`;
  if (!row) throw new Error(`Seed client ${slug} not found`);
  return row.id;
}

class Rollback extends Error {}

type Tx = postgres.TransactionSql;

/**
 * Runs `fn` as the given user exactly like the app's `withRls()` does (role `authenticated`,
 * `request.jwt.claims` set), then rolls everything back so tests never change seed data.
 * Pass `null` to run as `anon`.
 */
export async function as<T>(email: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await sql.begin(async (tx) => {
      if (email) {
        const sub = await userId(email);
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub, role: 'authenticated' })}, true), set_config('role', 'authenticated', true)`;
      } else {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: 'anon' })}, true), set_config('role', 'anon', true)`;
      }
      result = await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return result as T;
}

/** Runs a statement as the user and returns the Postgres error code/message it raised (or null on success). */
export async function attempt(email: string | null, fn: (tx: Tx) => Promise<unknown>): Promise<{ code: string; message: string } | null> {
  return as(email, async (tx) => {
    try {
      await tx.savepoint(async (sp) => {
        await fn(sp as unknown as Tx);
      });
      return null;
    } catch (error) {
      const e = error as { code?: string; message?: string };
      return { code: e.code ?? 'unknown', message: e.message ?? '' };
    }
  });
}
