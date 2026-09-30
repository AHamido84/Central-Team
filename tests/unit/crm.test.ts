import { describe, expect, it } from 'vitest';

import {
  addDaysIso,
  capacityGrid,
  dealDays,
  effortHours,
  levelOf,
  memberLoad,
  memberWeekCapacity,
  packageDays,
  taskDays,
  weeksFrom,
  workingDays,
} from '@/modules/capacity/calc';
import {
  findDuplicates,
  leadScore,
  mergeLeads,
  normalizeEmail,
  normalizePhone,
  pickAssignee,
  type MergeableLead,
} from '@/modules/crm/leads';
import {
  averageCycleDays,
  forecastByMonth,
  leadsBySource,
  monthKeys,
  performanceByOwner,
  pipelineByStage,
  stageConversion,
  weightedValue,
  winRate,
  type MetricDeal,
} from '@/modules/crm/metrics';
import { lineTotal, quoteTotals } from '@/modules/crm/quotes';

describe('contact normalisation', () => {
  it('accepts Saudi mobiles in every common form, Arabic digits included', () => {
    for (const v of [
      '0501234567',
      '501234567',
      '+966501234567',
      '966501234567',
      '00966501234567',
      '050 123 4567',
      '٠٥٠١٢٣٤٥٦٧',
      '(050) 123-4567',
    ])
      expect(normalizePhone(v)).toBe('+966501234567');
  });

  it('accepts Saudi landlines and foreign E.164, rejects the rest', () => {
    expect(normalizePhone('0112345678')).toBe('+966112345678');
    expect(normalizePhone('+971501234567')).toBe('+971501234567');
    expect(normalizePhone('+96650123')).toBeNull();
    expect(normalizePhone('+966901234567')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('lower-cases and validates emails', () => {
    expect(normalizeEmail('  Sara@Example.SA ')).toBe('sara@example.sa');
    expect(normalizeEmail('nope')).toBeNull();
  });
});

describe('duplicates and merge', () => {
  const pool = [
    { id: 'a', phone: '+966501234567', email: null, status: 'new' as const },
    { id: 'b', phone: null, email: 'ali@x.sa', status: 'converted' as const },
    { id: 'c', phone: '+966501234567', email: null, status: 'merged' as const },
  ];

  it('matches on phone or email and ignores merged leads and itself', () => {
    expect(findDuplicates({ phone: '+966501234567', email: null }, pool).map((d) => d.id)).toEqual(['a']);
    expect(findDuplicates({ phone: null, email: 'ALI@x.sa' }, pool).map((d) => d.id)).toEqual(['b']);
    expect(findDuplicates({ id: 'a', phone: '+966501234567', email: null }, pool)).toEqual([]);
  });

  it('keeps the primary values, fills gaps, unites services and tags, keeps the furthest status', () => {
    const base: MergeableLead = {
      id: 'p',
      fullName: 'سارة',
      company: null,
      phone: '+966501234567',
      email: null,
      source: 'instagram',
      sourceDetail: null,
      services: ['ads'],
      budgetRange: 'unknown',
      city: 'riyadh',
      ownerId: null,
      status: 'new',
      tags: ['vip'],
      notes: 'أولى',
    };
    const other: MergeableLead = {
      ...base,
      id: 'o',
      company: 'مطاعم',
      phone: '+966509999999',
      email: 's@x.sa',
      services: ['ads', 'video'],
      budgetRange: '15k_50k',
      ownerId: 'u1',
      status: 'qualified',
      tags: ['event'],
      notes: 'ثانية',
    };
    const m = mergeLeads(base, other);
    expect(m.phone).toBe('+966501234567');
    expect(m.company).toBe('مطاعم');
    expect(m.email).toBe('s@x.sa');
    expect(m.services).toEqual(['ads', 'video']);
    expect(m.tags).toEqual(['vip', 'event']);
    expect(m.budgetRange).toBe('15k_50k');
    expect(m.ownerId).toBe('u1');
    expect(m.status).toBe('qualified');
    expect(m.notes).toBe('أولى\n\nثانية');
    expect(m.score).toBe(leadScore(m));
  });
});

describe('scoring', () => {
  it('rewards budget, source, reachability, company, services and city — capped at 100', () => {
    const bare = {
      phone: null,
      email: 'a@b.sa',
      company: null,
      source: 'other' as const,
      services: [],
      budgetRange: 'unknown' as const,
      city: null,
    };
    expect(leadScore(bare)).toBe(9);
    const strong = {
      ...bare,
      phone: '+966501234567',
      company: 'X',
      source: 'referral' as const,
      services: ['ads', 'video', 'web', 'seo'],
      budgetRange: '50k_plus' as const,
      city: 'riyadh',
    };
    expect(leadScore(strong)).toBe(100);
  });
});

describe('assignment rules', () => {
  const rules = [
    {
      id: 'video',
      isActive: true,
      sortOrder: 1,
      matchServices: ['video'],
      matchCities: [],
      matchSources: [],
      memberIds: ['v1', 'v2'],
      cursor: 0,
    },
    {
      id: 'jeddah',
      isActive: true,
      sortOrder: 2,
      matchServices: [],
      matchCities: ['jeddah'],
      matchSources: [],
      memberIds: ['j1'],
      cursor: 0,
    },
    {
      id: 'all',
      isActive: true,
      sortOrder: 3,
      matchServices: [],
      matchCities: [],
      matchSources: [],
      memberIds: ['a1', 'a2', 'a3'],
      cursor: 2,
    },
    { id: 'off', isActive: false, sortOrder: 0, matchServices: [], matchCities: [], matchSources: [], memberIds: ['x'], cursor: 0 },
  ];
  const eligible = new Set(['v1', 'v2', 'j1', 'a1', 'a2', 'a3', 'x']);

  it('uses the first matching active rule and rotates its members', () => {
    expect(pickAssignee(rules, { services: ['video'], city: 'riyadh', source: 'manual' }, eligible)).toEqual({
      ruleId: 'video',
      ownerId: 'v1',
      nextCursor: 1,
    });
    expect(pickAssignee(rules, { services: ['ads'], city: 'jeddah', source: 'manual' }, eligible)?.ruleId).toBe('jeddah');
    expect(pickAssignee(rules, { services: [], city: null, source: 'website_form' }, eligible)).toEqual({
      ruleId: 'all',
      ownerId: 'a3',
      nextCursor: 0,
    });
  });

  it('skips members who are no longer eligible and rules with nobody left', () => {
    expect(pickAssignee(rules, { services: ['video'], city: null, source: 'x' }, new Set(['v2', 'a1']))?.ownerId).toBe('v2');
    expect(pickAssignee(rules, { services: ['video'], city: null, source: 'x' }, new Set(['a1']))?.ruleId).toBe('all');
    expect(pickAssignee([], { services: [], city: null, source: 'x' }, eligible)).toBeNull();
  });
});

describe('sales metrics', () => {
  const stages = [
    { id: 's1', kind: 'open' as const, sortOrder: 1 },
    { id: 's2', kind: 'open' as const, sortOrder: 2 },
    { id: 's3', kind: 'open' as const, sortOrder: 3 },
    { id: 'won', kind: 'won' as const, sortOrder: 4 },
    { id: 'lost', kind: 'lost' as const, sortOrder: 5 },
  ];
  const d = (over: Partial<MetricDeal>): MetricDeal => ({
    id: 'x',
    stageId: 's1',
    status: 'open',
    valueMinor: 1_000_000,
    probability: 10,
    expectedCloseDate: null,
    ownerId: 'u1',
    source: 'referral',
    createdAt: '2026-09-01T09:00:00Z',
    wonAt: null,
    lostAt: null,
    ...over,
  });
  const deals = [
    d({ id: 'a', stageId: 's1', probability: 10, expectedCloseDate: '2026-10-20' }),
    d({ id: 'b', stageId: 's2', probability: 40, expectedCloseDate: '2026-09-15' }),
    d({ id: 'c', stageId: 's3', probability: 60, expectedCloseDate: '2026-11-05', ownerId: 'u2' }),
    d({ id: 'w', stageId: 'won', status: 'won', probability: 100, wonAt: '2026-09-11T09:00:00Z', valueMinor: 2_000_000 }),
    d({ id: 'l', stageId: 'lost', status: 'lost', probability: 0, lostAt: '2026-09-20T09:00:00Z', ownerId: 'u2' }),
  ];

  it('weights open deals by probability and totals per stage', () => {
    expect(weightedValue({ valueMinor: 1_000_000, probability: 40 })).toBe(400_000);
    const byStage = pipelineByStage(deals, stages);
    expect(byStage.find((s) => s.stageId === 's2')).toMatchObject({ count: 1, value: 1_000_000, weighted: 400_000 });
    expect(byStage.find((s) => s.stageId === 'won')).toMatchObject({ weighted: 2_000_000 });
    expect(byStage.find((s) => s.stageId === 'lost')).toMatchObject({ weighted: 0 });
  });

  it('computes win rate and cycle length in a window', () => {
    expect(winRate(deals, '2026-09-01', '2026-09-30')).toBe(0.5);
    expect(winRate(deals, '2026-10-01', '2026-10-31')).toBeNull();
    expect(averageCycleDays(deals, '2026-09-01', '2026-09-30')).toBe(10);
  });

  it('computes stage-to-stage conversion from history (won deals reached every stage)', () => {
    const moves = [
      { dealId: 'l', toStageId: 's2' },
      { dealId: 'l', toStageId: 'lost' },
    ];
    const conv = stageConversion(deals, stages, moves);
    // reached: s1 = all 5; s2 = b, c, won, lost(l reached s2) = 4; s3 = c, won = 2; won = 1.
    expect(conv.map((c) => [c.reached, c.advanced])).toEqual([
      [5, 4],
      [4, 2],
      [2, 1],
    ]);
    expect(conv[0]!.rate).toBe(0.8);
    expect(conv[2]!.toWon).toBe(true);
  });

  it('forecasts won + weighted per month against targets, overdue closes in the first month', () => {
    const months = monthKeys('2026-09-29', 3);
    expect(months).toEqual(['2026-09', '2026-10', '2026-11']);
    const f = forecastByMonth(deals, months, new Map([['2026-09', 3_000_000]]));
    expect(f[0]).toEqual({ month: '2026-09', won: 2_000_000, weighted: 400_000, forecast: 2_400_000, target: 3_000_000 });
    expect(f[1]).toMatchObject({ weighted: 100_000, target: null });
    expect(f[2]).toMatchObject({ weighted: 600_000 });
  });

  it('groups leads by source and deals by owner', () => {
    const leads = [
      { source: 'instagram', status: 'new', createdAt: '2026-09-02T00:00:00Z' },
      { source: 'instagram', status: 'converted', createdAt: '2026-09-03T00:00:00Z' },
      { source: 'referral', status: 'merged', createdAt: '2026-09-03T00:00:00Z' },
      { source: 'referral', status: 'new', createdAt: '2026-08-03T00:00:00Z' },
    ];
    expect(leadsBySource(leads, '2026-09-01', '2026-09-30')).toEqual([{ source: 'instagram', leads: 2, converted: 1 }]);
    const perf = performanceByOwner(deals, '2026-09-01', '2026-09-30');
    expect(perf[0]).toMatchObject({ ownerId: 'u1', wonCount: 1, wonValue: 2_000_000, openCount: 2, winRate: 1 });
    expect(perf[1]).toMatchObject({ ownerId: 'u2', lostCount: 1, winRate: 0, weighted: 600_000 });
  });
});

describe('quotes', () => {
  it('rounds line totals and never goes below zero', () => {
    expect(lineTotal({ quantity: 1.5, unitPriceMinor: 333 })).toBe(500);
    expect(
      quoteTotals(
        [
          { quantity: 2, unitPriceMinor: 150_000 },
          { quantity: 1, unitPriceMinor: 50_000 },
        ],
        20_000,
      ),
    ).toEqual({
      subtotal: 350_000,
      discount: 20_000,
      total: 330_000,
    });
    expect(quoteTotals([{ quantity: 1, unitPriceMinor: 100 }], 500).total).toBe(0);
  });
});

describe('capacity', () => {
  const cal = { holidays: new Set(['2026-10-15']) };
  const today = '2026-10-04'; // Sunday
  const weeks = weeksFrom(today, 4);

  it('builds Sunday–Saturday weeks and counts working days without Fri/Sat and holidays', () => {
    expect(weeks[0]).toEqual({ start: '2026-10-04', end: '2026-10-10' });
    expect(weeksFrom('2026-10-07', 1)[0]!.start).toBe('2026-10-04');
    expect(workingDays('2026-10-11', '2026-10-17', cal)).toEqual(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
  });

  it('reduces member capacity for holidays and time off', () => {
    const m = { id: 'u', hoursPerWeek: 40, departmentIds: ['d'] };
    expect(memberWeekCapacity(m, weeks[0]!, cal, [])).toBe(40);
    expect(memberWeekCapacity(m, weeks[1]!, cal, [])).toBe(32);
    expect(memberWeekCapacity(m, weeks[0]!, cal, [{ userId: 'u', startDate: '2026-10-05', endDate: '2026-10-06' }])).toBe(24);
    expect(memberWeekCapacity(m, weeks[0]!, cal, [{ userId: 'other', startDate: '2026-10-05', endDate: '2026-10-06' }])).toBe(40);
  });

  it('spreads task estimates over their window, overdue work into this week', () => {
    const spread = taskDays(
      { id: 't', departmentId: 'd', estimateMinutes: 600, startDate: '2026-10-05', dueDate: '2026-10-08', assigneeIds: [] },
      today,
      cal,
    );
    expect([...spread.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(10);
    expect(spread.size).toBe(4);
    const noStart = taskDays(
      { id: 't', departmentId: 'd', estimateMinutes: 300, startDate: null, dueDate: '2026-10-14', assigneeIds: [] },
      today,
      cal,
    );
    expect(spread.has('2026-10-09')).toBe(false); // Friday skipped
    expect([...noStart.keys()]).toEqual(['2026-10-08', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
    const overdue = taskDays(
      { id: 't', departmentId: 'd', estimateMinutes: 120, startDate: null, dueDate: '2026-09-20', assigneeIds: [] },
      today,
      cal,
    );
    expect([...overdue.entries()]).toEqual([['2026-10-04', 2]]);
    expect(
      taskDays({ id: 't', departmentId: 'd', estimateMinutes: null, startDate: null, dueDate: '2026-10-08', assigneeIds: [] }, today, cal)
        .size,
    ).toBe(0);
  });

  it('turns package items into department hours: remaining this period, full quantity after', () => {
    const efforts = [
      { itemType: 'post', departmentId: 'design', hours: 2 },
      { itemType: 'post', departmentId: 'content', hours: 1 },
      { itemType: 'reel', departmentId: 'video', hours: 4 },
    ];
    expect(effortHours([{ itemType: 'post', quantity: 3 }], efforts)).toEqual(
      new Map([
        ['design', 6],
        ['content', 3],
      ]),
    );
    const pkg = {
      clientId: 'c',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      items: [{ itemType: 'post', quantity: 10, used: 4 }],
      renews: false,
    };
    const days = packageDays(pkg, efforts, today, '2026-10-31', cal);
    const design = [...days.get('design')!.values()].reduce((a, b) => a + b, 0);
    expect(design).toBeCloseTo(12); // 6 posts left × 2h
    const renewing = packageDays({ ...pkg, renews: true }, efforts, today, addDaysIso('2026-10-31', 31), cal);
    expect([...renewing.get('design')!.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(12 + 20);
  });

  it('weights pipeline deals by probability from their expected close', () => {
    const efforts = [{ itemType: 'reel', departmentId: 'video', hours: 4 }];
    const d = dealDays(
      { id: 'd', probability: 50, expectedCloseDate: '2026-10-11', items: [{ itemType: 'reel', quantity: 5 }] },
      efforts,
      today,
      addDaysIso('2026-10-11', 29),
      cal,
    );
    const hours = [...d.get('video')!.values()].reduce((a, b) => a + b, 0);
    expect(hours).toBeCloseTo(10);
    expect([...d.get('video')!.keys()].every((k) => k >= '2026-10-11')).toBe(true);
  });

  it('builds the heatmap grid and flags over-allocation; the simulator adds on top', () => {
    const members = [
      { id: 'a', hoursPerWeek: 40, departmentIds: ['design'] },
      { id: 'b', hoursPerWeek: 40, departmentIds: ['design', 'video'] },
    ];
    const efforts = [{ itemType: 'post', departmentId: 'design', hours: 10 }];
    const base = {
      today,
      weeks: weeks.slice(0, 1),
      departmentIds: ['design', 'video'],
      members,
      timeOff: [],
      holidays: cal.holidays,
      tasks: [
        { id: 't', departmentId: 'design', estimateMinutes: 50 * 60, startDate: '2026-10-04', dueDate: '2026-10-08', assigneeIds: ['a'] },
      ],
      packages: [],
      deals: [],
      efforts,
    };
    const grid = capacityGrid(base);
    const design = grid.find((g) => g.departmentId === 'design')!.cells[0]!;
    expect(design.capacity).toBe(60); // 40 + half of 40
    expect(design.demand).toBeCloseTo(50);
    expect(design.level).toBe('ok');
    const video = grid.find((g) => g.departmentId === 'video')!.cells[0]!;
    expect(video).toMatchObject({ capacity: 20, demand: 0, level: 'idle' });

    const sim = capacityGrid({ ...base, simulate: { items: [{ itemType: 'post', quantity: 8 }], startDate: today } });
    const simDesign = sim.find((g) => g.departmentId === 'design')!.cells[0]!;
    expect(simDesign.simulated).toBeGreaterThan(0);
    expect(simDesign.demand).toBeGreaterThan(design.demand);
    expect(levelOf(55, 60)).toBe('tight');
    expect(levelOf(61, 60)).toBe('over');
    expect(levelOf(1, 0)).toBe('over');

    const load = memberLoad(base);
    expect(load.find((l) => l.userId === 'a')!.weeks[0]).toMatchObject({ capacity: 40, demand: 50, level: 'over' });
  });
});
