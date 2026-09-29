/**
 * Client health for the ops dashboard and Client 360 — a transparent penalty score, not a model: every signal
 * costs points up to a cap, and the reasons shown are the signals that cost the most. Pure (shared by server and UI).
 */
export type ClientSignals = {
  /** Open requests past their reply or delivery target. */
  slaOverdue: number;
  slaAtRisk: number;
  overdueTasks: number;
  /** Deliverables waiting on the client longer than the approval reminder interval. */
  staleApprovals: number;
  campaignsOffTrack: number;
  campaignsAtRisk: number;
  /** Client-side threads whose last message is from the client. */
  unansweredMessages: number;
  /** SLA breaches recorded in the last 30 days. */
  recentBreaches: number;
};

export const healthReasons = [
  'slaOverdue',
  'campaignsOffTrack',
  'overdueTasks',
  'unansweredMessages',
  'staleApprovals',
  'recentBreaches',
  'slaAtRisk',
  'campaignsAtRisk',
] as const satisfies readonly (keyof ClientSignals)[];
export type HealthReason = (typeof healthReasons)[number];

export const clientHealthLevels = ['healthy', 'watch', 'at_risk'] as const;
export type ClientHealth = (typeof clientHealthLevels)[number];

export const clientHealthTone = { healthy: 'success', watch: 'warning', at_risk: 'danger' } as const satisfies Record<ClientHealth, string>;

/** Points per occurrence and the most a signal can cost. */
const weights: Record<HealthReason, { each: number; max: number }> = {
  slaOverdue: { each: 15, max: 45 },
  campaignsOffTrack: { each: 15, max: 30 },
  overdueTasks: { each: 4, max: 20 },
  unansweredMessages: { each: 5, max: 15 },
  staleApprovals: { each: 5, max: 15 },
  recentBreaches: { each: 3, max: 15 },
  slaAtRisk: { each: 5, max: 15 },
  campaignsAtRisk: { each: 5, max: 10 },
};

export const HEALTHY_FROM = 80;
export const WATCH_FROM = 55;

export function emptySignals(): ClientSignals {
  return {
    slaOverdue: 0,
    slaAtRisk: 0,
    overdueTasks: 0,
    staleApprovals: 0,
    campaignsOffTrack: 0,
    campaignsAtRisk: 0,
    unansweredMessages: 0,
    recentBreaches: 0,
  };
}

export function clientHealth(s: ClientSignals): { health: ClientHealth; score: number; reasons: HealthReason[] } {
  const costs = healthReasons
    .map((key) => ({ key, cost: Math.min(weights[key].max, Math.max(0, s[key]) * weights[key].each) }))
    .filter((c) => c.cost > 0);
  const score = Math.max(0, 100 - costs.reduce((n, c) => n + c.cost, 0));
  const health: ClientHealth = score >= HEALTHY_FROM ? 'healthy' : score >= WATCH_FROM ? 'watch' : 'at_risk';
  // Stable order: biggest cost first, ties by the catalog order above.
  const reasons = costs.sort((a, b) => b.cost - a.cost || healthReasons.indexOf(a.key) - healthReasons.indexOf(b.key)).map((c) => c.key);
  return { health, score, reasons };
}

const healthRank: Record<ClientHealth, number> = { at_risk: 0, watch: 1, healthy: 2 };

/** Worst first, then lowest score. */
export function compareHealth(a: { health: ClientHealth; score: number }, b: { health: ClientHealth; score: number }): number {
  return healthRank[a.health] - healthRank[b.health] || a.score - b.score;
}

/** Load bar for the team view: open tasks relative to the busiest person, 0–1. */
export function loadShare(open: number, busiest: number): number {
  return busiest > 0 ? Math.min(1, open / busiest) : 0;
}
