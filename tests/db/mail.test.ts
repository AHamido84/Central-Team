/**
 * FR2.1 / ADR-088 — mail settings and the outgoing queue:
 * - settings are admin-only (RLS) and the secret is write-only (Vault; never selectable, never decryptable by users);
 * - the log shows metadata to admins only; bodies are never readable;
 * - the queue retries with backoff, gives up after 5 attempts, falls back (and alerts once), respects the daily limit;
 * - auth emails go through the configured sender (checked in Mailpit).
 */
import { readFileSync } from 'node:fs';

process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'test-publishable-key';
// generateLink needs the local stack's real secret key: CI exports it (`supabase status`); locally it's in .env.local.
process.env.SUPABASE_SECRET_KEY ??= readFileSync('.env.local', 'utf8').match(/^SUPABASE_SECRET_KEY=(.+)$/m)?.[1]?.replace(/^"|"$/g, '');
process.env.EMAIL_DEV_REAL_SEND = '1';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dbAdmin } from '@/lib/db/client';
import type { EmailProvider, EmailMessage } from '@/lib/email/provider';
import { sendAuthLinkEmail } from '@/modules/mail/server/auth-emails';
import { processEmailQueue } from '@/modules/mail/server/outbox';
import type { ResolvedSender, resolveSenders } from '@/modules/mail/server/sender';

import { as, sql, userId } from './helpers';

const ADMIN = 'sara@ofoq.test';
const MANAGER = 'noura@ofoq.test'; // account manager: no mail:manage
const CLIENT = 'mohammed@najd.test';
let org = '';
const startedAt = new Date();

beforeAll(async () => {
  [{ org }] = (await sql<{ org: string }[]>`
    select organization_id as org from public.organization_members where user_id = ${await userId(ADMIN)}`) as unknown as [{ org: string }];
  await sql`delete from public.mail_settings where organization_id = ${org}`;
});

