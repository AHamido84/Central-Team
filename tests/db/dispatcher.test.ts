/**
 * Event dispatcher (ADR-027): per-consumer deliveries, retry with backoff, no double delivery — including
 * two dispatchers racing for the same events.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dbAdmin } from '@/lib/db/client';
import { defineConsumer, dispatchPendingEvents } from '@/lib/events/dispatcher';

import { sql } from './helpers';

const consumerName = `test.dispatcher.${crypto.randomUUID()}`;
const created: string[] = [];
const handled: string[] = [];
let failOnce = new Set<string>();
let org: string;

const consumer = defineConsumer({
  name: consumerName,
  types: ['request_form.created'],
  async handle(event) {
    if (!created.includes(event.id)) return; // ignore anything else of this type
    if (failOnce.has(event.id)) {
      failOnce.delete(event.id);
      throw new Error('boom');
    }
    await new Promise((r) => setTimeout(r, 20));
    handled.push(event.id);
  },
});

async function emit() {
  const id = crypto.randomUUID();
  await sql`insert into public.domain_events (id, organization_id, type, aggregate_type, payload)
            values (${id}, ${org}, 'request_form.created', 'request_form', ${sql.json({ formId: id })})`;
  created.push(id);
  return id;
}

const delivery = async (eventId: string) =>
  (
    await sql<{ attempts: number; processed_at: Date | null; last_error: string | null; next_attempt_at: Date }[]>`
    select attempts, processed_at, last_error, next_attempt_at from public.domain_event_deliveries
    where event_id = ${eventId} and consumer = ${consumerName}`
  )[0];

beforeAll(async () => {
  const [row] = await sql<{ id: string }[]>`select id from public.organizations limit 1`;
  org = row!.id;
});

afterAll(async () => {
  await sql`delete from public.domain_events where id = any(${created}::uuid[])`;
  await sql.end();
  await (dbAdmin as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe('dispatchPendingEvents', () => {
  it('delivers each event once, retries failures with backoff', async () => {
    const ok = await emit();
    const flaky = await emit();
    failOnce = new Set([flaky]);

    await dispatchPendingEvents([consumer]);
    expect(handled).toContain(ok);
    expect(handled).not.toContain(flaky);
    expect((await delivery(ok))?.processed_at).not.toBeNull();
    const failed = await delivery(flaky);
    expect(failed).toMatchObject({ attempts: 1, processed_at: null, last_error: 'boom' });
    expect(failed!.next_attempt_at.getTime()).toBeGreaterThan(Date.now());

    // Not due yet: nothing happens, and the processed one is never redelivered.
    await dispatchPendingEvents([consumer]);
    expect(handled.filter((id) => id === ok)).toHaveLength(1);
    expect(handled).not.toContain(flaky);

    await sql`update public.domain_event_deliveries set next_attempt_at = now() where event_id = ${flaky} and consumer = ${consumerName}`;
    await dispatchPendingEvents([consumer]);
    expect(handled.filter((id) => id === flaky)).toHaveLength(1);
    expect(await delivery(flaky)).toMatchObject({ attempts: 2, last_error: null });
  });

  it('concurrent dispatchers never deliver the same event twice', async () => {
    const ids = await Promise.all([emit(), emit(), emit(), emit()]);
    await Promise.all([dispatchPendingEvents([consumer]), dispatchPendingEvents([consumer]), dispatchPendingEvents([consumer])]);
    for (const id of ids) expect(handled.filter((h) => h === id)).toHaveLength(1);
  });

  it('ignores events older than the lookback window', async () => {
    const old = await emit();
    await sql`update public.domain_events set occurred_at = now() - interval '3 days' where id = ${old}`;
    await dispatchPendingEvents([consumer]);
    expect(handled).not.toContain(old);
    expect(await delivery(old)).toBeUndefined();
  });
});
