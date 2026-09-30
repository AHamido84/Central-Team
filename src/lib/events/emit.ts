import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';

import type { Tx } from '@/lib/db/client';
import { domainEvents } from '@/lib/db/schema';
import type { DomainEventPayloads, DomainEventType } from '@/lib/events/registry';

export type EmitEventInput<T extends DomainEventType> = {
  type: T;
  organizationId: string;
  /** Null for system events (e.g. the reminder sweep). */
  actorId: string | null;
  aggregate: { type: string; id?: string | null };
  clientId?: string | null;
  payload: DomainEventPayloads[T];
};

/**
 * Set by the automation engine while a rule's actions run (ADR-071): every event emitted inside carries the depth and
 * the chain of rules that caused it, which the loop guard reads. Outside automations the store is empty.
 */
export const automationCause = new AsyncLocalStorage<{ depth: number; chain: string[] }>();

/**
 * Records a domain event in the caller's transaction (transactional outbox, ADR-012).
 * Consumers (notifications, automations, AI) read `domain_events`; producers never call them directly.
 */
export async function emitEvent<T extends DomainEventType>(tx: Tx, event: EmitEventInput<T>): Promise<string> {
  const id = crypto.randomUUID();
  const cause = automationCause.getStore();
  await tx.insert(domainEvents).values({
    id,
    organizationId: event.organizationId,
    type: event.type,
    aggregateType: event.aggregate.type,
    aggregateId: event.aggregate.id ?? null,
    clientId: event.clientId ?? null,
    actorId: event.actorId,
    payload: event.payload,
    automationDepth: cause?.depth ?? 0,
    automationChain: cause?.chain ?? [],
  });
  return id;
}
