import 'server-only';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import type { DomainEventPayloads, DomainEventType } from '@/lib/events/registry';

/** A committed domain event as consumers receive it. */
export type StoredEvent<T extends DomainEventType = DomainEventType> = {
  id: string;
  organizationId: string;
  type: T;
  aggregateType: string;
  aggregateId: string | null;
  clientId: string | null;
  actorId: string | null;
  payload: DomainEventPayloads[T];
  occurredAt: Date;
  /** Automation actions that led to this event (loop guard, ADR-071). */
  automationDepth: number;
  automationChain: string[];
};

type AnyStoredEvent = { [T in DomainEventType]: StoredEvent<T> }[DomainEventType];

/**
 * A consumer reacts to committed events. Handlers must be idempotent: a delivery can run again after a crash
 * between the handler finishing and the delivery being marked processed.
 */
export type Consumer = {
  name: string;
  types: readonly DomainEventType[];
  handle: (event: AnyStoredEvent) => Promise<void>;
};

export function defineConsumer<const T extends readonly DomainEventType[]>(consumer: {
  name: string;
  types: T;
  handle: (event: { [K in T[number]]: StoredEvent<K> }[T[number]]) => Promise<void>;
}): Consumer {
  return consumer as unknown as Consumer;
}

export const DISPATCH = {
  /** Events older than this when a consumer first sees them are not delivered (no surprise backfills). */
  lookback: '2 days',
  maxAttempts: 8,
  leaseSeconds: 120,
  batchSize: 50,
} as const;

/** Exponential backoff: 30s, 1m, 2m, 4m … capped at 1h. */
export function backoffSeconds(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(attempts - 1, 0), 3600);
}

type ClaimedRow = {
  event_id: string;
  consumer: string;
  attempts: number;
  organization_id: string;
  type: DomainEventType;
  aggregate_type: string;
  aggregate_id: string | null;
  client_id: string | null;
  actor_id: string | null;
  payload: unknown;
  occurred_at: Date | string;
  automation_depth: number;
  automation_chain: string[] | null;
};

export type DispatchResult = { delivered: number; failed: number };

/**
 * Delivers pending events to consumers (ADR-027). Runs with the service connection: deliveries are
 * infrastructure rows no user may read or write (listed service path, CLAUDE.md §6).
 *
 * 1. Materialize one `domain_event_deliveries` row per (recent event × subscribed consumer).
 * 2. Claim a batch with `for update skip locked` and a lease, so concurrent dispatchers never share work.
 * 3. Run handlers; mark processed, or record the error and back off.
 */
export async function dispatchPendingEvents(consumers: readonly Consumer[], opts: { limit?: number } = {}): Promise<DispatchResult> {
  const result: DispatchResult = { delivered: 0, failed: 0 };
  if (consumers.length === 0) return result;
  const byName = new Map(consumers.map((c) => [c.name, c]));

  for (const c of consumers) {
    await dbAdmin.execute(sql`
      insert into public.domain_event_deliveries (event_id, consumer)
      select e.id, ${c.name} from public.domain_events e
      where e.type = any(${sql.raw(`array[${c.types.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')}]::text[]`)})
        and e.occurred_at > now() - ${DISPATCH.lookback}::interval
        and not exists (select 1 from public.domain_event_deliveries d where d.event_id = e.id and d.consumer = ${c.name})
      on conflict do nothing`);
  }

  const names = sql.raw(`array[${[...byName.keys()].map((n) => `'${n.replace(/'/g, "''")}'`).join(',')}]::text[]`);
  const claimed = await dbAdmin.execute<ClaimedRow>(sql`
    with picked as (
      select d.event_id, d.consumer from public.domain_event_deliveries d
      join public.domain_events e on e.id = d.event_id
      where d.processed_at is null and d.consumer = any(${names})
        and d.attempts < ${DISPATCH.maxAttempts} and d.next_attempt_at <= now()
        and (d.locked_until is null or d.locked_until < now())
      order by e.occurred_at
      limit ${opts.limit ?? DISPATCH.batchSize}
      for update of d skip locked
    ), claimed as (
      update public.domain_event_deliveries d
      set attempts = d.attempts + 1, locked_until = now() + make_interval(secs => ${DISPATCH.leaseSeconds})
      from picked where d.event_id = picked.event_id and d.consumer = picked.consumer
      returning d.event_id, d.consumer, d.attempts
    )
    select c.event_id, c.consumer, c.attempts, e.organization_id, e.type, e.aggregate_type, e.aggregate_id,
           e.client_id, e.actor_id, e.payload, e.occurred_at, e.automation_depth, e.automation_chain
    from claimed c join public.domain_events e on e.id = c.event_id
    order by e.occurred_at`);

  for (const row of claimed) {
    const consumer = byName.get(row.consumer);
    if (!consumer) continue;
    const event = {
      id: row.event_id,
      organizationId: row.organization_id,
      type: row.type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      clientId: row.client_id,
      actorId: row.actor_id,
      payload: row.payload,
      occurredAt: new Date(row.occurred_at),
      automationDepth: row.automation_depth ?? 0,
      automationChain: row.automation_chain ?? [],
    } as AnyStoredEvent;
    try {
      await consumer.handle(event);
      await dbAdmin.execute(sql`
        update public.domain_event_deliveries
        set processed_at = now(), locked_until = null, last_error = null
        where event_id = ${row.event_id} and consumer = ${row.consumer}`);
      result.delivered++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[events] ${row.consumer} failed on ${row.type} (${row.event_id}), attempt ${row.attempts}`, error);
      await dbAdmin.execute(sql`
        update public.domain_event_deliveries
        set locked_until = null, last_error = ${message.slice(0, 1000)},
            next_attempt_at = now() + make_interval(secs => ${backoffSeconds(row.attempts)})
        where event_id = ${row.event_id} and consumer = ${row.consumer}`);
      result.failed++;
    }
  }
  return result;
}
