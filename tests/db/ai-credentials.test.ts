/**
 * FR1.5 / ADR-085 — AI provider keys: stored in Vault, masked in the row, never readable by any signed-in user (not even
 * the admin who saved it), visible only to `ai:manage` holders of the organization, removed from Vault with the row,
 * and never written to the audit log.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { as, attempt, sql } from './helpers';

const ADMIN = 'sara@ofoq.test'; // ai:manage
const SPECIALIST = 'khalid@ofoq.test';
const CLIENT = 'mohammed@najd.test';
const KEY = 'sk-ant-api03-test-secret-value-a1b2';

afterAll(async () => {
  await sql.end();
});

async function withCredential<T>(fn: (tx: Parameters<Parameters<typeof as>[1]>[0], id: string, org: string) => Promise<T>) {
  return as(ADMIN, async (tx) => {
    const [{ org }] = (await tx<
      { org: string }[]
    >`select organization_id as org from public.organization_members where user_id = auth.uid() limit 1`) as unknown as [{ org: string }];
    const [row] = await tx<{ id: string }[]>`
      insert into public.ai_credentials (organization_id, provider, display_name, key_hint)
      values (${org}, 'anthropic', 'Test key', '••••') returning id`;
    const [hint] = await tx<{ h: string }[]>`select app.ai_credential_put_key(${row!.id}::uuid, ${KEY}) as h`;
    expect(hint!.h).toBe('sk-…a1b2');
    return fn(tx, row!.id, org);
  });
}

describe('AI credentials', () => {
  it('shows only the masked hint; the key and the Vault reference are not readable', async () => {
    await withCredential(async (tx, id) => {
      const [row] = await tx<{ key_hint: string }[]>`select key_hint from public.ai_credentials where id = ${id}`;
      expect(row!.key_hint).toBe('sk-…a1b2');
      const rows = await tx<
        Record<string, unknown>[]
      >`select id, display_name, key_hint, default_model from public.ai_credentials where id = ${id}`;
      expect(JSON.stringify(rows)).not.toContain('test-secret');
      await expect(tx.savepoint((sp) => sp`select secret_id from public.ai_credentials where id = ${id}`)).rejects.toMatchObject({
        code: '42501',
      });
      await expect(tx.savepoint((sp) => sp`select app.ai_credential_get_key(${id}::uuid)`)).rejects.toMatchObject({ code: '42501' });
      await expect(tx.savepoint((sp) => sp`select * from vault.decrypted_secrets`)).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('only the service path decrypts, and the audit log never holds the key', async () => {
    const id = await withCredential(async (tx, cid) => {
      await tx`select set_config('role', 'postgres', true)`;
      const [row] = await tx<{ key: string }[]>`select app.ai_credential_get_key(${cid}::uuid) as key`;
      expect(row!.key).toBe(KEY);
      const audit = await tx<
        { t: string }[]
      >`select coalesce(after::text, '') || coalesce(before::text, '') as t from public.activity_log where table_name = 'ai_credentials' and record_id = ${cid}`;
      expect(audit.length).toBeGreaterThan(0);
      expect(audit.every((a) => !a.t.includes('test-secret'))).toBe(true);
      // Deleting the row removes the Vault entry.
      const [s] = await tx<{ id: string }[]>`select secret_id as id from public.ai_credentials where id = ${cid}`;
      await tx`delete from public.ai_credentials where id = ${cid}`;
      const left = await tx`select 1 from vault.secrets where id = ${s!.id}`;
      expect(left.length).toBe(0);
      return cid;
    });
    expect(id).toBeTruthy();
  });

  it('people without ai:manage and client users see nothing and cannot write', async () => {
    const [{ n }] = (await as(
      SPECIALIST,
      (tx) => tx<{ n: number }[]>`select count(*)::int as n from public.ai_credentials`,
    )) as unknown as [{ n: number }];
    expect(n).toBe(0);
    const error = await attempt(SPECIALIST, async (tx) => {
      const [{ org }] = (await tx<
        { org: string }[]
      >`select organization_id as org from public.organization_members where user_id = auth.uid() limit 1`) as unknown as [{ org: string }];
      await tx`insert into public.ai_credentials (organization_id, provider, display_name, key_hint) values (${org}, 'anthropic', 'x', 'x')`;
    });
    expect(error?.code).toBe('42501');
    const [{ c }] = (await as(CLIENT, (tx) => tx<{ c: number }[]>`select count(*)::int as c from public.ai_credentials`)) as unknown as [
      { c: number },
    ];
    expect(c).toBe(0);
  });

  it('allows one active key per provider', async () => {
    await withCredential(async (tx, _id, org) => {
      await expect(
        tx.savepoint(
          (sp) =>
            sp`insert into public.ai_credentials (organization_id, provider, display_name, key_hint) values (${org}, 'anthropic', 'second', 'x')`,
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});
