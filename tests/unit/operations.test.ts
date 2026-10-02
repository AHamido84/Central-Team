import { describe, expect, it } from 'vitest';

import { clientHealth, compareHealth, emptySignals, loadShare } from '@/modules/operations/health';
import { compliance } from '@/modules/sla/constants';

describe('client health', () => {
  it('is healthy with no signals', () => {
    expect(clientHealth(emptySignals())).toEqual({ health: 'healthy', score: 100, reasons: [] });
  });

  it('caps each signal and orders reasons by cost', () => {
    const r = clientHealth({ ...emptySignals(), overdueTasks: 20, unansweredMessages: 1 });
    expect(r.score).toBe(75); // 20 (capped) + 5
    expect(r.health).toBe('watch');
    expect(r.reasons).toEqual(['overdueTasks', 'unansweredMessages']);
  });

  it('turns at risk when SLA breaches and off-track campaigns pile up', () => {
    const r = clientHealth({ ...emptySignals(), slaOverdue: 2, campaignsOffTrack: 1 });
    expect(r.score).toBe(55);
    expect(r.health).toBe('watch');
    const worse = clientHealth({ ...emptySignals(), slaOverdue: 5, campaignsOffTrack: 3, overdueTasks: 1 });
    expect(worse.score).toBe(21);
    expect(worse.health).toBe('at_risk');
    expect(worse.reasons.slice(0, 2)).toEqual(['slaOverdue', 'campaignsOffTrack']);
  });

  it('ignores negative counts and sorts worst first', () => {
    expect(clientHealth({ ...emptySignals(), overdueTasks: -3 }).score).toBe(100);
    const list = [
      { id: 'a', health: 'healthy' as const, score: 90 },
      { id: 'b', health: 'at_risk' as const, score: 40 },
      { id: 'c', health: 'watch' as const, score: 70 },
      { id: 'd', health: 'at_risk' as const, score: 10 },
    ];
    expect(list.sort(compareHealth).map((x) => x.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  it('computes the load share against the busiest person', () => {
    expect(loadShare(5, 10)).toBe(0.5);
    expect(loadShare(0, 0)).toBe(0);
    expect(loadShare(12, 10)).toBe(1);
  });
});

describe('SLA compliance', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  it('counts answered and past-due replies, and delivered requests with a due date', () => {
    const c = compliance(
      [
        {
          submittedAt: 'x',
          responseDueAt: '2026-09-28T10:00:00Z',
          firstResponseAt: '2026-09-28T09:00:00Z',
          dueDate: '2026-09-30',
          deliveredAt: '2026-09-29T08:00:00Z',
        },
        {
          submittedAt: 'x',
          responseDueAt: '2026-09-28T10:00:00Z',
          firstResponseAt: '2026-09-28T11:00:00Z',
          dueDate: '2026-09-27',
          deliveredAt: '2026-09-28T08:00:00Z',
        },
        { submittedAt: 'x', responseDueAt: '2026-09-29T10:00:00Z', firstResponseAt: null, dueDate: '2026-10-05', deliveredAt: null },
        { submittedAt: 'x', responseDueAt: '2026-09-30T10:00:00Z', firstResponseAt: null, dueDate: null, deliveredAt: null },
      ],
      now,
    );
    expect(c.response).toEqual({ met: 1, total: 3, rate: 1 / 3 });
    expect(c.resolution).toEqual({ met: 1, total: 2, rate: 0.5 });
    expect(compliance([], now).response.rate).toBeNull();
  });
});
