import { describe, expect, it } from 'vitest';

import { applyDecision, clientState, submitTarget, taskCategoryFor } from '@/modules/deliverables/constants';
import { endOfWeek, isOverdue, myWorkSection, positionBetween, timerMinutes } from '@/modules/tasks/constants';
import { activeFilterCount, applyFilters, dueBucket, groupTasks, sortTasks, type FilterableTask } from '@/modules/tasks/filter';
import { dependents, orderSteps, scheduleSteps } from '@/modules/workflows/constants';
import { saveStepsSchema } from '@/modules/workflows/schemas';

// ---------------------------------------------------------------------------
// Workflow generation: order, dependencies, due dates
// ---------------------------------------------------------------------------

const step = (id: string, slaDays: number, dependsOn: string[] = [], sortOrder = 0) => ({ id, slaDays, dependsOn, sortOrder });

describe('workflow scheduling', () => {
  it('orders steps after their dependencies, stable by sort order', () => {
    const steps = [step('schedule', 1, ['design'], 0), step('copy', 1, [], 1), step('design', 2, ['copy'], 2)];
    expect(orderSteps(steps)?.map((s) => s.id)).toEqual(['copy', 'design', 'schedule']);
  });

  it('rejects cycles, self-references and unknown steps', () => {
    expect(orderSteps([step('a', 1, ['b']), step('b', 1, ['a'])])).toBeNull();
    expect(orderSteps([step('a', 1, ['a'])])).toBeNull();
    expect(orderSteps([step('a', 1, ['ghost'])])).toBeNull();
  });

  it('chains due dates in working days (Friday and Saturday off)', () => {
    // Start Wednesday 2026-09-30: copy 1 day → Thu 10-01; design 2 days after → Sun 10-04, Mon 10-05; schedule 1 → Tue 10-06.
    const plan = scheduleSteps([step('copy', 1, [], 0), step('design', 2, ['copy'], 1), step('schedule', 1, ['design'], 2)], '2026-09-30')!;
    expect(plan.get('copy')).toEqual({ id: 'copy', startDate: '2026-09-30', dueDate: '2026-10-01' });
    expect(plan.get('design')).toEqual({ id: 'design', startDate: '2026-10-01', dueDate: '2026-10-05' });
    expect(plan.get('schedule')).toEqual({ id: 'schedule', startDate: '2026-10-05', dueDate: '2026-10-06' });
  });

  it('parallel branches start together and a join waits for the latest blocker', () => {
    const plan = scheduleSteps([step('script', 1), step('music', 3), step('edit', 2, ['script', 'music'])], '2026-10-04')!;
    expect(plan.get('script')!.dueDate).toBe('2026-10-05');
    expect(plan.get('music')!.dueDate).toBe('2026-10-07');
    expect(plan.get('edit')).toEqual({ id: 'edit', startDate: '2026-10-07', dueDate: '2026-10-11' });
  });

  it('a 0-day step is due the day it starts', () => {
    expect(scheduleSteps([step('kickoff', 0)], '2026-10-01')!.get('kickoff')!.dueDate).toBe('2026-10-01');
  });

  it('knows which steps depend on a step (to hide cyclic choices in the picker)', () => {
    const steps = [step('a', 1), step('b', 1, ['a']), step('c', 1, ['b']), step('d', 1)];
    expect([...dependents(steps, 'a')].sort()).toEqual(['b', 'c']);
    expect(dependents(steps, 'd').size).toBe(0);
  });

  it('the builder payload rejects cycles and review steps without a deliverable', () => {
    const base = {
      name: { ar: 'خطوة', en: 'Step' },
      description: { ar: '', en: '' },
      departmentId: null,
      assigneeMode: 'none' as const,
      assigneeRoleId: null,
      assigneeUserId: null,
      slaDays: 1,
      requiresInternalReview: false,
      requiresClientApproval: false,
      deliverableType: null,
    };
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    const templateId = crypto.randomUUID();
    const cyclic = saveStepsSchema.safeParse({
      templateId,
      steps: [
        { ...base, id: a, dependsOn: [b] },
        { ...base, id: b, dependsOn: [a] },
      ],
    });
    expect(cyclic.error?.issues.map((i) => i.message)).toContain('dependency_cycle');
    const review = saveStepsSchema.safeParse({ templateId, steps: [{ ...base, id: a, dependsOn: [], requiresClientApproval: true }] });
    expect(review.error?.issues.map((i) => i.message)).toContain('review_needs_deliverable');
    const role = saveStepsSchema.safeParse({ templateId, steps: [{ ...base, id: a, dependsOn: [], assigneeMode: 'role' }] });
    expect(role.error?.issues.map((i) => i.message)).toContain('required');
    expect(
      saveStepsSchema.safeParse({
        templateId,
        steps: [
          { ...base, id: a, dependsOn: [] },
          { ...base, id: b, dependsOn: [a] },
        ],
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Approval state machine (mirrors app.tg_deliverable_versions_before / app.tg_approvals_after)
// ---------------------------------------------------------------------------

describe('approval flow', () => {
  const both = { requiresInternalReview: true, requiresClientApproval: true };
  const clientOnly = { requiresInternalReview: false, requiresClientApproval: true };
  const internalOnly = { requiresInternalReview: true, requiresClientApproval: false };
  const none = { requiresInternalReview: false, requiresClientApproval: false };

  it('a submitted version enters the first stage the step needs', () => {
    expect(submitTarget(both)).toBe('internal_review');
    expect(submitTarget(clientOnly)).toBe('client_review');
    expect(submitTarget(internalOnly)).toBe('internal_review');
    expect(submitTarget(none)).toBe('approved');
  });

  it('internal review: approve sends it to the client (or approves), changes go back to the team', () => {
    expect(applyDecision('internal_review', 'internal', 'approved', both)).toBe('client_review');
    expect(applyDecision('internal_review', 'internal', 'approved', internalOnly)).toBe('approved');
    expect(applyDecision('internal_review', 'internal', 'changes_requested', both)).toBe('internal_changes');
  });

  it('client approval: approve or request changes, only while the client has it', () => {
    expect(applyDecision('client_review', 'client', 'approved', both)).toBe('approved');
    expect(applyDecision('client_review', 'client', 'changes_requested', both)).toBe('client_changes');
    expect(applyDecision('internal_review', 'client', 'approved', both)).toBeNull();
    expect(applyDecision('client_review', 'internal', 'approved', both)).toBeNull();
    expect(applyDecision('draft', 'internal', 'approved', both)).toBeNull();
    expect(applyDecision('approved', 'client', 'changes_requested', both)).toBeNull();
    expect(applyDecision('superseded', 'client', 'approved', both)).toBeNull();
  });

  it('the task follows the deliverable', () => {
    expect(taskCategoryFor.internal_review).toBe('review');
    expect(taskCategoryFor.client_changes).toBe('changes');
    expect(taskCategoryFor.approved).toBe('done');
  });

  it('the client sees awaiting / revising / approved only', () => {
    expect(clientState('client_review')).toBe('awaiting');
    expect(clientState('client_changes')).toBe('revising');
    expect(clientState('internal_review')).toBe('revising');
    expect(clientState('approved')).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// Task views
// ---------------------------------------------------------------------------

const me = 'me';
const today = '2026-09-29'; // Tuesday; the week ends Saturday 2026-10-03
let n = 0;
const task = (patch: Partial<FilterableTask> = {}): FilterableTask => ({
  id: `t${++n}`,
  number: n,
  title: `Task ${n}`,
  clientId: 'c1',
  statusId: 's-todo',
  statusCategory: 'todo',
  priority: 'normal',
  dueDate: null,
  tags: [],
  departmentId: null,
  reviewerId: null,
  parentId: null,
  assignees: [],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  ...patch,
});

describe('my work', () => {
  const at = (patch: Partial<FilterableTask> & { isAssignee?: boolean; isReviewer?: boolean }) =>
    myWorkSection({ dueDate: null, statusCategory: 'todo', isAssignee: true, isReviewer: false, ...patch } as never, today);

  it('buckets my tasks by due date and parks reviews under "waiting on me"', () => {
    expect(endOfWeek(today)).toBe('2026-10-03');
    expect(at({ dueDate: '2026-09-28' })).toBe('overdue');
    expect(at({ dueDate: today })).toBe('today');
    expect(at({ dueDate: '2026-10-03' })).toBe('week');
    expect(at({ dueDate: '2026-10-04' })).toBe('later');
    expect(at({ dueDate: null })).toBe('later');
    expect(at({ isAssignee: false, isReviewer: true, statusCategory: 'review' })).toBe('waiting');
    expect(at({ isAssignee: false, isReviewer: true, statusCategory: 'active' })).toBeNull();
    expect(at({ statusCategory: 'done', dueDate: '2026-09-01' })).toBeNull();
    expect(isOverdue({ dueDate: '2026-09-01', statusCategory: 'done' }, today)).toBe(false);
  });
});

describe('board ordering and timers', () => {
  it('places a card between its neighbours without renumbering the column', () => {
    expect(positionBetween(null, null)).toBe(1000);
    expect(positionBetween(10, 20)).toBe(15);
    expect(positionBetween(null, 20)).toBe(-980);
    expect(positionBetween(20, null)).toBe(1020);
  });

  it('rounds timers up to the minute and caps them at a day', () => {
    expect(timerMinutes('2026-09-29T10:00:00Z', '2026-09-29T10:00:20Z')).toBe(1);
    expect(timerMinutes('2026-09-29T10:00:00Z', '2026-09-29T11:30:01Z')).toBe(91);
    expect(timerMinutes('2026-09-28T00:00:00Z', '2026-09-30T00:00:00Z')).toBe(1440);
  });
});

describe('filters, sorting and grouping', () => {
  const tasks = [
    task({ title: 'Design hero', assignees: [{ id: me }], dueDate: '2026-09-28', priority: 'high', tags: ['instagram'] }),
    task({ title: 'Write captions', assignees: [{ id: 'other' }], dueDate: today, clientId: 'c2' }),
    task({ title: 'Done thing', statusCategory: 'done', statusId: 's-done', assignees: [{ id: me }] }),
    task({ title: 'Subtask', parentId: 't1', assignees: [{ id: me }] }),
    task({ title: 'Review me', reviewerId: me, statusCategory: 'review', statusId: 's-review', dueDate: '2026-10-10', priority: 'urgent' }),
    task({ title: 'Nobody', dueDate: null, priority: 'low' }),
  ];

  it('shows recent done tasks by default and hides subtasks; search finds subtasks and task numbers', () => {
    expect(applyFilters(tasks, {}, me, today).map((t) => t.title)).toEqual([
      'Design hero',
      'Write captions',
      'Done thing',
      'Review me',
      'Nobody',
    ]);
    expect(applyFilters(tasks, { showDone: false }, me, today).map((t) => t.title)).toEqual([
      'Design hero',
      'Write captions',
      'Review me',
      'Nobody',
    ]);
    expect(applyFilters(tasks, { q: 'subtask' }, me, today).map((t) => t.title)).toEqual(['Subtask']);
    expect(applyFilters(tasks, { q: `t-${tasks[1]!.number}` }, me, today).map((t) => t.title)).toEqual(['Write captions']);
    // Hiding done counts as an active filter; the default doesn't.
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ showDone: false })).toBe(1);
  });

  it('"mine" includes what I review; assignee filter supports unassigned', () => {
    expect(applyFilters(tasks, { showDone: false, mine: true }, me, today).map((t) => t.title)).toEqual(['Design hero', 'Review me']);
    expect(applyFilters(tasks, { showDone: false, assigneeIds: ['none'] }, me, today).map((t) => t.title)).toEqual(['Review me', 'Nobody']);
  });

  it('due, client, priority and tag filters', () => {
    expect(applyFilters(tasks, { showDone: false, due: 'overdue' }, me, today).map((t) => t.title)).toEqual(['Design hero']);
    expect(applyFilters(tasks, { showDone: false, due: 'today' }, me, today).map((t) => t.title)).toEqual(['Write captions']);
    expect(applyFilters(tasks, { showDone: false, due: 'none' }, me, today).map((t) => t.title)).toEqual(['Nobody']);
    expect(applyFilters(tasks, { showDone: false, clientIds: ['c2'] }, me, today)).toHaveLength(1);
    expect(applyFilters(tasks, { showDone: false, priorities: ['urgent', 'high'] }, me, today)).toHaveLength(2);
    expect(applyFilters(tasks, { showDone: false, tags: ['instagram'] }, me, today)).toHaveLength(1);
    expect(activeFilterCount({ due: 'any', mine: true, priorities: ['high'] })).toBe(2);
  });

  it('sorts by due date with undated last, and by priority', () => {
    const open = applyFilters(tasks, { showDone: false }, me, today);
    expect(sortTasks(open, 'due', 'asc').map((t) => t.title)).toEqual(['Design hero', 'Write captions', 'Review me', 'Nobody']);
    expect(sortTasks(open, 'due', 'desc').at(-1)!.title).toBe('Nobody');
    expect(sortTasks(open, 'priority', 'asc').map((t) => t.priority)).toEqual(['urgent', 'high', 'normal', 'low']);
  });

  it('groups by assignee (unassigned bucket) and by due bucket', () => {
    const open = applyFilters(tasks, { showDone: false }, me, today);
    const byAssignee = groupTasks(open, 'assignee', today);
    expect(byAssignee.get(me)).toHaveLength(1);
    expect(byAssignee.get('none')).toHaveLength(2);
    expect(dueBucket('2026-10-01', today)).toBe('week');
    expect([...groupTasks(open, 'due', today).keys()].sort()).toEqual(['later', 'none', 'overdue', 'today']);
  });
});