afterAll(async () => {
  await sql`delete from public.email_outbox where created_at >= ${startedAt}`;
  await sql`delete from public.mail_settings where organization_id = ${org}`;
  await sql`delete from public.domain_events where type like 'mail.%' and occurred_at >= ${startedAt}`;
  await sql.end();
  await (dbAdmin as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

type Tx = Parameters<Parameters<typeof as>[1]>[0];

async function insertSettings(tx: Tx) {
  const [row] = await tx<{ id: string }[]>`
    insert into public.mail_settings (organization_id, preset, host, port, security, username, from_email)
    values (${org}, 'gmail', 'smtp.gmail.com', 587, 'starttls', 'agency@gmail.com', 'agency@gmail.com') returning id`;
  return row!.id;
}

describe('mail settings RLS and secrets', () => {
  it('an admin saves settings and a secret; the secret only comes back masked', async () => {
    await as(ADMIN, async (tx) => {
      const id = await insertSettings(tx);
      const [hint] = await tx<{ h: string }[]>`select app.mail_put_secret(${id}::uuid, 'abcd efgh ijkl mnop') as h`;
      expect(hint!.h).toBe('abc…mnop');
      const rows = await tx`select id, secret_hint, from_email from public.mail_settings where id = ${id}`;
      expect(JSON.stringify(rows)).not.toContain('efgh');
      await expect(tx.savepoint((sp) => sp`select secret_id from public.mail_settings where id = ${id}`)).rejects.toMatchObject({
        code: '42501',
      });
      await expect(tx.savepoint((sp) => sp`select * from public.mail_settings`)).rejects.toMatchObject({ code: '42501' });
      await expect(tx.savepoint((sp) => sp`select app.mail_get_secret(${id}::uuid)`)).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('non-admins and client users see nothing and write nothing', async () => {
    for (const email of [MANAGER, CLIENT])
      await as(email, async (tx) => {
        expect(await tx`select id from public.mail_settings`).toHaveLength(0);
        await expect(tx.savepoint((sp) => insertSettings(sp as unknown as Tx))).rejects.toMatchObject({ code: '42501' });
      });
  });

  it('the email log: admins read metadata, never bodies; nobody writes', async () => {
    const [row] = await sql<{ id: string }[]>`
      insert into public.email_outbox (organization_id, kind, to_email, subject, html, text)
      values (${org}, 'notification', 'x@example.com', 'Hello', '<p>secret link</p>', 'secret link') returning id`;
    await as(ADMIN, async (tx) => {
      const [r] = await tx<{ subject: string }[]>`select subject from public.email_outbox where id = ${row!.id}`;
      expect(r!.subject).toBe('Hello');
      await expect(tx.savepoint((sp) => sp`select html from public.email_outbox where id = ${row!.id}`)).rejects.toMatchObject({
        code: '42501',
      });
      await expect(
        tx.savepoint(
          (sp) => sp`insert into public.email_outbox (organization_id, kind, to_email, subject) values (${org}, 'test', 'a@b.c', 's')`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
    for (const email of [MANAGER, CLIENT])
      await as(email, async (tx) => {
        expect(await tx`select id from public.email_outbox where id = ${row!.id}`).toHaveLength(0);
      });
  });
});

/** A sender whose provider is a function we control. */
function fake(
  kind: ResolvedSender['kind'],
  send: (m: EmailMessage) => Promise<{ id: string }>,
  settings: ResolvedSender['settings'] = null,
): ResolvedSender {
  const provider: EmailProvider = { name: `fake-${kind}`, send };
  return { kind, provider, from: () => undefined, replyTo: null, settings };
}
const fail = (code: string) => async () => {
  throw Object.assign(new Error(`mock ${code}`), { code });
};
const ok = async () => ({ id: 'mock-id' });

async function queue(extra: { sensitive?: boolean } = {}) {
  const [row] = await sql<{ id: string }[]>`
    insert into public.email_outbox (organization_id, kind, to_email, subject, html, text, sensitive)
    values (${org}, 'notification', 'queue@example.com', 'Queue test', '<p>body</p>', 'body', ${extra.sensitive ?? false}) returning id`;
  return row!.id;
}
const state = async (id: string) =>
  (
    await sql<
      { status: string; attempts: number; error_code: string | null; sender: string | null; html: string | null; due_in: number }[]
    >`
      select status, attempts, error_code, sender, html, extract(epoch from next_attempt_at - now())::int as due_in
      from public.email_outbox where id = ${id}`
  )[0]!;
const settingsRow = async () => {
  const [row] = await dbAdmin.execute<Record<string, unknown>>(
    (await import('drizzle-orm')).sql`select * from public.mail_settings where organization_id = ${org}::uuid`,
  );
  return row;
};

describe('outgoing queue', () => {
  it('retries a transient failure with backoff and gives up after 5 attempts', async () => {
    const id = await queue();
    const resolve = (async () => ({ primary: fake('environment', fail('ECONNECTION')), fallback: null })) as typeof resolveSenders;
    await processEmailQueue({ ids: [id], resolve });
    let s = await state(id);
    expect(s).toMatchObject({ status: 'failed', attempts: 1, error_code: 'port_blocked' });
    expect(s.due_in).toBeGreaterThan(30);
    expect(s.due_in).toBeLessThanOrEqual(60);
    for (let i = 0; i < 4; i++) {
      await sql`update public.email_outbox set next_attempt_at = now() where id = ${id}`;
      await processEmailQueue({ ids: [id], resolve });
    }
    s = await state(id);
    expect(s).toMatchObject({ status: 'failed', attempts: 5 });
    await sql`update public.email_outbox set next_attempt_at = now() where id = ${id}`;
    await processEmailQueue({ ids: [id], resolve });
    expect((await state(id)).attempts).toBe(5);
  });

  it('a permanent failure (wrong password) stops at once', async () => {
    const id = await queue();
    const resolve = (async () => ({ primary: fake('environment', fail('EAUTH')), fallback: null })) as typeof resolveSenders;
    await processEmailQueue({ ids: [id], resolve });
    expect(await state(id)).toMatchObject({ status: 'failed', attempts: 5, error_code: 'auth_failed' });
  });

  it('falls back when the configured sender fails, alerts the admins once, and clears sign-in bodies', async () => {
    await as(ADMIN, async () => undefined);
    await sql`insert into public.mail_settings (organization_id, preset, host, port, security, username, from_email)
      values (${org}, 'gmail', 'smtp.gmail.com', 587, 'starttls', 'agency@gmail.com', 'agency@gmail.com') on conflict do nothing`;
    const settings = (await settingsRow()) as unknown as ResolvedSender['settings'];
    const mapped = {
      ...(settings as object),
      organizationId: org,
      id: (settings as unknown as { id: string }).id,
    } as ResolvedSender['settings'];
    const resolve = (async () => ({
      primary: fake('configured', fail('EAUTH'), mapped),
      fallback: fake('fallback', ok, mapped),
    })) as typeof resolveSenders;
    const a = await queue({ sensitive: true });
    const b = await queue();
    await processEmailQueue({ ids: [a, b], resolve });
    expect(await state(a)).toMatchObject({ status: 'sent', sender: 'fallback', html: null });
    expect(await state(b)).toMatchObject({ status: 'sent', sender: 'fallback' });
    expect((await state(b)).html).not.toBeNull();
    const [alerts] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.domain_events where type = 'mail.fallback_used' and organization_id = ${org} and occurred_at >= ${startedAt}`;
    expect(alerts!.n).toBe(1);
    const [s] = await sql<
      { fallback_since: Date | null }[]
    >`select fallback_since from public.mail_settings where organization_id = ${org}`;
    expect(s!.fallback_since).not.toBeNull();
  });

  it('at the daily limit with no fallback, mail waits for tomorrow without spending an attempt', async () => {
    await sql`update public.mail_settings set daily_limit = 1, fallback_since = null where organization_id = ${org}`;
    const settings = (await settingsRow()) as Record<string, unknown>;
    const mapped = { ...settings, organizationId: org, dailyLimit: 1, id: settings.id } as unknown as ResolvedSender['settings'];
    // One configured send today already.
    await sql`insert into public.email_outbox (organization_id, kind, to_email, subject, status, sender, sent_at)
      values (${org}, 'notification', 'earlier@example.com', 'Earlier', 'sent', 'configured', now())`;
    const resolve = (async () => ({ primary: fake('configured', ok, mapped), fallback: null })) as typeof resolveSenders;
    const id = await queue();
    await processEmailQueue({ ids: [id], resolve });
    const s = await state(id);
    expect(s).toMatchObject({ status: 'queued', attempts: 0, error_code: 'daily_limit' });
    expect(s.due_in).toBeGreaterThan(0);
  });
});

describe('auth emails through the configured sender', () => {
  it('a magic link goes out through Settings → Mail (custom SMTP pointing at Mailpit)', async () => {
    await sql`delete from public.mail_settings where organization_id = ${org}`;
    const [row] = await sql<{ id: string }[]>`
      insert into public.mail_settings (organization_id, preset, host, port, security, from_email, from_name)
      values (${org}, 'smtp', '127.0.0.1', 54325, 'none', 'configured-sender@ofoq.test', '{"ar":"وكالة أفق","en":"Ofoq Agency"}')
      returning id`;
    await sql`select app.mail_put_secret(${row!.id}::uuid, 'unused-secret')`;
    const since = new Date();
    expect(await sendAuthLinkEmail('magic_link', 'omar@ofoq.test')).toEqual({ queued: true });
    // Unknown addresses: nothing is generated, nothing is sent, nobody is created.
    expect(await sendAuthLinkEmail('magic_link', 'nobody-here@ofoq.test')).toEqual({ queued: false });
    const [{ n }] = (await sql<
      { n: number }[]
    >`select count(*)::int as n from auth.users where email = 'nobody-here@ofoq.test'`) as unknown as [{ n: number }];
    expect(n).toBe(0);
    await processEmailQueue();

    const [sent] = await sql<{ status: string; sender: string; html: string | null }[]>`
      select status, sender, html from public.email_outbox
      where to_email = 'omar@ofoq.test' and kind = 'magic_link' and created_at >= ${since} order by created_at desc limit 1`;
    expect(sent).toMatchObject({ status: 'sent', sender: 'configured', html: null });

    const deadline = Date.now() + 15_000;
    let from = '';
    while (Date.now() < deadline && !from) {
      const res = await fetch(`http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent('to:"omar@ofoq.test"')}&limit=5`);
      const data = (await res.json()) as { messages: { From: { Address: string }; Created: string }[] };
      from = data.messages.find((m) => new Date(m.Created) >= since)?.From.Address ?? '';
      if (!from) await new Promise((r) => setTimeout(r, 500));
    }
    expect(from).toBe('configured-sender@ofoq.test');
  });
});
