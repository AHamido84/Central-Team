/**
 * Sales metrics — pure, used by the dashboard, the pipeline board and tests. Money is in minor units (halalas).
 */
import type { DealStatus, StageKind } from '@/modules/crm/constants';

export type MetricDeal = {
  id: string;
  stageId: string;
  status: DealStatus;
  valueMinor: number;
  probability: number;
  expectedCloseDate: string | null;
  ownerId: string | null;
  source: string | null;
  createdAt: string;
  wonAt: string | null;
  lostAt: string | null;
};

export type MetricStage = { id: string; kind: StageKind; sortOrder: number };
export type StageMove = { dealId: string; toStageId: string };

export const weightedValue = (d: Pick<MetricDeal, 'valueMinor' | 'probability'>) => Math.round((d.valueMinor * d.probability) / 100);

/** Count, value and weighted value per stage (open deals in open stages; won / lost stages show their deals too). */
export function pipelineByStage(deals: readonly MetricDeal[], stages: readonly MetricStage[]) {
  return [...stages]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => {
      const inStage = deals.filter((d) => d.stageId === s.id);
      return {
        stageId: s.id,
        kind: s.kind,
        count: inStage.length,
        value: inStage.reduce((n, d) => n + d.valueMinor, 0),
        weighted: inStage.reduce((n, d) => n + (s.kind === 'open' ? weightedValue(d) : s.kind === 'won' ? d.valueMinor : 0), 0),
      };
    });
}

const inWindow = (iso: string | null, from: string, to: string) => Boolean(iso && iso.slice(0, 10) >= from && iso.slice(0, 10) <= to);

/** Won ÷ (won + lost) for deals closed in [from, to]; null when nothing closed. */
export function winRate(deals: readonly MetricDeal[], from: string, to: string): number | null {
  const won = deals.filter((d) => d.status === 'won' && inWindow(d.wonAt, from, to)).length;
  const lost = deals.filter((d) => d.status === 'lost' && inWindow(d.lostAt, from, to)).length;
  return won + lost ? won / (won + lost) : null;
}

/** Average days from creation to won, for deals won in [from, to]. */
export function averageCycleDays(deals: readonly MetricDeal[], from: string, to: string): number | null {
  const cycles = deals
    .filter((d) => d.status === 'won' && d.wonAt && inWindow(d.wonAt, from, to))
    .map((d) => (new Date(d.wonAt!).getTime() - new Date(d.createdAt).getTime()) / 86_400_000);
  return cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : null;
}

/**
 * Stage-to-stage conversion over the open stages in order, then the last open stage → won. A deal "reached" a stage
 * when it was ever in it or in a later open stage; won deals reached every open stage. `rate` = reached next ÷
 * reached this (null when nobody reached this stage).
 */
export function stageConversion(
  deals: readonly Pick<MetricDeal, 'id' | 'status' | 'stageId'>[],
  stages: readonly MetricStage[],
  moves: readonly StageMove[],
) {
  const open = [...stages].filter((s) => s.kind === 'open').sort((a, b) => a.sortOrder - b.sortOrder);
  const index = new Map(open.map((s, i) => [s.id, i]));
  const furthest = new Map<string, number>();
  for (const d of deals) {
    let best = -1;
    if (d.status === 'won') best = open.length;
    else {
      const current = index.get(d.stageId);
      if (current !== undefined) best = current;
      for (const m of moves) if (m.dealId === d.id) best = Math.max(best, index.get(m.toStageId) ?? -1);
    }
    furthest.set(d.id, best);
  }
  const reached = (i: number) => [...furthest.values()].filter((f) => f >= i).length;
  return open.map((s, i) => {
    const here = reached(i);
    const next = reached(i + 1);
    return { stageId: s.id, reached: here, advanced: next, rate: here ? next / here : null, toWon: i === open.length - 1 };
  });
}

/** Month keys (YYYY-MM) from `start` for `count` months. */
export function monthKeys(start: string, count: number): string[] {
  const d = new Date(`${start.slice(0, 7)}-01T12:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1));
    return m.toISOString().slice(0, 7);
  });
}

/**
 * Per month: value already won, weighted value of open deals expected to close that month (overdue expected dates
 * count in the first month), and the target. `forecast` = won + weighted.
 */
export function forecastByMonth(
  deals: readonly MetricDeal[],
  months: readonly string[],
  targets: ReadonlyMap<string, number>,
): { month: string; won: number; weighted: number; forecast: number; target: number | null }[] {
  const first = months[0] ?? '';
  return months.map((month) => {
    const won = deals.filter((d) => d.status === 'won' && d.wonAt?.slice(0, 7) === month).reduce((n, d) => n + d.valueMinor, 0);
    const weighted = deals
      .filter((d) => {
        if (d.status !== 'open' || !d.expectedCloseDate) return false;
        const m = d.expectedCloseDate.slice(0, 7);
        return m === month || (month === first && m < first);
      })
      .reduce((n, d) => n + weightedValue(d), 0);
    return { month, won, weighted, forecast: won + weighted, target: targets.get(month) ?? null };
  });
}

export type LeadForSource = { source: string; status: string; createdAt: string };

/** Leads per source in the window, with how many were converted to a deal. */
export function leadsBySource(leads: readonly LeadForSource[], from: string, to: string) {
  const map = new Map<string, { source: string; leads: number; converted: number }>();
  for (const l of leads) {
    if (!inWindow(l.createdAt, from, to) || l.status === 'merged') continue;
    const row = map.get(l.source) ?? { source: l.source, leads: 0, converted: 0 };
    row.leads++;
    if (l.status === 'converted') row.converted++;
    map.set(l.source, row);
  }
  return [...map.values()].sort((a, b) => b.leads - a.leads);
}

/** Per salesperson: open value / weighted, won in window (count, value), lost in window, win rate. */
export function performanceByOwner(deals: readonly MetricDeal[], from: string, to: string) {
  const owners = [...new Set(deals.map((d) => d.ownerId))];
  return owners
    .map((ownerId) => {
      const mine = deals.filter((d) => d.ownerId === ownerId);
      const open = mine.filter((d) => d.status === 'open');
      const won = mine.filter((d) => d.status === 'won' && inWindow(d.wonAt, from, to));
      const lost = mine.filter((d) => d.status === 'lost' && inWindow(d.lostAt, from, to));
      return {
        ownerId,
        openCount: open.length,
        openValue: open.reduce((n, d) => n + d.valueMinor, 0),
        weighted: open.reduce((n, d) => n + weightedValue(d), 0),
        wonCount: won.length,
        wonValue: won.reduce((n, d) => n + d.valueMinor, 0),
        lostCount: lost.length,
        winRate: won.length + lost.length ? won.length / (won.length + lost.length) : null,
      };
    })
    .sort((a, b) => b.wonValue - a.wonValue || b.weighted - a.weighted);
}
