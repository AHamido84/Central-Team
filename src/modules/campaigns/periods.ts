/**
 * Report periods for schedules (pure). Weekly reports cover Sunday–Saturday (the Saudi work week starts on Sunday)
 * and run on the Sunday after; monthly reports cover the calendar month and run on the 1st of the next month.
 */
import type { ReportCadence, ReportSectionKind } from '@/modules/campaigns/constants';
import { addDays, weekStart } from '@/modules/campaigns/metrics';
import type { ScheduleSection } from '@/modules/campaigns/report-types';

const firstOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;

function addMonths(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + months;
  const date = new Date(Date.UTC(y, m, 1));
  return date.toISOString().slice(0, 10);
}

/** The first run on or after tomorrow: next Sunday (weekly) or the 1st of next month (monthly). */
export function firstRunOn(cadence: ReportCadence, today: string): string {
  if (cadence === 'weekly') return addDays(weekStart(today), 7);
  return addMonths(firstOfMonth(today), 1);
}

export function nextRunAfter(cadence: ReportCadence, runOn: string): string {
  return cadence === 'weekly' ? addDays(runOn, 7) : addMonths(runOn, 1);
}

/** The period that just ended when a schedule runs on `runOn`. */
export function periodEndingBefore(cadence: ReportCadence, runOn: string): { start: string; end: string } {
  if (cadence === 'weekly') {
    const start = addDays(weekStart(runOn), -7);
    return { start, end: addDays(start, 6) };
  }
  const start = addMonths(firstOfMonth(runOn), -1);
  return { start, end: addDays(firstOfMonth(runOn), -1) };
}

/** Month-to-date / last full month / flight — the presets the report form offers. */
export function lastFullMonth(today: string): { start: string; end: string } {
  return periodEndingBefore('monthly', today);
}

/** Sections a new report starts with (the team edits the text and can add or remove sections). */
export const defaultReportSections: ScheduleSection[] = [
  { kind: 'kpi_summary' },
  { kind: 'trend', config: { metrics: ['impressions', 'clicks'], grain: 'day' } },
  { kind: 'channel_breakdown', config: { metrics: ['spend', 'impressions', 'clicks', 'ctr', 'conversions', 'cpa'] } },
  { kind: 'top_creatives' },
  { kind: 'commentary' },
  { kind: 'next_steps' },
];

export const sectionHasBody = (kind: ReportSectionKind) => kind === 'commentary' || kind === 'next_steps';
