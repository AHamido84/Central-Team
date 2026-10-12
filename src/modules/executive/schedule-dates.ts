/**
 * When a board report schedule runs next and which period it reports (FR7). Weekly: Sunday (the Saudi week's first
 * day), this month so far; monthly: the 1st, last month. Pure.
 */
import { addDays, addMonths, monthStart } from '@/modules/executive/kpi';
import type { PeriodPreset } from '@/modules/executive/types';

export type Cadence = 'weekly' | 'monthly';

/** The first run day strictly after `today`. */
export function nextRunOn(cadence: Cadence, today: string): string {
  if (cadence === 'monthly') return addMonths(monthStart(today), 1);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(today, dow === 0 ? 7 : 7 - dow);
}

export const schedulePreset = (cadence: Cadence): PeriodPreset => (cadence === 'monthly' ? 'last_month' : 'this_month');
