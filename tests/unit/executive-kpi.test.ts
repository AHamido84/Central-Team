/**
 * FR7 (ADR-096): the Executive Center's statistics — periods and comparisons, rates and small samples, deltas and
 * tones, percentiles, moving averages, concentration, targets and projections — plus the URL view, schedule dates and
 * the report built from a small fixture (filters, revenue recognition, churn, compliance, utilization, risks).
 */
import { describe, expect, it } from 'vitest';

import { briefLines, resolveBriefCitations } from '@/modules/executive/brief';
import { boardModel } from '@/modules/executive/board';
import { buildExecutiveReport, type ExecutiveInputs } from '@/modules/executive/compute';
import { defaultViewConfig, parseViewConfig, viewSearch } from '@/modules/executive/config';
import { executiveKit } from '@/modules/executive/kit';
import {
  addMonths,
  comparisonPeriod,
  dayCount,
  delta,
  deltaTone,
  isSmallSample,
  mean,
  median,
  monthsIn,
  movingAverage,
  overlapDays,
  p90,
  percentile,
  projectToEnd,
  rate,
  resolvePeriod,
  targetFor,
  targetProgress,
  topShare,
} from '@/modules/executive/kpi';
import { nextRunOn, schedulePreset } from '@/modules/executive/schedule-dates';
import { formatDelta, formatKpi, riskText } from '@/modules/executive/text';

