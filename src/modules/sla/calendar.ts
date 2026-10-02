/**
 * Working calendar for SLA targets — mirrors `app.org_is_working_day`, `app.org_add_working_days`,
 * `app.org_working_days_between` and `app.org_add_business_hours` (a DB test keeps them identical).
 * Working days are Sunday–Thursday minus the organization's holidays; business hours are minutes after midnight
 * in the organization's time zone. Pure — used by the server, the admin preview and tests.
 */
export type WorkCalendar = {
  timeZone: string;
  /** Minutes after midnight, e.g. 540 = 09:00. */
  startMinute: number;
  endMinute: number;
  /** `YYYY-MM-DD` dates. */
  holidays: ReadonlySet<string> | readonly string[];
};

const MINUTE = 60_000;

function hasHoliday(cal: WorkCalendar, day: string): boolean {
  return Array.isArray(cal.holidays) ? cal.holidays.includes(day) : (cal.holidays as ReadonlySet<string>).has(day);
}

function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isWorkingDay(day: string, cal: WorkCalendar): boolean {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return dow !== 5 && dow !== 6 && !hasHoliday(cal, day);
}

export function addWorkingDays(from: string, days: number, cal: WorkCalendar): string {
  let d = from;
  let left = days;
  for (let guard = 0; left > 0 && guard < 3660; guard++) {
    d = shiftDay(d, 1);
    if (isWorkingDay(d, cal)) left--;
  }
  return d;
}

/** Working days in (from, to]. */
export function workingDaysBetween(from: string, to: string, cal: WorkCalendar): number {
  let n = 0;
  for (let d = shiftDay(from, 1); d <= to; d = shiftDay(d, 1)) if (isWorkingDay(d, cal)) n++;
  return n;
}

/** Local calendar day and minute of an instant in a time zone. */
export function localParts(at: Date, timeZone: string): { day: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const day = `${String(get('year')).padStart(4, '0')}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')}`;
  return { day, minute: get('hour') * 60 + get('minute') + get('second') / 60 + at.getUTCMilliseconds() / MINUTE };
}

/** The instant at `minute` minutes after local midnight of `day` in `timeZone` (two passes cover DST shifts). */
export function zonedInstant(day: string, minute: number, timeZone: string): Date {
  const naive = Date.parse(`${day}T00:00:00Z`) + minute * MINUTE;
  let guess = naive;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timeZone);
    const seen = Date.parse(`${p.day}T00:00:00Z`) + p.minute * MINUTE;
    guess += naive - seen;
  }
  return new Date(Math.round(guess));
}

export function addBusinessHours(from: Date, hours: number, cal: WorkCalendar): Date | null {
  let { day, minute } = localParts(from, cal.timeZone);
  let left = hours * 60;
  for (let guard = 0; guard < 3660; guard++) {
    if (isWorkingDay(day, cal)) {
      const start = Math.max(minute, cal.startMinute);
      if (start < cal.endMinute) {
        const available = cal.endMinute - start;
        if (available >= left) return zonedInstant(day, start + left, cal.timeZone);
        left -= available;
      }
    }
    day = shiftDay(day, 1);
    minute = 0;
  }
  return null;
}

/** `HH:MM` ⇄ minutes after midnight, for the business-hours form. */
export function minuteToTime(minute: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(minute)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function timeToMinute(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}
