/**
 * Builds the Executive Center from rows loaded through RLS (FR7, ADR-096). Pure: the server loader, the board-report
 * exports and the tests all call it. Domain rules come from the modules that own them — `compliance` (SLA),
 * `winRate` / `averageCycleDays` / `pipelineByStage` / `stageConversion` / `forecastByMonth` / `leadsBySource` /
 * `performanceByOwner` (CRM), `memberWeekCapacity` / `capacityGrid` levels (capacity), client health from the
 * operations overview and campaign health from the campaign analysis — so the numbers match those screens.
 */
import { memberWeekCapacity, type Member, type TimeOff } from '@/modules/capacity/calc';
import {
  averageCycleDays,
  forecastByMonth,
  leadsBySource,
  monthKeys as crmMonthKeys,
  performanceByOwner,
  pipelineByStage,
  stageConversion,
  weightedValue,
  winRate,
  type LeadForSource,
  type MetricDeal,
  type MetricStage,
  type StageMove,
} from '@/modules/crm/metrics';
import { AI_BUDGET_WARN, BACKLOG_AGED_DAYS, CONCENTRATION_LIMIT, kpis, TOKEN_EXPIRY_DAYS, type KpiKey } from '@/modules/executive/catalog';
import {
  addDays,
  addMonths,
  dayCount,
  daysBetween,
  delta,
  deltaTone,
  elapsedRange,
  isSmallSample,
  mean,
  median,
  monthEnd,
  monthStart,
  overlapDays,
  p90,
  projectToEnd,
  rate,
  targetFor,
  targetProgress,
  topShare,
  type Delta,
  type Period,
  type TargetRow,
} from '@/modules/executive/kpi';
import type { ExecutiveViewConfig } from '@/modules/executive/types';
import type { ClientHealth, HealthReason } from '@/modules/operations/health';
import { compliance, type ComplianceRow } from '@/modules/sla/constants';

// ---------------------------------------------------------------------------
// Inputs (what the loader reads)
// ---------------------------------------------------------------------------

type Name = { ar: string; en?: string } | Record<string, string>;

