/**
 * FR1.7 / ADR-087 — email change: a user reads and cancels only their own pending change, and a completed change
 * syncs `profiles.email` and records `user.email_changed` for the user's organization.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { as, sql, userId } from './helpers';

const USER = 'lama@ofoq.test';
const OTHER = 'reem@ofoq.test';

afterAll(async () => {
  await sql.end();
});

type Tx = Parameters<Parameters<typeof as>[1]>[0];

async function withPending<T>(email: string, fn: (tx: Tx) => Promise<T>) {
  const id = await userId(USER);
  return as(email, async (tx) => {
    await tx`select set_config('role', 'postgres', true)`;
    await tx`update auth.users set email_change = 'lama.next@ofoq.test', email_change_token_new = 'x', email_change_token_current = 'y',
      email_change_confirm_status = 1, email_change_sent_at = now() where id = ${id}`;
    await tx`select set_config('role', 'authenticated', true)`;
    return fn(tx);
  });
}

describe('email change', () => {
  it('the user sees their own pending change', async () => {
    await withPending(USER, async (tx) => {
      const rows = await tx<{ new_email: string; confirmed_one: boolean }[]>`select new_email, confirmed_one from app.my_email_change()`;
      expect(rows).toEqual([{ new_email: 'lama.next@ofoq.test', confirmed_one: true }]);
    });
  });

  it('nobody else sees it or can cancel it, and auth.users stays closed', async () => {
    await withPending(OTHER, async (tx) => {
      expect(await tx`select * from app.my_email_change()`).toHaveLength(0);
      const [row] = await tx<{ ok: boolean }[]>`select app.cancel_my_email_change() as ok`;
      expect(row!.ok).toBe(false);
      await expect(tx.savepoint((sp) => sp`select email_change from auth.users limit 1`)).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('the user cancels it: both links stop working', async () => {
    await withPending(USER, async (tx) => {
      const [row] = await tx<{ ok: boolean }[]>`select app.cancel_my_email_change() as ok`;
      expect(row!.ok).toBe(true);
      expect(await tx`select * from app.my_email_change()`).toHaveLength(0);
      await tx`select set_config('role', 'postgres', true)`;
      const [u] = await tx<
        { t: string }[]
      >`select email_change_token_new || email_change_token_current as t from auth.users where id = ${await userId(USER)}`;
      expect(u!.t).toBe('');
    });
  });

  it('a completed change syncs the profile and records user.email_changed', async () => {
    const id = await userId(USER);
    await as(USER, async (tx) => {
      await tx`select set_config('role', 'postgres', true)`;
      await tx`update auth.users set email = 'lama.done@ofoq.test' where id = ${id}`;
      const [p] = await tx<{ email: string }[]>`select email from public.profiles where id = ${id}`;
      expect(p!.email).toBe('lama.done@ofoq.test');
      const events = await tx<{ payload: { from: string; to: string }; actor_id: string }[]>`
        select payload, actor_id from public.domain_events where type = 'user.email_changed' and aggregate_id = ${id}
        order by occurred_at desc limit 1`;
      expect(events[0]).toMatchObject({ payload: { from: USER, to: 'lama.done@ofoq.test' }, actor_id: id });
    });
  });
});
