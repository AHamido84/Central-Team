import { describe, expect, it } from 'vitest';

import { responseState, slaState } from '@/modules/requests/constants';
import {
  addBusinessHours,
  addWorkingDays,
  isWorkingDay,
  localParts,
  minuteToTime,
  timeToMinute,
  workingDaysBetween,
  zonedInstant,
  type WorkCalendar,
} from '@/modules/sla/calendar';
import { matchPolicy, policySpecificity, windowUsed, type PolicyCriteria } from '@/modules/sla/constants';

const cal: WorkCalendar = { timeZone: 'Asia/Riyadh', startMinute: 540, endMinute: 1020, holidays: new Set(['2026-10-04']) };

describe('working calendar', () => {
  it('skips Friday, Saturday and holidays', () => {
    expect(isWorkingDay('2026-10-01', cal)).toBe(true); // Thursday
    expect(isWorkingDay('2026-10-02', cal)).toBe(false); // Friday
    expect(isWorkingDay('2026-10-03', cal)).toBe(false); // Saturday
    expect(isWorkingDay('2026-10-04', cal)).toBe(false); // Sunday, holiday
    expect(isWorkingDay('2026-10-05', cal)).toBe(true);
  });

  it('adds working days across the weekend and a holiday', () => {
    expect(addWorkingDays('2026-10-01', 1, cal)).toBe('2026-10-05');
    expect(addWorkingDays('2026-09-29', 3, { ...cal, holidays: [] })).toBe('2026-10-04');
    expect(addWorkingDays('2026-09-29', 3, cal)).toBe('2026-10-05');
    expect(addWorkingDays('2026-09-29', 0, cal)).toBe('2026-09-29');
  });

  it('counts working days in (from, to]', () => {
    expect(workingDaysBetween('2026-10-01', '2026-10-05', cal)).toBe(1);
    expect(workingDaysBetween('2026-09-27', '2026-10-01', cal)).toBe(4);
    expect(workingDaysBetween('2026-10-01', '2026-10-01', cal)).toBe(0);
    expect(workingDaysBetween('2026-10-05', '2026-10-01', cal)).toBe(0);
  });
});

describe('business hours', () => {
  it('converts between instants and local parts in Riyadh (UTC+3)', () => {
    expect(localParts(new Date('2026-09-29T07:30:00Z'), 'Asia/Riyadh')).toEqual({ day: '2026-09-29', minute: 630 });
    expect(zonedInstant('2026-09-29', 630, 'Asia/Riyadh').toISOString()).toBe('2026-09-29T07:30:00.000Z');
  });

  it('adds hours inside the same working day', () => {
    // Tuesday 10:00 Riyadh + 4h = 14:00 Riyadh.
    expect(addBusinessHours(new Date('2026-09-29T07:00:00Z'), 4, cal)?.toISOString()).toBe('2026-09-29T11:00:00.000Z');
  });

  it('carries over to the next working morning', () => {
    // Tuesday 15:00 Riyadh + 4h = 2h Tuesday + 2h Wednesday → Wednesday 11:00.
    expect(addBusinessHours(new Date('2026-09-29T12:00:00Z'), 4, cal)?.toISOString()).toBe('2026-09-30T08:00:00.000Z');
  });

  it('starts counting at opening time when submitted at night or on the weekend', () => {
    // Tuesday 22:00 Riyadh + 1h → Wednesday 10:00.
    expect(addBusinessHours(new Date('2026-09-29T19:00:00Z'), 1, cal)?.toISOString()).toBe('2026-09-30T07:00:00.000Z');
    // Thursday 16:00 + 2h → 1h Thursday, skip Fri/Sat and the Sunday holiday → Monday 10:00.
    expect(addBusinessHours(new Date('2026-10-01T13:00:00Z'), 2, cal)?.toISOString()).toBe('2026-10-05T07:00:00.000Z');
  });

  it('lands exactly on closing time when the hours fill the day', () => {
    expect(addBusinessHours(new Date('2026-09-29T06:00:00Z'), 8, cal)?.toISOString()).toBe('2026-09-29T14:00:00.000Z');
  });

  it('parses and formats HH:MM', () => {
    expect(timeToMinute('09:30')).toBe(570);
    expect(timeToMinute('24:00')).toBe(1440);
    expect(timeToMinute('24:30')).toBeNull();
    expect(timeToMinute('9')).toBeNull();
    expect(minuteToTime(1020)).toBe('17:00');
  });
});

