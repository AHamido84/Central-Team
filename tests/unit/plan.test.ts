import { describe, expect, it } from 'vitest';

import { orderPlan, planDependents, planSchema, schedulePlan, type PlanItem } from '@/modules/workflows/plan';

const item = (key: string, p: Partial<PlanItem> = {}): PlanItem => ({
  key,
  stepId: null,
  title: key,
  departmentId: null,
  assigneeId: null,
  reviewerId: null,
  priority: 'normal',
  durationDays: 2,
  startDate: '2026-10-04',
  dueDate: '2026-10-04',
  manualDates: false,
  dependsOn: [],
  deliverableType: null,
  requiresInternalReview: false,
  requiresClientApproval: false,
  ...p,
});

// 2026-10-04 is a Sunday (first working day of the week in Saudi Arabia).
describe('conversion plan (FR1.3)', () => {
  it('schedules items after the items they wait for, in working days', () => {
    const plan = schedulePlan([item('a'), item('b', { dependsOn: ['a'] }), item('c', { dependsOn: ['b'], durationDays: 3 })], '2026-10-04');
    expect(plan.map((i) => [i.startDate, i.dueDate])).toEqual([
      ['2026-10-04', '2026-10-06'],
      ['2026-10-06', '2026-10-08'],
      // Thursday + 3 working days skips Friday and Saturday.
      ['2026-10-08', '2026-10-13'],
    ]);
  });

  it('recalculates when an item is removed, and keeps hand-set dates', () => {
    const plan = schedulePlan(
      [item('a', { manualDates: true, startDate: '2026-10-11', dueDate: '2026-10-12' }), item('b', { dependsOn: ['a'] })],
      '2026-10-04',
    );
    expect(plan[0]!.dueDate).toBe('2026-10-12');
    expect(plan[1]!.startDate).toBe('2026-10-12');
    const without = schedulePlan([item('b', { dependsOn: [] })], '2026-10-04');
    expect(without[0]!.startDate).toBe('2026-10-04');
  });

  it('rejects cycles and unknown dependencies, and knows what depends on an item', () => {
    expect(orderPlan([item('a', { dependsOn: ['b'] }), item('b', { dependsOn: ['a'] })])).toBeNull();
    expect(orderPlan([item('a', { dependsOn: ['zzz'] })])).toBeNull();
    const items = [item('a'), item('b', { dependsOn: ['a'] }), item('c', { dependsOn: ['b'] })];
    expect([...planDependents(items, 'a')].sort()).toEqual(['b', 'c']);
    expect(planSchema.safeParse([item('a', { dependsOn: ['b'] }), item('b', { dependsOn: ['a'] })]).success).toBe(false);
    expect(planSchema.safeParse(items).success).toBe(true);
    expect(planSchema.safeParse([]).success).toBe(false);
    expect(planSchema.safeParse([item('a', { startDate: '2026-10-10', dueDate: '2026-10-09' })]).success).toBe(false);
  });
});