export type ExecutiveInputs = {
  today: string;
  period: Period;
  comparison: Period | null;
  clients: { id: string; name: Name; accountManagerId: string | null; status: string }[];
  packages: { clientId: string; packageId: string; packageName: Name; priceMinor: number; periodStart: string; periodEnd: string }[];
  /** Current package use per client (`getCurrentPackageUsage`). */
  usage: { clientId: string; ratio: number | null; over: number }[];
  requestTypes: { id: string; name: Name }[];
  requests: (ComplianceRow & { id: string; clientId: string; typeId: string | null; status: string; isExtra: boolean })[];
  deliverables: {
    id: string;
    clientId: string;
    revisionRounds: number;
    status: string;
    approvedAt: string | null;
    dueDate: string | null;
  }[];
  /** Versions sent to the client and decided (approved or changes requested). */
  clientDecisions: { clientId: string; sentAt: string; decidedAt: string }[];
  tasks: {
    id: string;
    clientId: string;
    departmentId: string | null;
    statusCategory: string;
    dueDate: string | null;
    completedAt: string | null;
    startedAt: string;
    stepName: Name | null;
    assigneeIds: string[];
  }[];
  time: { userId: string; clientId: string | null; day: string; minutes: number }[];
  departments: { id: string; name: Name; color: string }[];
  people: { id: string; name: string; hoursPerWeek: number; departmentIds: string[] }[];
  timeOff: TimeOff[];
  holidays: string[];
  /** Capacity grid for the coming weeks (`capacityGrid` on `getCapacity`'s data). */
  capacity: {
    weeks: { start: string; end: string }[];
    rows: { departmentId: string; cells: { capacity: number; demand: number; level: string }[] }[];
  };
  metrics: {
    date: string;
    campaignId: string;
    clientId: string;
    platform: string;
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    leads: number;
    revenue: number;
  }[];
  campaigns: {
    id: string;
    name: string;
    clientId: string;
    status: string;
    health: string;
    budgetMinor: number;
    spentMinor: number;
    elapsed: number;
    pacingStatus: string | null;
  }[];
  insights: { clientId: string | null; severity: string; status: string }[];
  /** `getOpsOverview` (all clients): current health and the open problems. */
  ops: {
    clients: { id: string; score: number; health: ClientHealth; reasons: HealthReason[] }[];
    slaOverdue: number;
    unacknowledgedBreaches: number;
    overdueTasks: number;
    staleApprovals: number;
  };
  sales: {
    stages: (MetricStage & { name: Name })[];
    deals: (MetricDeal & { lostReason: string | null; title: string; lastActivityAt: string; clientId: string | null })[];
    moves: StageMove[];
    leads: LeadForSource[];
    targets: Map<string, number>;
    people: Map<string, string>;
    staleDays: number;
  };
  leads: { createdAt: string; firstActivityAt: string | null }[];
  integrations: { id: string; provider: string; name: string; status: string; tokenExpiresAt: string | null; ownerId: string | null }[];
  ai: { budget: number | null; used: number };
  targets: TargetRow[];
  snapshots: { day: string; metric: string; value: number | null; details: Record<string, number> }[];
  /** Agency members' names by id (owners, account managers, salespeople). */
  names: Record<string, string>;
  config: ExecutiveViewConfig;
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type KpiValue = {
  key: KpiKey;
  value: number | null;
  previous: number | null;
  delta: Delta | null;
  tone: 'good' | 'bad' | 'flat';
  /** Monthly values for the last 12 months ending with the period (state metrics: from snapshots). */
  sparkline: (number | null)[];
  target: number | null;
  progress: number | null;
  /** For rates: numerator / denominator, shown on hover; `small` flags a sample under 5. */
  parts: { num: number; den: number } | null;
  sample: number | null;
  small: boolean;
  /** Incomplete period: the flow value projected to the period's end. */
  projection: number | null;
};

export type RiskItem = {
  id: string;
  category: 'client' | 'delivery' | 'capacity' | 'financial' | 'integration' | 'ai';
  severity: 'high' | 'medium' | 'low';
  /** Message key under `executive.risk.*` with its parameters. */
  reason: string;
  params: Record<string, string | number>;
  ownerId: string | null;
  href: string;
  impact: number;
};

export type ExecutiveReport = ReturnType<typeof buildExecutiveReport>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const inRange = (iso: string | null, from: string, to: string) => {
  const d = day(iso);
  return d !== null && d >= from && d <= to;
};
const sum = <T>(rows: readonly T[], f: (r: T) => number) => rows.reduce((n, r) => n + f(r), 0);
const DONE_REQUEST = new Set(['delivered', 'closed', 'cancelled', 'rejected', 'draft']);
const severityRank = { high: 3, medium: 2, low: 1 } as const;

type Measure = { value: number | null; num?: number; den?: number; n?: number };

/** Package revenue recognized per day: the monthly price spread over the year's days (12 / 365). */
function revenueIn(packages: ExecutiveInputs['packages'], from: string, to: string, clientId?: string) {
  return sum(
    packages.filter((p) => !clientId || p.clientId === clientId),
    (p) => (p.priceMinor * 12 * overlapDays(from, to, p.periodStart, p.periodEnd)) / 365,
  );
}

function clientSpans(packages: ExecutiveInputs['packages']) {
  const spans = new Map<string, { first: string; last: string }>();
  for (const p of packages) {
    const s = spans.get(p.clientId);
    spans.set(p.clientId, {
      first: !s || p.periodStart < s.first ? p.periodStart : s.first,
      last: !s || p.periodEnd > s.last ? p.periodEnd : s.last,
    });
  }
  return spans;
}

const activeOn = (packages: ExecutiveInputs['packages'], d: string) =>
  new Set(packages.filter((p) => p.periodStart <= d && p.periodEnd >= d).map((p) => p.clientId));

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export function buildExecutiveReport(input: ExecutiveInputs) {
  const { today, period, comparison, config } = input;
  const f = config.filters;

  // Filters: client / account manager narrow everything client-scoped; department the team; platform the marketing.
  const clientIds = new Set(
    input.clients
      .filter((c) => (!f.clientId || c.id === f.clientId) && (!f.accountManagerId || c.accountManagerId === f.accountManagerId))
      .map((c) => c.id),
  );
  const byClient = <T extends { clientId: string | null }>(rows: readonly T[]) =>
    rows.filter((r) => r.clientId === null || clientIds.has(r.clientId));
  const packages = input.packages.filter((p) => clientIds.has(p.clientId));
  const requests = byClient(input.requests);
  const deliverables = byClient(input.deliverables);
  const decisions = byClient(input.clientDecisions);
  const tasks = byClient(input.tasks).filter((t) => !f.departmentId || t.departmentId === f.departmentId);
  const people = input.people.filter((p) => p.departmentIds.length > 0 && (!f.departmentId || p.departmentIds.includes(f.departmentId)));
  const peopleIds = new Set(people.map((p) => p.id));
  const time = input.time.filter(
    (t) => peopleIds.has(t.userId) && (t.clientId === null || clientIds.has(t.clientId) || (!f.clientId && !f.accountManagerId)),
  );
  const metrics = input.metrics.filter((m) => clientIds.has(m.clientId) && (!f.platform || m.platform === f.platform));
  const campaigns = input.campaigns.filter((c) => clientIds.has(c.clientId));
  const health = input.ops.clients.filter((c) => clientIds.has(c.id));
  const cal = { holidays: new Set(input.holidays) };
  const spans = clientSpans(packages);

  // --- Flow and rate metrics for any range -------------------------------------------------------------------------
  function metricsFor(from: string, to: string) {
    const submitted = requests.filter((r) => inRange(r.submittedAt, from, to));
    const delivered = requests.filter((r) => inRange(r.deliveredAt, from, to));
    const comp = compliance(submitted, new Date(`${to}T23:59:59Z`));
    const turnaround = delivered.filter((r) => r.submittedAt).map((r) => daysBetween(r.submittedAt!, r.deliveredAt!));
    const approved = deliverables.filter((d) => inRange(d.approvedAt, from, to));
    const decided = decisions.filter((d) => inRange(d.decidedAt, from, to));
    const done = tasks.filter((t) => inRange(t.completedAt, from, to));
    const doneWithDue = done.filter((t) => t.dueDate);
    const logged = sum(
      time.filter((t) => t.day >= from && t.day <= to),
      (t) => t.minutes / 60,
    );
    const available = sum(people, (p) => memberWeekCapacity(p as Member, { start: from, end: to }, cal, input.timeOff));
    const m = metrics.filter((r) => r.date >= from && r.date <= to);
    const spend = sum(m, (r) => r.spend);
    const conv = sum(m, (r) => r.conversions);
    const mLeads = sum(m, (r) => r.leads);
    const mRevenue = sum(m, (r) => r.revenue);
    const impressions = sum(m, (r) => r.impressions);
    const clicks = sum(m, (r) => r.clicks);
    const firstStarts = [...spans.entries()].filter(([, s]) => s.first >= from && s.first <= to);
    const churned = [...spans.entries()].filter(([, s]) => s.last >= from && s.last <= to && s.last < today);
    const startActive = activeOn(packages, from);
    const endActive = activeOn(packages, to < today ? to : today);
    const retained = [...startActive].filter((id) => endActive.has(id)).length;
    const revenue = revenueIn(packages, from, to);
    const hours = logged;
    const deals = input.sales.deals;
    const won = deals.filter((d) => d.status === 'won' && inRange(d.wonAt, from, to));
    const closedDeals = deals.filter(
      (d) => (d.status === 'won' && inRange(d.wonAt, from, to)) || (d.status === 'lost' && inRange(d.lostAt, from, to)),
    ).length;
    const newLeads = input.sales.leads.filter((l) => inRange(l.createdAt, from, to) && l.status !== 'merged');
    const responses = input.leads
      .filter((l) => inRange(l.createdAt, from, to) && l.firstActivityAt)
      .map((l) => daysBetween(l.createdAt, l.firstActivityAt!) * 24)
      .filter((h) => h >= 0);
    return {
      new_clients: { value: firstStarts.length, n: firstStarts.length },
      churned_clients: { value: churned.length, n: churned.length },
      revenue: { value: revenue },
      retention_rate: { ...rate(retained, startActive.size) },
      revenue_per_hour: { value: hours > 0 ? revenue / hours : null, n: Math.round(hours) },
      extra_requests: { value: submitted.filter((r) => r.isExtra).length },
      requests_submitted: { value: submitted.length },
      requests_delivered: { value: delivered.length },
      turnaround_median: { value: median(turnaround), n: turnaround.length },
      turnaround_p90: { value: p90(turnaround), n: turnaround.length },
      on_time_rate: { value: comp.resolution.rate, num: comp.resolution.met, den: comp.resolution.total },
      sla_compliance: { value: comp.response.rate, num: comp.response.met, den: comp.response.total },
      revision_rounds: { value: mean(approved.map((d) => d.revisionRounds)), n: approved.length },
      first_time_approval: { ...rate(approved.filter((d) => d.revisionRounds === 0).length, approved.length) },
      approval_wait: { value: median(decided.map((d) => daysBetween(d.sentAt, d.decidedAt))), n: decided.length },
      utilization: { ...rate(logged, available) },
      tasks_done: { value: done.length },
      task_on_time_rate: {
        ...rate(doneWithDue.filter((t) => day(t.completedAt)! <= t.dueDate!).length, doneWithDue.length),
      },
      ad_spend: { value: spend },
      conversions: { value: conv },
      cpa: { value: conv > 0 ? spend / conv : null, n: conv },
      cpl: { value: mLeads > 0 ? spend / mLeads : null, n: mLeads },
      roas: { value: spend > 0 ? mRevenue / spend : null, n: m.length },
      ctr: { ...rate(clicks, impressions) },
      leads_new: { value: newLeads.length },
      win_rate: { value: winRate(deals, from, to), num: won.length, den: closedDeals },
      sales_cycle: { value: averageCycleDays(deals, from, to), n: won.length },
      avg_deal_size: { value: won.length ? sum(won, (d) => d.valueMinor) / won.length : null, n: won.length },
      bookings: { value: sum(won, (d) => d.valueMinor) },
      lead_response: { value: median(responses), n: responses.length },
    } as Partial<Record<KpiKey, Measure>>;
  }

  // --- State metrics (now), with history from snapshots ------------------------------------------------------------
  const openDeals = input.sales.deals.filter((d) => d.status === 'open');
  const openRequests = requests.filter((r) => !DONE_REQUEST.has(r.status));
  const nextWeeks = input.capacity.rows
    .filter((r) => !f.departmentId || r.departmentId === f.departmentId)
    .map((r) => ({ ...r, cells: r.cells.slice(0, 4) }));
  const lifetimes = [...spans.values()].map((s) => dayCount(s.first, s.last < today ? s.last : today) / 30.4);
  const monthlyRevenue12 = revenueIn(packages, addDays(addMonths(today, -12), 1), today) / 12;
  const activeNow = activeOn(packages, today);
  const state: Partial<Record<KpiKey, Measure>> = {
    active_clients: { value: activeOn(packages, period.to < today ? period.to : today).size },
    avg_health: { value: mean(health.map((c) => c.score)), n: health.length },
    clv: {
      value: activeNow.size && lifetimes.length ? (monthlyRevenue12 / Math.max(1, activeNow.size)) * (mean(lifetimes) ?? 0) : null,
      n: lifetimes.length,
    },
    top5_share: { value: null },
    backlog_open: { value: openRequests.length },
    backlog_aged: {
      value: openRequests.filter((r) => r.submittedAt && daysBetween(r.submittedAt, `${today}T12:00:00Z`) > BACKLOG_AGED_DAYS).length,
    },
    overloaded_departments: { value: nextWeeks.filter((r) => r.cells.some((c) => c.level === 'over')).length },
    campaigns_at_risk: {
      value: campaigns.filter((c) => c.status === 'active' && (c.health === 'at_risk' || c.health === 'off_track')).length,
    },
    pipeline_value: { value: sum(openDeals, (d) => d.valueMinor), n: openDeals.length },
    weighted_forecast: { value: sum(openDeals, weightedValue), n: openDeals.length },
  };

  // Concentration over the period's revenue.
  const range = elapsedRange(period);
  const revenueByClient = [...clientIds]
    .map((id) => ({ id, value: revenueIn(packages, range.from, range.to, id) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  state.top5_share = {
    value: topShare(
      revenueByClient.map((r) => r.value),
      5,
    ),
    n: revenueByClient.length,
  };

  const current = metricsFor(range.from, range.to);
  const previous = comparison ? metricsFor(comparison.from, comparison.to) : null;

  // --- Sparklines: 12 monthly points ending with the period's (last) month --------------------------------------
  const sparkMonths = Array.from({ length: 12 }, (_, i) => addMonths(monthStart(period.to < today ? period.to : today), i - 11));
  const monthly = sparkMonths.map((m) => {
    const to = monthEnd(m) < today ? monthEnd(m) : today;
    return metricsFor(m, to);
  });
  const snapshotFor = (metric: string, d: string) => {
    const rows = input.snapshots.filter((s) => s.metric === metric && s.day <= d);
    return rows.length ? rows.reduce((a, b) => (a.day > b.day ? a : b)).value : null;
  };

  const risks = buildRisks();
  state.open_risks = { value: risks.length, n: risks.length };

  const kpiValues = {} as Record<KpiKey, KpiValue>;
  for (const key of Object.keys(kpis) as KpiKey[]) {
    const def = kpis[key];
    const isState = def.kind === 'state' || key === 'top5_share' || key === 'clv';
    const cur = isState ? state[key] : current[key];
    const value = cur?.value ?? null;
    const prev = isState ? (comparison ? snapshotFor(key, comparison.to) : null) : previous ? (previous[key]?.value ?? null) : null;
    const d = delta(value, prev);
    const parts = cur?.num !== undefined && cur.den !== undefined ? { num: cur.num, den: cur.den } : null;
    const sample = parts ? parts.den : (cur?.n ?? null);
    const target = 'target' in def && def.target ? targetFor(def.target.metric, def.target.kind, period, input.targets) : null;
    const comparableTarget =
      target !== null && 'target' in def && def.target?.kind === 'amount' && period.incomplete
        ? (target * period.elapsedDays) / period.totalDays
        : target;
    kpiValues[key] = {
      key,
      value,
      previous: prev,
      delta: d,
      tone: deltaTone(d, def.direction),
      sparkline: isState ? sparkMonths.map((m) => snapshotFor(key, monthEnd(m))) : monthly.map((x) => x[key]?.value ?? null),
      target,
      progress: targetProgress(value, comparableTarget, def.direction),
      parts,
      sample,
      small: sample !== null && isSmallSample(sample) && def.kind === 'rate',
      projection: def.kind === 'flow' && value !== null ? projectToEnd(value, period) : null,
    };
  }

  // --- Tabs ---------------------------------------------------------------------------------------------------
  const nameOf = (id: string) => input.clients.find((c) => c.id === id)?.name ?? { ar: '' };
  const hoursByClient = new Map<string, number>();
  for (const t of time)
    if (t.clientId && t.day >= range.from && t.day <= range.to)
      hoursByClient.set(t.clientId, (hoursByClient.get(t.clientId) ?? 0) + t.minutes / 60);
  const totalRevenue = sum(revenueByClient, (r) => r.value);

  const clientsTab = {
    revenueByClient: revenueByClient.map((r) => {
      const hours = hoursByClient.get(r.id) ?? 0;
      const h = health.find((c) => c.id === r.id);
      return {
        id: r.id,
        name: nameOf(r.id),
        value: r.value,
        share: totalRevenue ? r.value / totalRevenue : 0,
        hours,
        perHour: hours > 0 ? r.value / hours : null,
        health: h?.health ?? null,
        score: h?.score ?? null,
      };
    }),
    revenueByMonth: sparkMonths.map((m) => ({
      key: m.slice(0, 7),
      value: revenueIn(packages, m, monthEnd(m) < today ? monthEnd(m) : today),
    })),
    revenueByPackage: [...new Set(packages.map((p) => p.packageId))]
      .map((id) => {
        const rows = packages.filter((p) => p.packageId === id);
        return {
          id,
          name: rows[0]!.packageName,
          value: sum(rows, (p) => (p.priceMinor * 12 * overlapDays(range.from, range.to, p.periodStart, p.periodEnd)) / 365),
        };
      })
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value),
    healthDistribution: {
      healthy: health.filter((c) => c.health === 'healthy').length,
      watch: health.filter((c) => c.health === 'watch').length,
      at_risk: health.filter((c) => c.health === 'at_risk').length,
    },
    healthTrend: sparkMonths.map((m) => ({ key: m.slice(0, 7), value: snapshotFor('avg_health', monthEnd(m)) })),
    newVsLost: sparkMonths.map((m, i) => ({
      key: m.slice(0, 7),
      added: monthly[i]!.new_clients?.value ?? 0,
      lost: monthly[i]!.churned_clients?.value ?? 0,
    })),
    packageUsage: input.usage
      .filter((u) => clientIds.has(u.clientId) && u.ratio !== null)
      .map((u) => ({ clientId: u.clientId, name: nameOf(u.clientId), ratio: u.ratio!, over: u.over }))
      .sort((a, b) => b.ratio - a.ratio),
    concentrationRisk: (revenueByClient[0]?.value ?? 0) / (totalRevenue || 1) > CONCENTRATION_LIMIT,
  };

  const typeName = (id: string | null) => input.requestTypes.find((t) => t.id === id)?.name ?? null;
  const delivered = requests.filter((r) => inRange(r.deliveredAt, range.from, range.to) && r.submittedAt);
  const submittedInRange = requests.filter((r) => inRange(r.submittedAt, range.from, range.to));
  const groupCompliance = (key: (r: (typeof requests)[number]) => string | null) => {
    const groups = new Map<string, typeof requests>();
    for (const r of submittedInRange) {
      const k = key(r);
      if (!k) continue;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return [...groups.entries()].map(([id, rows]) => {
      const c = compliance(rows, new Date(`${range.to}T23:59:59Z`));
      return { id, n: rows.length, onTime: c.resolution, sla: c.response };
    });
  };
  const stepDurations = new Map<string, { name: Name; days: number[] }>();
  for (const t of tasks) {
    if (!t.stepName || !t.completedAt || !inRange(t.completedAt, range.from, range.to)) continue;
    const k = JSON.stringify(t.stepName);
    const row = stepDurations.get(k) ?? { name: t.stepName, days: [] };
    row.days.push(Math.max(0, daysBetween(t.startedAt, t.completedAt)));
    stepDurations.set(k, row);
  }
  const ageBuckets = [
    { key: '0_7', max: 7 },
    { key: '8_14', max: 14 },
    { key: '15_30', max: 30 },
    { key: '31_plus', max: Infinity },
  ];
  const operationsTab = {
    intakeVsDone: sparkMonths.map((m, i) => ({
      key: m.slice(0, 7),
      submitted: monthly[i]!.requests_submitted?.value ?? 0,
      delivered: monthly[i]!.requests_delivered?.value ?? 0,
    })),
    turnaroundByType: [...new Set(delivered.map((r) => r.typeId))]
      .map((id) => {
        const days = delivered.filter((r) => r.typeId === id).map((r) => daysBetween(r.submittedAt!, r.deliveredAt!));
        return { id, name: typeName(id), median: median(days), p90: p90(days), n: days.length };
      })
      .sort((a, b) => (b.p90 ?? 0) - (a.p90 ?? 0)),
    complianceByClient: groupCompliance((r) => r.clientId).map((g) => ({ ...g, name: nameOf(g.id) })),
    complianceByType: groupCompliance((r) => r.typeId).map((g) => ({ ...g, name: typeName(g.id) })),
    bottlenecks: [...stepDurations.values()]
      .map((s) => ({ name: s.name, median: median(s.days), p90: p90(s.days), n: s.days.length }))
      .sort((a, b) => (b.median ?? 0) - (a.median ?? 0))
      .slice(0, 8),
    backlogAging: ageBuckets.map((b, i) => ({
      key: b.key,
      count: openRequests.filter((r) => {
        if (!r.submittedAt) return false;
        const age = daysBetween(r.submittedAt, `${today}T12:00:00Z`);
        return age <= b.max && age > (i === 0 ? -Infinity : ageBuckets[i - 1]!.max);
      }).length,
    })),
  };

  const loggedBy = (userIds: Set<string>) =>
    sum(
      time.filter((t) => userIds.has(t.userId) && t.day >= range.from && t.day <= range.to),
      (t) => t.minutes / 60,
    );
  const availableOf = (p: (typeof people)[number]) =>
    memberWeekCapacity(p as Member, { start: range.from, end: range.to }, cal, input.timeOff);
  const teamTab = {
    byDepartment: input.departments
      .filter((d) => !f.departmentId || d.id === f.departmentId)
      .map((d) => {
        const members = people.filter((p) => p.departmentIds.includes(d.id));
        // A member in several departments is split evenly between them (as in capacity planning).
        const logged = sum(members, (p) => loggedBy(new Set([p.id])) / p.departmentIds.length);
        const available = sum(members, (p) => availableOf(p) / p.departmentIds.length);
        return { id: d.id, name: d.name, color: d.color, logged, available, utilization: rate(logged, available) };
      }),
    byPerson: people
      .map((p) => {
        const mine = tasks.filter((t) => t.assigneeIds.includes(p.id));
        const done = mine.filter((t) => inRange(t.completedAt, range.from, range.to));
        const withDue = done.filter((t) => t.dueDate);
        const logged = loggedBy(new Set([p.id]));
        const available = availableOf(p);
        return {
          id: p.id,
          name: p.name,
          logged,
          available,
          utilization: rate(logged, available),
          open: mine.filter((t) => t.statusCategory !== 'done').length,
          done: done.length,
          onTime: rate(withDue.filter((t) => day(t.completedAt)! <= t.dueDate!).length, withDue.length),
        };
      })
      .sort((a, b) => (b.utilization.value ?? 0) - (a.utilization.value ?? 0)),
    forecast: input.capacity.weeks.map((w, i) => ({
      week: w.start,
      capacity: sum(nextWeeksAll(), (r) => r.cells[i]?.capacity ?? 0),
      demand: sum(nextWeeksAll(), (r) => r.cells[i]?.demand ?? 0),
    })),
    hiring: input.capacity.rows
      .filter((r) => !f.departmentId || r.departmentId === f.departmentId)
      .map((r) => {
        const first = r.cells.findIndex((c) => c.level === 'over');
        const gap = sum(
          r.cells.filter((c) => c.level === 'over'),
          (c) => c.demand - c.capacity,
        );
        return {
          departmentId: r.departmentId,
          name: input.departments.find((d) => d.id === r.departmentId)?.name ?? { ar: '' },
          firstWeek: first >= 0 ? input.capacity.weeks[first]!.start : null,
          overWeeks: r.cells.filter((c) => c.level === 'over').length,
          gapHours: gap,
        };
      })
      .filter((r) => r.firstWeek)
      .sort((a, b) => (a.firstWeek! < b.firstWeek! ? -1 : 1)),
  };
  function nextWeeksAll() {
    return input.capacity.rows.filter((r) => !f.departmentId || r.departmentId === f.departmentId);
  }

  const m = metrics.filter((r) => r.date >= range.from && r.date <= range.to);
  const platformRows = [...new Set(m.map((r) => r.platform))].map((platform) => {
    const rows = m.filter((r) => r.platform === platform);
    const spend = sum(rows, (r) => r.spend);
    const conv = sum(rows, (r) => r.conversions);
    const leadsN = sum(rows, (r) => r.leads);
    const rev = sum(rows, (r) => r.revenue);
    const imp = sum(rows, (r) => r.impressions);
    const clicks = sum(rows, (r) => r.clicks);
    return {
      platform,
      spend,
      conversions: conv,
      leads: leadsN,
      revenue: rev,
      cpa: conv ? spend / conv : null,
      cpl: leadsN ? spend / leadsN : null,
      roas: spend ? rev / spend : null,
      ctr: imp ? clicks / imp : null,
    };
  });
  const campaignPerf = campaigns
    .map((c) => {
      const rows = m.filter((r) => r.campaignId === c.id);
      const spend = sum(rows, (r) => r.spend);
      const rev = sum(rows, (r) => r.revenue);
      const conv = sum(rows, (r) => r.conversions);
      return { ...c, clientName: nameOf(c.clientId), spend, roas: spend ? rev / spend : null, cpa: conv ? spend / conv : null };
    })
    .filter((c) => c.spend > 0);
  const byRoas = [...campaignPerf].filter((c) => c.roas !== null).sort((a, b) => b.roas! - a.roas!);
  const openInsights = input.insights.filter((i) => i.status === 'open' && (i.clientId === null || clientIds.has(i.clientId)));
  const marketingTab = {
    byPlatform: platformRows.sort((a, b) => b.spend - a.spend),
    trend: sparkMonths.map((mo, i) => ({
      key: mo.slice(0, 7),
      spend: monthly[i]!.ad_spend?.value ?? 0,
      cpa: monthly[i]!.cpa?.value ?? null,
      roas: monthly[i]!.roas?.value ?? null,
      ctr: monthly[i]!.ctr?.value ?? null,
    })),
    best: byRoas.slice(0, 5),
    worst: byRoas.slice(-5).reverse(),
    pacing: campaigns
      .filter((c) => c.status === 'active')
      .map((c) => ({ ...c, clientName: nameOf(c.clientId) }))
      .sort((a, b) => b.spentMinor / Math.max(1, b.budgetMinor) - a.spentMinor / Math.max(1, a.budgetMinor)),
    atRisk: campaigns
      .filter((c) => c.status === 'active' && (c.health === 'at_risk' || c.health === 'off_track'))
      .map((c) => ({ ...c, clientName: nameOf(c.clientId) })),
    insights: {
      open: openInsights.length,
      high: openInsights.filter((i) => i.severity === 'high').length,
      medium: openInsights.filter((i) => i.severity === 'medium').length,
      low: openInsights.filter((i) => i.severity === 'low').length,
    },
  };

  const s = input.sales;
  const forecastMonths = crmMonthKeys(today, 6);
  const salesTab = {
    leadsBySource: leadsBySource(s.leads, range.from, range.to),
    leadTrend: sparkMonths.map((mo, i) => ({ key: mo.slice(0, 7), value: monthly[i]!.leads_new?.value ?? 0 })),
    funnel: stageConversion(s.deals, s.stages, s.moves).map((r) => ({
      ...r,
      name: s.stages.find((x) => x.id === r.stageId)?.name ?? { ar: '' },
    })),
    pipelineByStage: pipelineByStage(
      s.deals.filter((d) => d.status === 'open'),
      s.stages,
    )
      .filter((r) => r.kind === 'open')
      .map((r) => ({ ...r, name: s.stages.find((x) => x.id === r.stageId)?.name ?? { ar: '' } })),
    byOwner: performanceByOwner(s.deals, range.from, range.to).map((r) => ({
      ...r,
      name: r.ownerId ? (s.people.get(r.ownerId) ?? '') : '',
    })),
    forecast: forecastByMonth(s.deals, forecastMonths, s.targets),
    lostReasons: [
      ...new Set(s.deals.filter((d) => d.status === 'lost' && inRange(d.lostAt, range.from, range.to)).map((d) => d.lostReason ?? 'other')),
    ]
      .map((reason) => ({
        reason,
        count: s.deals.filter((d) => d.status === 'lost' && inRange(d.lostAt, range.from, range.to) && (d.lostReason ?? 'other') === reason)
          .length,
      }))
      .sort((a, b) => b.count - a.count),
  };

  // --- Risks and attention ---------------------------------------------------------------------------------------
  function buildRisks(): RiskItem[] {
    const out: RiskItem[] = [];
    for (const c of health.filter((x) => x.health === 'at_risk')) {
      const client = input.clients.find((x) => x.id === c.id);
      out.push({
        id: `client:${c.id}`,
        category: 'client',
        severity: c.score < 35 ? 'high' : 'medium',
        reason: 'clientAtRisk',
        params: { client: JSON.stringify(client?.name ?? {}), score: c.score },
        ownerId: client?.accountManagerId ?? null,
        href: `/clients/${c.id}`,
        impact: 100 - c.score,
      });
    }
    if (input.ops.unacknowledgedBreaches > 0 || input.ops.slaOverdue > 0) {
      out.push({
        id: 'delivery:sla',
        category: 'delivery',
        severity: input.ops.unacknowledgedBreaches > 2 ? 'high' : 'medium',
        reason: 'slaBreaches',
        params: { breaches: input.ops.unacknowledgedBreaches, overdue: input.ops.slaOverdue },
        ownerId: null,
        href: '/sla',
        impact: 20 * input.ops.unacknowledgedBreaches + 10 * input.ops.slaOverdue,
      });
    }
    const overdueDeliverables = deliverables.filter(
      (d) => d.dueDate && d.dueDate < today && d.status !== 'approved' && d.status !== 'delivered',
    ).length;
    if (overdueDeliverables > 0) {
      out.push({
        id: 'delivery:deliverables',
        category: 'delivery',
        severity: overdueDeliverables > 5 ? 'high' : 'medium',
        reason: 'overdueDeliverables',
        params: { count: overdueDeliverables },
        ownerId: null,
        href: '/deliverables',
        impact: 8 * overdueDeliverables,
      });
    }
    for (const r of input.capacity.rows) {
      const over = r.cells.slice(0, 4).filter((c) => c.level === 'over');
      if (!over.length) continue;
      const dept = input.departments.find((d) => d.id === r.departmentId);
      out.push({
        id: `capacity:${r.departmentId}`,
        category: 'capacity',
        severity: over.length >= 2 ? 'high' : 'medium',
        reason: 'departmentOver',
        params: { department: JSON.stringify(dept?.name ?? {}), weeks: over.length },
        ownerId: null,
        href: '/capacity',
        impact: 15 * over.length,
      });
    }
    const top = revenueByClient[0];
    if (top && totalRevenueAll() > 0 && top.value / totalRevenueAll() > CONCENTRATION_LIMIT) {
      out.push({
        id: `financial:${top.id}`,
        category: 'financial',
        severity: top.value / totalRevenueAll() > 0.5 ? 'high' : 'medium',
        reason: 'concentration',
        params: { client: JSON.stringify(nameOf(top.id)), share: Math.round((top.value / totalRevenueAll()) * 100) },
        ownerId: null,
        href: `/clients/${top.id}`,
        impact: Math.round((top.value / totalRevenueAll()) * 100),
      });
    }
    for (const c of input.integrations) {
      const days = c.tokenExpiresAt ? daysBetween(`${today}T12:00:00Z`, c.tokenExpiresAt) : null;
      const expired = c.status === 'expired' || (days !== null && days < 0);
      if (!expired && (days === null || days > TOKEN_EXPIRY_DAYS)) continue;
      out.push({
        id: `integration:${c.id}`,
        category: 'integration',
        severity: expired ? 'high' : 'low',
        reason: expired ? 'tokenExpired' : 'tokenExpiring',
        params: { name: c.name, provider: c.provider, days: days === null ? 0 : Math.max(0, Math.ceil(days)) },
        ownerId: c.ownerId,
        href: '/admin/integrations',
        impact: expired ? 30 : 10,
      });
    }
    if (input.ai.budget && input.ai.used / input.ai.budget >= AI_BUDGET_WARN) {
      const share = input.ai.used / input.ai.budget;
      out.push({
        id: 'ai:budget',
        category: 'ai',
        severity: share >= 1 ? 'high' : 'low',
        reason: 'aiBudget',
        params: { share: Math.round(share * 100) },
        ownerId: null,
        href: '/admin/ai',
        impact: Math.round(share * 20),
      });
    }
    return out.sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.impact - a.impact);
  }
  function totalRevenueAll() {
    return sum(revenueByClient, (r) => r.value);
  }

  const staleCutoff = addDays(today, -s.staleDays);
  const stuckDeals = s.deals.filter((d) => d.status === 'open' && d.lastActivityAt.slice(0, 10) < staleCutoff);
  const attention = [
    ...risks.map((r) => ({ kind: 'risk' as const, ...r })),
    ...marketingTab.atRisk.map((c) => ({
      kind: 'campaign' as const,
      id: `campaign:${c.id}`,
      severity: (c.health === 'off_track' ? 'high' : 'medium') as RiskItem['severity'],
      reason: 'campaignOffPace',
      params: { name: c.name, health: c.health },
      ownerId: null,
      href: `/campaigns/${c.id}`,
      impact: c.health === 'off_track' ? 25 : 12,
    })),
    ...stuckDeals.map((d) => ({
      kind: 'deal' as const,
      id: `deal:${d.id}`,
      severity: (d.valueMinor >= 5_000_000 ? 'medium' : 'low') as RiskItem['severity'],
      reason: 'dealStuck',
      params: { title: d.title, days: Math.floor(daysBetween(d.lastActivityAt, `${today}T12:00:00Z`)), value: d.valueMinor },
      ownerId: d.ownerId,
      href: `/crm/deals/${d.id}`,
      impact: Math.min(30, Math.round(d.valueMinor / 1_000_000)),
    })),
    ...clientsTab.packageUsage
      .filter((u) => u.ratio > 1)
      .map((u) => ({
        kind: 'package' as const,
        id: `package:${u.clientId}`,
        severity: (u.ratio > 1.25 ? 'medium' : 'low') as RiskItem['severity'],
        reason: 'packageOver',
        params: { client: JSON.stringify(u.name), pct: Math.round(u.ratio * 100) },
        ownerId: input.clients.find((c) => c.id === u.clientId)?.accountManagerId ?? null,
        href: `/clients/${u.clientId}?tab=package`,
        impact: Math.round((u.ratio - 1) * 50),
      })),
  ].sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.impact - a.impact);

  const risksTab = {
    items: risks,
    trend: sparkMonths.map((mo) => {
      const d = monthEnd(mo);
      const rows = input.snapshots.filter((x) => x.metric === 'open_risks' && x.day <= d);
      const last = rows.length ? rows.reduce((a, b) => (a.day > b.day ? a : b)) : null;
      return {
        key: mo.slice(0, 7),
        high: last?.details.high ?? null,
        medium: last?.details.medium ?? null,
        low: last?.details.low ?? null,
      };
    }),
  };

  return {
    today,
    period,
    comparison,
    config,
    months: sparkMonths.map((mo) => mo.slice(0, 7)),
    names: input.names,
    /** What the filters offer (always the whole agency, whatever is selected). */
    options: {
      clients: input.clients.filter((c) => c.status !== 'archived').map((c) => ({ id: c.id, name: c.name })),
      departments: input.departments.map((d) => ({ id: d.id, name: d.name })),
      accountManagers: [...new Set(input.clients.map((c) => c.accountManagerId).filter((x): x is string => Boolean(x)))]
        .map((id) => ({ id, name: input.names[id] ?? '' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      platforms: [...new Set(input.metrics.map((x) => x.platform))].sort(),
    },
    kpis: kpiValues,
    attention,
    clients: clientsTab,
    operations: operationsTab,
    team: teamTab,
    marketing: marketingTab,
    sales: salesTab,
    risks: risksTab,
    /** The values the daily snapshot job stores (state metrics with their breakdowns). */
    snapshot: {
      avg_health: { value: kpiValues.avg_health.value, details: clientsTab.healthDistribution },
      backlog_open: { value: kpiValues.backlog_open.value, details: {} },
      backlog_aged: { value: kpiValues.backlog_aged.value, details: {} },
      pipeline_value: { value: kpiValues.pipeline_value.value, details: {} },
      weighted_forecast: { value: kpiValues.weighted_forecast.value, details: {} },
      active_clients: { value: kpiValues.active_clients.value, details: {} },
      overloaded_departments: { value: kpiValues.overloaded_departments.value, details: {} },
      campaigns_at_risk: { value: kpiValues.campaigns_at_risk.value, details: {} },
      top5_share: { value: kpiValues.top5_share.value, details: {} },
      clv: { value: kpiValues.clv.value, details: {} },
      open_risks: {
        value: risks.length,
        details: {
          high: risks.filter((r) => r.severity === 'high').length,
          medium: risks.filter((r) => r.severity === 'medium').length,
          low: risks.filter((r) => r.severity === 'low').length,
        },
      },
    } as Record<string, { value: number | null; details: Record<string, number> }>,
  };
}