describe('policy matching', () => {
  const base = { isActive: true, sortOrder: 0, createdAt: '2026-01-01T00:00:00Z', clientId: null, requestTypeId: null, priority: null };
  const policies: PolicyCriteria[] = [
    { ...base, id: 'default' },
    { ...base, id: 'urgent', priority: 'urgent' },
    { ...base, id: 'reel', requestTypeId: 'type-reel' },
    { ...base, id: 'najd', clientId: 'najd' },
    { ...base, id: 'najd-reel', clientId: 'najd', requestTypeId: 'type-reel' },
    { ...base, id: 'off', clientId: 'najd', requestTypeId: 'type-reel', priority: 'urgent', isActive: false },
  ];

  it('weights client over type over priority', () => {
    expect(policySpecificity({ clientId: 'x', requestTypeId: null, priority: 'high' })).toBe(5);
    expect(matchPolicy(policies, { clientId: 'other', requestTypeId: 'type-post', priority: 'normal' })?.id).toBe('default');
    expect(matchPolicy(policies, { clientId: 'other', requestTypeId: 'type-post', priority: 'urgent' })?.id).toBe('urgent');
    expect(matchPolicy(policies, { clientId: 'other', requestTypeId: 'type-reel', priority: 'urgent' })?.id).toBe('reel');
    expect(matchPolicy(policies, { clientId: 'najd', requestTypeId: 'type-post', priority: 'urgent' })?.id).toBe('najd');
    expect(matchPolicy(policies, { clientId: 'najd', requestTypeId: 'type-reel', priority: 'urgent' })?.id).toBe('najd-reel');
  });

  it('breaks ties by sort order and ignores inactive policies', () => {
    const tie = [
      { ...base, id: 'b', sortOrder: 2 },
      { ...base, id: 'a', sortOrder: 1 },
    ];
    expect(matchPolicy(tie, { clientId: 'c', requestTypeId: 't', priority: 'low' })?.id).toBe('a');
    expect(matchPolicy([{ ...base, id: 'x', isActive: false }], { clientId: 'c', requestTypeId: 't', priority: 'low' })).toBeNull();
  });
});

describe('SLA states', () => {
  const now = new Date('2026-09-29T09:00:00Z');
  const req = {
    status: 'under_review' as const,
    submittedAt: '2026-09-27T06:00:00Z',
    deliveredAt: null,
    dueDate: '2026-10-05',
  };

  it('resolution: on track, at risk by threshold, overdue, paused, met / missed', () => {
    expect(slaState(req, now)).toBe('on_track');
    const later = new Date('2026-10-02T00:00:00Z'); // ~55 % of the window used
    expect(slaState(req, later)).toBe('on_track');
    expect(slaState({ ...req, atRiskPercent: 50 }, later)).toBe('at_risk');
    expect(slaState({ ...req, dueDate: '2026-09-28' }, now)).toBe('overdue');
    expect(slaState({ ...req, status: 'needs_info', slaPausedAt: '2026-09-28T08:00:00Z' }, now)).toBe('paused');
    expect(slaState({ ...req, status: 'needs_info', slaPausedAt: null }, now)).toBe('on_track');
    expect(slaState({ ...req, status: 'delivered', deliveredAt: '2026-10-05T18:00:00Z' }, now)).toBe('met');
    expect(slaState({ ...req, status: 'delivered', deliveredAt: '2026-10-06T08:00:00Z' }, now)).toBe('missed');
  });

  it('response: met / missed once answered, else pacing against the target', () => {
    const r = { ...req, submittedAt: '2026-09-29T06:00:00Z', responseDueAt: '2026-09-29T14:00:00Z', firstResponseAt: null };
    expect(responseState(r, now)).toBe('on_track');
    expect(responseState(r, new Date('2026-09-29T12:30:00Z'))).toBe('at_risk');
    expect(responseState(r, new Date('2026-09-29T14:01:00Z'))).toBe('overdue');
    expect(responseState({ ...r, firstResponseAt: '2026-09-29T08:00:00Z' }, now)).toBe('met');
    expect(responseState({ ...r, firstResponseAt: '2026-09-29T15:00:00Z' }, now)).toBe('missed');
    expect(responseState({ ...r, responseDueAt: null }, now)).toBe('none');
    expect(responseState({ ...r, status: 'cancelled' }, now)).toBe('none');
  });

  it('measures the share of a window used', () => {
    expect(windowUsed('2026-09-29T06:00:00Z', '2026-09-29T14:00:00Z', new Date('2026-09-29T10:00:00Z'))).toBe(0.5);
    expect(windowUsed('2026-09-29T06:00:00Z', '2026-09-29T14:00:00Z', new Date('2026-09-30T10:00:00Z'))).toBe(1);
  });
});
