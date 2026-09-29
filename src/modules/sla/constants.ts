import type { RequestPriority } from '@/modules/requests/constants';

export const breachKinds = ['response', 'resolution'] as const;
export type BreachKind = (typeof breachKinds)[number];

export const breachLevels = ['at_risk', 'breached'] as const;
export type BreachLevel = (typeof breachLevels)[number];

export const breachLevelTone = { at_risk: 'warning', breached: 'danger' } as const satisfies Record<BreachLevel, string>;

/** Filters of the breach log on the SLA monitor. */
export const breachViews = ['open', 'unacknowledged', 'resolved', 'all'] as const;
export type BreachView = (typeof breachViews)[number];

export type PolicyCriteria = {
  id: string;
  clientId: string | null;
  requestTypeId: string | null;
  priority: RequestPriority | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
};

/** Client (4) > request type (2) > priority (1): the same weights as `app.sla_policy_for`. */
export function policySpecificity(p: Pick<PolicyCriteria, 'clientId' | 'requestTypeId' | 'priority'>): number {
  return (p.clientId ? 4 : 0) + (p.requestTypeId ? 2 : 0) + (p.priority ? 1 : 0);
}

/** The policy a request gets at submit — mirrors `app.sla_policy_for` (unit-tested against the same cases). */
export function matchPolicy<T extends PolicyCriteria>(
  policies: readonly T[],
  r: { clientId: string; requestTypeId: string; priority: RequestPriority },
): T | null {
  const candidates = policies.filter(
    (p) =>
      p.isActive &&
      (!p.clientId || p.clientId === r.clientId) &&
      (!p.requestTypeId || p.requestTypeId === r.requestTypeId) &&
      (!p.priority || p.priority === r.priority),
  );
  candidates.sort(
    (a, b) => policySpecificity(b) - policySpecificity(a) || a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt),
  );
  return candidates[0] ?? null;
}

/** Share of a window already used, 0–1 (for meters). */
export function windowUsed(startIso: string, dueIso: string, now: Date = new Date()): number {
  const start = new Date(startIso).getTime();
  const due = new Date(dueIso).getTime();
  if (due <= start) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start) / (due - start)));
}