describe('periods', () => {
  const today = '2026-10-12';

  it('resolves every preset on a given day', () => {
    expect(resolvePeriod('this_month', today)).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
      incomplete: true,
      elapsedDays: 12,
      totalDays: 31,
    });
    expect(resolvePeriod('last_month', today)).toMatchObject({ from: '2026-09-01', to: '2026-09-30', incomplete: false, elapsedDays: 30 });
    expect(resolvePeriod('qtd', today)).toMatchObject({ from: '2026-10-01', to: '2026-12-31', incomplete: true, elapsedDays: 12 });
    expect(resolvePeriod('ytd', today)).toMatchObject({ from: '2026-01-01', to: '2026-12-31', incomplete: true, elapsedDays: 285 });
    expect(resolvePeriod('last_12m', today)).toMatchObject({ from: '2025-10-13', to: '2026-10-12', incomplete: false, totalDays: 365 });
  });

  it('falls back to the last 30 days for an invalid custom range', () => {
    expect(resolvePeriod('custom', today, { from: '2026-09-01', to: '2026-09-15' })).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-15',
      totalDays: 15,
    });
    expect(resolvePeriod('custom', today, { from: '2026-10-20', to: '2026-10-01' })).toMatchObject({ from: '2026-09-13', to: today });
    expect(resolvePeriod('custom', today, { from: null, to: '2026-10-01' })).toMatchObject({ from: '2026-09-13', to: today });
    expect(resolvePeriod('custom', today)).toMatchObject({ from: '2026-09-13', to: today });
  });

  it('compares equal lengths: only the elapsed part of an incomplete period', () => {
    const p = resolvePeriod('this_month', today);
    expect(comparisonPeriod(p, 'previous', today)).toMatchObject({ from: '2026-09-19', to: '2026-09-30', totalDays: 12 });
    expect(comparisonPeriod(p, 'last_year', today)).toMatchObject({ from: '2025-10-01', to: '2025-10-12', totalDays: 12 });
    expect(comparisonPeriod(p, 'none', today)).toBeNull();
    const full = resolvePeriod('last_month', today);
    expect(comparisonPeriod(full, 'previous', today)).toMatchObject({ from: '2026-08-02', to: '2026-08-31', totalDays: 30 });
  });

  it('handles month ends and leap years in date arithmetic', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(dayCount('2026-10-01', '2026-10-01')).toBe(1);
    expect(dayCount('2026-10-02', '2026-10-01')).toBe(0);
    expect(overlapDays('2026-01-01', '2026-01-31', '2026-01-20', '2026-02-10')).toBe(12);
    expect(overlapDays('2026-01-01', '2026-01-31', '2026-02-01', '2026-02-10')).toBe(0);
    expect(monthsIn('2025-11-15', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('values', () => {
  it('keeps the parts of a rate and returns null without a denominator', () => {
    expect(rate(3, 4)).toEqual({ value: 0.75, num: 3, den: 4 });
    expect(rate(0, 0)).toEqual({ value: null, num: 0, den: 0 });
  });

  it('flags samples under five (but not an empty one)', () => {
    expect(isSmallSample(0)).toBe(false);
    expect(isSmallSample(4)).toBe(true);
    expect(isSmallSample(5)).toBe(false);
  });

  it('has no percentage change from zero and knows which way is good', () => {
    expect(delta(12, 10)).toEqual({ abs: 2, pct: 0.2 });
    expect(delta(5, 0)).toEqual({ abs: 5, pct: null });
    expect(delta(null, 3)).toBeNull();
    expect(delta(-2, -4)).toEqual({ abs: 2, pct: 0.5 });
    expect(deltaTone(delta(12, 10), 'up')).toBe('good');
    expect(deltaTone(delta(12, 10), 'down')).toBe('bad');
    expect(deltaTone(delta(10, 10), 'up')).toBe('flat');
    expect(deltaTone(delta(12, 10), 'neutral')).toBe('flat');
  });

  it('projects a flow metric to the end of an incomplete period only', () => {
    const p = resolvePeriod('this_month', '2026-10-12');
    expect(projectToEnd(120, p)).toBeCloseTo((120 / 12) * 31);
    expect(projectToEnd(120, resolvePeriod('last_month', '2026-10-12'))).toBeNull();
  });
});

describe('distributions', () => {
  it('computes percentiles like a spreadsheet (PERCENTILE.INC)', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBeCloseTo(9.1);
    expect(median([])).toBeNull();
    expect(p90([7])).toBe(7);
  });

  it('averages, smooths and measures concentration', () => {
    expect(mean([])).toBeNull();
    expect(mean([2, 4])).toBe(3);
    expect(movingAverage([3, 6, 9, 12], 3)).toEqual([3, 4.5, 6, 9]);
    expect(movingAverage([1, 2], 0)).toEqual([1, 2]);
    expect(topShare([50, 30, 10, 5, 3, 2], 5)).toBeCloseTo(0.98);
    expect(topShare([], 5)).toBeNull();
    expect(topShare([0, 0], 5)).toBeNull();
  });
});

describe('targets', () => {
  const rows = [
    { metric: 'revenue', year: 2026, quarter: null, value: 1_200_000 },
    { metric: 'revenue', year: 2026, quarter: 4, value: 400_000 },
    { metric: 'on_time_rate', year: 2026, quarter: null, value: 0.85 },
    { metric: 'on_time_rate', year: 2026, quarter: 4, value: 0.9 },
  ];

  it('takes the quarter for a rate, else the year', () => {
    expect(targetFor('on_time_rate', 'rate', { from: '2026-10-01', to: '2026-10-31' }, rows)).toBe(0.9);
    expect(targetFor('on_time_rate', 'rate', { from: '2026-04-01', to: '2026-04-30' }, rows)).toBe(0.85);
    expect(targetFor('win_rate', 'rate', { from: '2026-04-01', to: '2026-04-30' }, rows)).toBeNull();
  });

  it('pro-rates amounts over the days a period covers', () => {
    // October: 31 of Q4's 92 days of the quarterly 400k.
    expect(targetFor('revenue', 'amount', { from: '2026-10-01', to: '2026-10-31' }, rows)).toBeCloseTo((400_000 * 31) / 92);
    // April (no Q2 target): the yearly target's share of 30 / 365 days.
    expect(targetFor('revenue', 'amount', { from: '2026-04-01', to: '2026-04-30' }, rows)).toBeCloseTo((1_200_000 * 30) / 365);
    expect(targetFor('revenue', 'amount', { from: '2025-04-01', to: '2025-04-30' }, rows)).toBeNull();
  });

  it('inverts progress for lower-is-better KPIs and guards a zero target', () => {
    expect(targetProgress(90, 100)).toBe(0.9);
    expect(targetProgress(5, 4, 'down')).toBe(0.8);
    expect(targetProgress(5, 0)).toBeNull();
    expect(targetProgress(null, 4)).toBeNull();
  });
});

describe('view config in the URL', () => {
  it('round-trips and drops defaults', () => {
    const c = parseViewConfig({ tab: 'sales', period: 'ytd', compare: 'last_year', platform: 'meta' });
    expect(c).toMatchObject({ tab: 'sales', preset: 'ytd', compare: 'last_year', filters: { platform: 'meta', clientId: null } });
    expect(viewSearch(c)).toBe('?tab=sales&period=ytd&compare=last_year&platform=meta');
    expect(viewSearch(defaultViewConfig)).toBe('');
    expect(parseViewConfig(new URLSearchParams(viewSearch(c).slice(1)))).toEqual(c);
  });

  it('ignores anything unknown or malformed', () => {
    const c = parseViewConfig({ tab: 'nope', period: 'forever', client: 'not-a-uuid', platform: 'DROP TABLE', from: '2026-01-01' });
    expect(c).toEqual({
      ...defaultViewConfig,
      from: null,
      to: null,
      filters: { clientId: null, departmentId: null, accountManagerId: null, platform: null },
    });
  });
});

describe('schedule dates', () => {
  it('runs weekly on the next Sunday and monthly on the 1st', () => {
    expect(nextRunOn('weekly', '2026-10-12')).toBe('2026-10-18'); // Monday → Sunday
    expect(nextRunOn('weekly', '2026-10-18')).toBe('2026-10-25'); // Sunday → next Sunday
    expect(nextRunOn('monthly', '2026-10-12')).toBe('2026-11-01');
    expect(nextRunOn('monthly', '2026-12-01')).toBe('2027-01-01');
    expect(schedulePreset('weekly')).toBe('this_month');
    expect(schedulePreset('monthly')).toBe('last_month');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The report from a small fixture
// ---------------------------------------------------------------------------------------------------------------------

const today = '2026-10-12';
const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b2';
const C = '00000000-0000-4000-8000-0000000000c3';
const DEPT = '00000000-0000-4000-8000-0000000000d1';
const AM = '00000000-0000-4000-8000-0000000000e1';

function fixture(overrides: Partial<ExecutiveInputs> = {}): ExecutiveInputs {
  const period = resolvePeriod('last_month', today);
  const config = { ...defaultViewConfig, preset: 'last_month' as const };
  return {
    today,
    period,
    comparison: comparisonPeriod(period, 'previous', today),
    clients: [
      { id: A, name: { ar: 'أ', en: 'Alpha' }, accountManagerId: AM, status: 'active' },
      { id: B, name: { ar: 'ب', en: 'Beta' }, accountManagerId: null, status: 'active' },
      { id: C, name: { ar: 'ج', en: 'Gamma' }, accountManagerId: null, status: 'archived' },
    ],
    packages: [
      // Alpha: all year. Beta: new in September. Gamma: left at the end of August.
      {
        clientId: A,
        packageId: 'p1',
        packageName: { ar: 'نمو', en: 'Growth' },
        priceMinor: 3_650_000,
        periodStart: '2026-01-01',
        periodEnd: '2026-12-31',
      },
      {
        clientId: B,
        packageId: 'p2',
        packageName: { ar: 'بداية', en: 'Starter' },
        priceMinor: 365_000,
        periodStart: '2026-09-01',
        periodEnd: '2026-12-31',
      },
      {
        clientId: C,
        packageId: 'p2',
        packageName: { ar: 'بداية', en: 'Starter' },
        priceMinor: 365_000,
        periodStart: '2026-01-01',
        periodEnd: '2026-08-31',
      },
    ],
    usage: [{ clientId: A, ratio: 1.3, over: 1 }],
    requestTypes: [{ id: 't1', name: { ar: 'تصميم', en: 'Design' } }],
    requests: [
      // On time, answered in time.
      req('r1', A, '2026-09-02T08:00:00Z', '2026-09-02T09:00:00Z', '2026-09-02T12:00:00Z', '2026-09-05', '2026-09-04T10:00:00Z'),
      // Late, answered late.
      req('r2', A, '2026-09-10T08:00:00Z', '2026-09-10T20:00:00Z', '2026-09-10T12:00:00Z', '2026-09-12', '2026-09-15T10:00:00Z'),
      // Beta: on time.
      req('r3', B, '2026-09-20T08:00:00Z', '2026-09-20T10:00:00Z', '2026-09-20T12:00:00Z', '2026-09-25', '2026-09-24T10:00:00Z'),
      // Still open, submitted long ago → aged backlog.
      { ...req('r4', A, '2026-09-01T08:00:00Z', null, '2026-09-01T12:00:00Z', '2026-09-08', null), status: 'in_progress' },
    ],
    deliverables: [],
    clientDecisions: [],
    tasks: [],
    time: [
      { userId: 'u1', clientId: A, day: '2026-09-03', minutes: 600 },
      { userId: 'u1', clientId: B, day: '2026-09-04', minutes: 600 },
    ],
    departments: [{ id: DEPT, name: { ar: 'تصميم', en: 'Design' }, color: '#000' }],
    people: [{ id: 'u1', name: 'Designer', hoursPerWeek: 40, departmentIds: [DEPT] }],
    timeOff: [],
    holidays: [],
    capacity: { weeks: [], rows: [] },
    metrics: [
      {
        date: '2026-09-05',
        campaignId: 'c1',
        clientId: A,
        platform: 'meta',
        spend: 100_000,
        impressions: 10_000,
        clicks: 200,
        conversions: 10,
        leads: 8,
        revenue: 400_000,
      },
      {
        date: '2026-09-06',
        campaignId: 'c1',
        clientId: B,
        platform: 'google',
        spend: 50_000,
        impressions: 5_000,
        clicks: 100,
        conversions: 0,
        leads: 2,
        revenue: 0,
      },
    ],
    campaigns: [],
    insights: [],
    ops: {
      clients: [
        { id: A, score: 40, health: 'at_risk', reasons: ['slaOverdue'] },
        { id: B, score: 90, health: 'healthy', reasons: [] },
      ],
      slaOverdue: 0,
      unacknowledgedBreaches: 0,
      overdueTasks: 0,
      staleApprovals: 0,
    },
    sales: {
      stages: [],
      deals: [
        {
          id: 'd1',
          status: 'won',
          valueMinor: 1_000_000,
          probability: 100,
          ownerId: AM,
          stageId: 's',
          createdAt: '2026-08-20T00:00:00Z',
          wonAt: '2026-09-10T00:00:00Z',
          lostAt: null,
          lostReason: null,
          title: 'Won',
          lastActivityAt: '2026-09-10T00:00:00Z',
          clientId: null,
        },
        {
          id: 'd2',
          status: 'lost',
          valueMinor: 500_000,
          probability: 0,
          ownerId: AM,
          stageId: 's',
          createdAt: '2026-08-20T00:00:00Z',
          wonAt: null,
          lostAt: '2026-09-12T00:00:00Z',
          lostReason: 'price',
          title: 'Lost',
          lastActivityAt: '2026-09-12T00:00:00Z',
          clientId: null,
        },
        {
          id: 'd3',
          status: 'open',
          valueMinor: 2_000_000,
          probability: 50,
          ownerId: AM,
          stageId: 's',
          createdAt: '2026-09-01T00:00:00Z',
          wonAt: null,
          lostAt: null,
          lostReason: null,
          title: 'Open',
          lastActivityAt: '2026-10-11T00:00:00Z',
          clientId: null,
        },
      ] as ExecutiveInputs['sales']['deals'],
      moves: [],
      leads: [],
      targets: new Map(),
      people: new Map(),
      staleDays: 7,
    },
    leads: [
      { createdAt: '2026-09-01T08:00:00Z', firstActivityAt: '2026-09-01T10:00:00Z' },
      { createdAt: '2026-09-02T08:00:00Z', firstActivityAt: '2026-09-02T14:00:00Z' },
      { createdAt: '2026-09-03T08:00:00Z', firstActivityAt: null },
    ],
    integrations: [{ id: 'i1', provider: 'meta', name: 'Meta', status: 'connected', tokenExpiresAt: '2026-10-20T00:00:00Z', ownerId: AM }],
    ai: { budget: 1000, used: 900 },
    targets: [{ metric: 'on_time_rate', year: 2026, quarter: null, value: 0.9 }],
    snapshots: [{ day: '2026-08-31', metric: 'active_clients', value: 2, details: {} }],
    names: { [AM]: 'Account Manager' },
    config,
    ...overrides,
  };
}

function req(
  id: string,
  clientId: string,
  submittedAt: string,
  firstResponseAt: string | null,
  responseDueAt: string,
  dueDate: string,
  deliveredAt: string | null,
) {
  return {
    id,
    clientId,
    typeId: 't1',
    status: 'delivered',
    isExtra: false,
    submittedAt,
    firstResponseAt,
    responseDueAt,
    dueDate,
    deliveredAt,
  };
}

describe('buildExecutiveReport', () => {
  const r = buildExecutiveReport(fixture());

  it('recognizes package revenue per covered day (monthly price × 12 ÷ 365)', () => {
    // September: Alpha 3,650,000 × 12/365 × 30 + Beta 365,000 × 12/365 × 30.
    expect(r.kpis.revenue.value).toBeCloseTo((3_650_000 * 12 * 30) / 365 + (365_000 * 12 * 30) / 365);
  });

  it('counts new and churned clients from package spans, and retention', () => {
    expect(r.kpis.new_clients.value).toBe(1); // Beta
    expect(r.kpis.churned_clients.value).toBe(0); // Gamma left in August
    expect(r.kpis.active_clients.value).toBe(2);
    expect(r.kpis.active_clients.previous).toBe(2); // the month-end snapshot
    const aug = buildExecutiveReport(
      fixture({ period: resolvePeriod('custom', today, { from: '2026-08-01', to: '2026-08-31' }), comparison: null }),
    );
    expect(aug.kpis.churned_clients.value).toBe(1);
    expect(aug.kpis.retention_rate.value).toBe(1);
  });

  it('uses the SLA monitor rules for on-time and SLA compliance, with denominators', () => {
    expect(r.kpis.on_time_rate.parts).toEqual({ num: 2, den: 3 });
    expect(r.kpis.on_time_rate.value).toBeCloseTo(2 / 3);
    // r4 has no reply and its target has passed: it counts as missed.
    expect(r.kpis.sla_compliance.parts).toEqual({ num: 2, den: 4 });
    expect(r.kpis.on_time_rate.small).toBe(true);
    expect(r.kpis.on_time_rate.target).toBe(0.9);
    expect(r.kpis.on_time_rate.progress).toBeCloseTo(2 / 3 / 0.9);
  });

  it('measures turnaround as median / P90 days of delivered requests', () => {
    expect(r.kpis.turnaround_median.value).toBeCloseTo(4.0833, 3);
    expect(r.kpis.turnaround_median.sample).toBe(3);
    expect(r.kpis.backlog_open.value).toBe(1);
    expect(r.kpis.backlog_aged.value).toBe(1);
  });

  it('computes utilization against working-day capacity', () => {
    // 20 h logged; September has 22 Sun–Thu working days → 40 × 22 / 5 = 176 h.
    expect(r.kpis.utilization.parts?.num).toBeCloseTo(20);
    expect(r.kpis.utilization.parts?.den).toBeCloseTo(176);
  });

  it('blends marketing ratios over all platforms', () => {
    expect(r.kpis.ad_spend.value).toBe(150_000);
    expect(r.kpis.cpa.value).toBe(15_000);
    expect(r.kpis.roas.value).toBeCloseTo(400_000 / 150_000);
    expect(r.kpis.ctr.value).toBeCloseTo(300 / 15_000);
    expect(r.marketing.byPlatform.map((p) => p.platform)).toEqual(['meta', 'google']);
    expect(r.marketing.byPlatform[1]!.cpa).toBeNull();
  });

  it('follows the sales dashboard for win rate, bookings and the weighted forecast', () => {
    expect(r.kpis.win_rate.value).toBe(0.5);
    expect(r.kpis.bookings.value).toBe(1_000_000);
    expect(r.kpis.pipeline_value.value).toBe(2_000_000);
    expect(r.kpis.weighted_forecast.value).toBe(1_000_000);
    expect(r.kpis.lead_response.value).toBe(4); // median of 2 h and 6 h
  });

  it('flags concentration, at-risk clients, expiring tokens and the AI budget in the risk register', () => {
    const reasons = r.risks.items.map((x) => x.reason);
    expect(reasons).toEqual(expect.arrayContaining(['clientAtRisk', 'concentration', 'tokenExpiring', 'aiBudget']));
    // Ranked by severity, then impact.
    const rank = { high: 3, medium: 2, low: 1 };
    for (let i = 1; i < r.risks.items.length; i++)
      expect(rank[r.risks.items[i - 1]!.severity]).toBeGreaterThanOrEqual(rank[r.risks.items[i]!.severity]);
    expect(r.attention.some((a) => a.reason === 'packageOver')).toBe(true);
    expect(r.clients.concentrationRisk).toBe(true);
  });

  it('narrows everything client-scoped by the client filter', () => {
    const b = buildExecutiveReport(fixture({ config: { ...defaultViewConfig, preset: 'last_month', filters: { clientId: B } } }));
    expect(b.kpis.requests_delivered.value).toBe(1);
    expect(b.kpis.ad_spend.value).toBe(50_000);
    expect(b.kpis.revenue.value).toBeCloseTo((365_000 * 12 * 30) / 365);
    expect(b.risks.items.some((x) => x.reason === 'clientAtRisk')).toBe(false);
  });

  it('has twelve sparkline points ending with the period', () => {
    expect(r.months).toHaveLength(12);
    expect(r.months.at(-1)).toBe('2026-09');
    expect(r.kpis.revenue.sparkline).toHaveLength(12);
  });

  it('copes with an empty agency', () => {
    const empty = buildExecutiveReport(
      fixture({
        clients: [],
        packages: [],
        requests: [],
        metrics: [],
        time: [],
        people: [],
        ops: { clients: [], slaOverdue: 0, unacknowledgedBreaches: 0, overdueTasks: 0, staleApprovals: 0 },
        integrations: [],
        ai: { budget: null, used: 0 },
      }),
    );
    expect(empty.kpis.revenue.value).toBe(0);
    expect(empty.kpis.on_time_rate.value).toBeNull();
    expect(empty.kpis.cpa.value).toBeNull();
    expect(empty.kpis.top5_share.value).toBeNull();
    expect(empty.risks.items).toEqual([]);
  });
});

describe('text, brief and board model', () => {
  const report = buildExecutiveReport(fixture());

  it('formats values and changes the same way in both languages', () => {
    const en = executiveKit('en');
    const ar = executiveKit('ar');
    const plain = (s: string) => s.replace(/\s/g, ' ');
    expect(formatKpi(en, 'on_time_rate', 0.5)).toBe('50%');
    expect(plain(formatKpi(en, 'revenue', 12_345_600))).toBe('SAR 123,456');
    expect(plain(formatKpi(en, 'revenue', 250_000_000, { compact: true }))).toBe('SAR 2.5M');
    expect(formatKpi(en, 'roas', 2.456)).toBe('2.46×');
    expect(formatKpi(en, 'cpa', null)).toBe('—');
    expect(formatDelta(en, 'on_time_rate', { abs: 0.05, pct: 0.1 })).toBe('Up 5 pts');
    expect(formatDelta(en, 'revenue', { abs: -10, pct: -0.25 })).toBe('Down 25%');
    // Arabic keeps Latin digits.
    expect(formatKpi(ar, 'active_clients', 12)).toBe('12');
  });

  it('writes risk lines with localized names', () => {
    const en = executiveKit('en');
    const item = report.risks.items.find((x) => x.reason === 'clientAtRisk')!;
    expect(riskText(en, item)).toBe('Alpha: client health 40/100');
    expect(riskText(executiveKit('ar'), item)).toBe('أ: صحة العميل 40/100');
  });

  it('numbers the brief and keeps only citations that exist', () => {
    const lines = briefLines(executiveKit('en'), report);
    expect(lines.map((l) => l.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const { text, citations } = resolveBriefCitations('Revenue grew [1]. Delivery slipped [3][9]. Risks [7, 3].', lines);
    expect(text).toBe('Revenue grew [1]. Delivery slipped [2]. Risks [3][2].');
    expect(citations.map((c) => c.kpi)).toEqual(['revenue', 'on_time_rate', 'open_risks']);
  });

  it('builds one board model for every format, right-to-left in Arabic', () => {
    const m = boardModel(executiveKit('ar'), report, { organization: 'أفق', generatedAt: new Date('2026-10-12T08:00:00Z') });
    expect(m.dir).toBe('rtl');
    expect(m.slides.map((s) => s.tab)).toEqual(['overview', 'clients', 'operations', 'team', 'marketing', 'sales', 'risks']);
    expect(m.slides[0]!.kpis.length).toBeGreaterThan(10);
    const clients = m.slides.find((s) => s.tab === 'clients')!;
    expect(clients.tables[0]!.raw?.[0]?.[0]).toBe('أ');
  });
});
