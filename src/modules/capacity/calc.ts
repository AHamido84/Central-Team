/**
 * Capacity planning maths — pure (server, simulator UI and tests). Hours per department per week (Sunday–Saturday).
 *
 * Capacity: hours/week × working days that week ÷ 5, where working days are Sunday–Thursday minus org holidays and the
 * member's time off; a member in several departments is split evenly between them.
 * Demand: (1) open tasks with an estimate and a department, spread evenly over their working days (start, or 5 working
 * days before due, → due; overdue work lands in the first week); (2) package work still to do — the current period's
 * unused items, then the full quantity for following periods while the client stays active — at a daily rate over the
 * period's working days; (3) open deals with a target package: the package's work × probability from the expected close.
 */

export type Week = { start: string; end: string };
export type Level = 'idle' | 'ok' | 'tight' | 'over';

export const TIGHT_FROM = 0.85;
export const OVER_FROM = 1.0;
export const DEFAULT_HOURS_PER_WEEK = 40;

const DAY = 86_400_000;

export function addDaysIso(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

const dow = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

export function isWeekday(day: string): boolean {
  const d = dow(day);
  return d !== 5 && d !== 6;
}

/** Weeks starting on the Sunday on or before `today`. */
export function weeksFrom(today: string, count: number): Week[] {
  const start = addDaysIso(today, -dow(today));
  return Array.from({ length: count }, (_, i) => {
    const s = addDaysIso(start, i * 7);
    return { start: s, end: addDaysIso(s, 6) };
  });
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

export type Calendar = { holidays: ReadonlySet<string> };
const isWorking = (day: string, cal: Calendar) => isWeekday(day) && !cal.holidays.has(day);

export function workingDays(from: string, to: string, cal: Calendar): string[] {
  return daysBetween(from, to).filter((d) => isWorking(d, cal));
}

/** Working days going back from `due` (inclusive) — the default window for a task without a start date. */
function windowBefore(due: string, n: number, cal: Calendar): string {
  let d = due;
  let left = n - 1;
  for (let guard = 0; left > 0 && guard < 60; guard++) {
    d = addDaysIso(d, -1);
    if (isWorking(d, cal)) left--;
  }
  return d;
}

export type Member = { id: string; hoursPerWeek: number; departmentIds: readonly string[] };
export type TimeOff = { userId: string; startDate: string; endDate: string };

export function memberWeekCapacity(member: Member, week: Week, cal: Calendar, timeOff: readonly TimeOff[]): number {
  const off = timeOff.filter((t) => t.userId === member.id);
  const days = workingDays(week.start, week.end, cal).filter((d) => !off.some((t) => d >= t.startDate && d <= t.endDate));
  return (member.hoursPerWeek * days.length) / 5;
}

export type TaskDemand = {
  id: string;
  departmentId: string | null;
  estimateMinutes: number | null;
  startDate: string | null;
  dueDate: string | null;
  assigneeIds: readonly string[];
};

/** Hours per working day of a task over its window (empty when it has no estimate or due date). */
export function taskDays(task: TaskDemand, today: string, cal: Calendar): Map<string, number> {
  const out = new Map<string, number>();
  if (!task.estimateMinutes || !task.dueDate) return out;
  const hours = task.estimateMinutes / 60;
  if (task.dueDate < today) {
    // Overdue: still to do, now.
    const first = workingDays(today, addDaysIso(today, 7), cal)[0] ?? today;
    out.set(first, hours);
    return out;
  }
  const start =
    task.startDate && task.startDate <= task.dueDate
      ? task.startDate < today
        ? today
        : task.startDate
      : windowBefore(task.dueDate, 5, cal);
  const days = workingDays(start < today ? today : start, task.dueDate, cal);
  const spread = days.length ? days : [task.dueDate];
  for (const d of spread) out.set(d, (out.get(d) ?? 0) + hours / spread.length);
  return out;
}

export type Effort = { itemType: string; departmentId: string; hours: number };
export type PackageLine = { itemType: string; quantity: number; used: number };
export type ActivePackage = { clientId: string; periodStart: string; periodEnd: string; items: readonly PackageLine[]; renews: boolean };

/** Department hours for `quantity` units of each item. */
export function effortHours(items: readonly { itemType: string; quantity: number }[], efforts: readonly Effort[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items)
    for (const e of efforts.filter((x) => x.itemType === item.itemType))
      out.set(e.departmentId, (out.get(e.departmentId) ?? 0) + e.hours * Math.max(0, item.quantity));
  return out;
}

function addSpread(target: Map<string, Map<string, number>>, perDept: Map<string, number>, days: readonly string[], factor = 1) {
  if (!days.length) return;
  for (const [dept, hours] of perDept) {
    const byDay = target.get(dept) ?? new Map<string, number>();
    for (const d of days) byDay.set(d, (byDay.get(d) ?? 0) + (hours * factor) / days.length);
    target.set(dept, byDay);
  }
}

/** Package work per department per day over the horizon. */
export function packageDays(pkg: ActivePackage, efforts: readonly Effort[], today: string, horizonEnd: string, cal: Calendar) {
  const out = new Map<string, Map<string, number>>();
  // Current period: what's left, from today to the period end.
  const remaining = effortHours(
    pkg.items.map((i) => ({ itemType: i.itemType, quantity: i.quantity - i.used })),
    efforts,
  );
  const currentFrom = pkg.periodStart > today ? pkg.periodStart : today;
  if (pkg.periodEnd >= currentFrom)
    addSpread(
      out,
      remaining,
      workingDays(currentFrom, pkg.periodEnd <= horizonEnd ? pkg.periodEnd : horizonEnd, cal),
      portion(currentFrom, pkg.periodEnd, horizonEnd, cal),
    );
  if (!pkg.renews) return out;
  // Following periods of the same length, at the full quantity.
  const length = Math.round((Date.parse(pkg.periodEnd) - Date.parse(pkg.periodStart)) / DAY) + 1;
  const full = effortHours(pkg.items, efforts);
  for (let start = addDaysIso(pkg.periodEnd, 1), guard = 0; start <= horizonEnd && guard < 24; guard++) {
    const end = addDaysIso(start, length - 1);
    addSpread(out, full, workingDays(start, end <= horizonEnd ? end : horizonEnd, cal), portion(start, end, horizonEnd, cal));
    start = addDaysIso(end, 1);
  }
  return out;
}

/** Share of a period's working days that falls inside the horizon (so a clipped period only carries its share). */
function portion(from: string, to: string, horizonEnd: string, cal: Calendar): number {
  const all = workingDays(from, to, cal).length;
  if (!all) return 0;
  return workingDays(from, to <= horizonEnd ? to : horizonEnd, cal).length / all;
}

export type PipelineDeal = {
  id: string;
  probability: number;
  expectedCloseDate: string | null;
  items: readonly { itemType: string; quantity: number }[];
};

/** A deal's expected monthly package work × probability, from its expected close (or today when past) onward. */
export function dealDays(deal: PipelineDeal, efforts: readonly Effort[], today: string, horizonEnd: string, cal: Calendar) {
  const out = new Map<string, Map<string, number>>();
  const from = !deal.expectedCloseDate || deal.expectedCloseDate < today ? today : deal.expectedCloseDate;
  if (from > horizonEnd) return out;
  const monthly = effortHours(deal.items, efforts);
  // A month of work ≈ 30 days; spread at that daily rate over the working days in range.
  for (let start = from, guard = 0; start <= horizonEnd && guard < 24; guard++) {
    const end = addDaysIso(start, 29);
    addSpread(
      out,
      monthly,
      workingDays(start, end <= horizonEnd ? end : horizonEnd, cal),
      (deal.probability / 100) * portion(start, end, horizonEnd, cal),
    );
    start = addDaysIso(end, 1);
  }
  return out;
}

export type Cell = {
  capacity: number;
  tasks: number;
  packages: number;
  pipeline: number;
  simulated: number;
  demand: number;
  ratio: number | null;
  level: Level;
};

export function levelOf(demand: number, capacity: number): Level {
  if (capacity <= 0) return demand > 0 ? 'over' : 'idle';
  const r = demand / capacity;
  if (r > OVER_FROM) return 'over';
  if (r >= TIGHT_FROM) return 'tight';
  return demand > 0 ? 'ok' : 'idle';
}

export type CapacityInput = {
  today: string;
  weeks: readonly Week[];
  departmentIds: readonly string[];
  members: readonly Member[];
  timeOff: readonly TimeOff[];
  holidays: ReadonlySet<string>;
  tasks: readonly TaskDemand[];
  packages: readonly ActivePackage[];
  deals: readonly PipelineDeal[];
  efforts: readonly Effort[];
  /** Simulator: a package taken on from `startDate`. */
  simulate?: { items: readonly { itemType: string; quantity: number }[]; startDate: string } | null;
};

const sumWeek = (byDay: Map<string, number> | undefined, week: Week) => {
  let n = 0;
  if (!byDay) return 0;
  for (const [d, h] of byDay) if (d >= week.start && d <= week.end) n += h;
  return n;
};

export function capacityGrid(input: CapacityInput): { departmentId: string; cells: Cell[] }[] {
  const cal = { holidays: input.holidays };
  const horizonEnd = input.weeks.at(-1)?.end ?? input.today;
  const merge = (into: Map<string, Map<string, number>>, from: Map<string, Map<string, number>>) => {
    for (const [dept, days] of from) {
      const target = into.get(dept) ?? new Map<string, number>();
      for (const [d, h] of days) target.set(d, (target.get(d) ?? 0) + h);
      into.set(dept, target);
    }
  };
  const tasks = new Map<string, Map<string, number>>();
  for (const t of input.tasks) {
    if (!t.departmentId) continue;
    merge(tasks, new Map([[t.departmentId, taskDays(t, input.today, cal)]]));
  }
  const packages = new Map<string, Map<string, number>>();
  for (const p of input.packages) merge(packages, packageDays(p, input.efforts, input.today, horizonEnd, cal));
  const pipeline = new Map<string, Map<string, number>>();
  for (const d of input.deals) merge(pipeline, dealDays(d, input.efforts, input.today, horizonEnd, cal));
  const simulated = new Map<string, Map<string, number>>();
  if (input.simulate)
    merge(
      simulated,
      dealDays(
        { id: 'simulated', probability: 100, expectedCloseDate: input.simulate.startDate, items: input.simulate.items },
        input.efforts,
        input.today,
        horizonEnd,
        cal,
      ),
    );

  return input.departmentIds.map((departmentId) => ({
    departmentId,
    cells: input.weeks.map((week) => {
      const capacity = input.members
        .filter((m) => m.departmentIds.includes(departmentId))
        .reduce((n, m) => n + memberWeekCapacity(m, week, cal, input.timeOff) / m.departmentIds.length, 0);
      const cell = {
        tasks: sumWeek(tasks.get(departmentId), week),
        packages: sumWeek(packages.get(departmentId), week),
        pipeline: sumWeek(pipeline.get(departmentId), week),
        simulated: sumWeek(simulated.get(departmentId), week),
      };
      const demand = cell.tasks + cell.packages + cell.pipeline + cell.simulated;
      return { capacity, ...cell, demand, ratio: capacity > 0 ? demand / capacity : null, level: levelOf(demand, capacity) };
    }),
  }));
}

/** Assigned task hours per member per week (split between assignees) against their capacity. */
export function memberLoad(input: Pick<CapacityInput, 'today' | 'weeks' | 'members' | 'timeOff' | 'holidays' | 'tasks'>) {
  const cal = { holidays: input.holidays };
  return input.members.map((m) => {
    const mine = input.tasks.filter((t) => t.assigneeIds.includes(m.id));
    const byDay = new Map<string, number>();
    for (const t of mine)
      for (const [d, h] of taskDays(t, input.today, cal)) byDay.set(d, (byDay.get(d) ?? 0) + h / Math.max(1, t.assigneeIds.length));
    return {
      userId: m.id,
      weeks: input.weeks.map((w) => {
        const capacity = memberWeekCapacity(m, w, cal, input.timeOff);
        const demand = sumWeek(byDay, w);
        return { capacity, demand, level: levelOf(demand, capacity) };
      }),
    };
  });
}
