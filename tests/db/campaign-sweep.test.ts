/**
 * Daily campaign sweep, run "a week from now" against the seeded DB: the planned Gulf campaign starts, the Darb
 * campaign with no recent numbers gets one stale reminder, Najd's monthly schedule produces September's draft report
 * — all as domain events — and a second run changes nothing. Restores the seed afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dbAdmin } from '@/lib/db/client';
import { runCampaignSweep } from '@/modules/campaigns/server/sweep';

import { clientId, sql } from './helpers';

const startedAt = new Date();
const later = new Date(Date.now() + 7 * 86_400_000);
let schedule: { id: string; next_run_on: string; last_run_at: Date | null };
let planned: string[];
let runOn: string;

beforeAll(async () => {
  [schedule] = (await sql`select id, next_run_on::text, last_run_at from public.report_schedules limit 1`) as unknown as [typeof schedule];
  planned = (await sql<{ id: string }[]>`select id from public.campaigns where status = 'planned'`).map((r) => r.id);
  // The seed schedules the first run for the next month start in Riyadh; seeded just after a month boundary that is
  // weeks away. Pin it to this month's start so "a week from now" always covers exactly one due period.
  [{ runOn }] = (await sql`update public.report_schedules set next_run_on = date_trunc('month', now() at time zone 'Asia/Riyadh')::date
    where id = ${schedule.id} returning next_run_on::text as "runOn"`) as unknown as [{ runOn: string }];
});

afterAll(async () => {
  await sql`delete from public.reports where schedule_id is not null and created_at >= ${startedAt}`;
  await sql`update public.report_schedules set next_run_on = ${schedule.next_run_on}::date, last_run_at = ${schedule.last_run_at} where id = ${schedule.id}`;
  if (planned.length) await sql`update public.campaigns set status = 'planned' where id = any(${planned}::uuid[])`;
  await sql`update public.campaigns set stale_notified_at = null`;
  await sql`delete from public.domain_events where occurred_at >= ${startedAt} and aggregate_type in ('campaign', 'report')`;
  await sql.end();
  await (dbAdmin as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe('campaign sweep', () => {
  it('starts planned campaigns, flags stale numbers and prepares scheduled reports — once', async () => {
    const first = await runCampaignSweep(later);
    expect(first.started).toBe(planned.length);
    expect(first.stale).toBeGreaterThanOrEqual(1);
    expect(first.reports).toBe(1);

    const darb = await clientId('darb-coffee');
    const events = await sql<{ type: string; client_id: string; payload: Record<string, string> }[]>`
      select type, client_id, payload from public.domain_events where occurred_at >= ${startedAt} order by occurred_at`;
    expect(events.some((e) => e.type === 'campaign.metrics_stale' && e.client_id === darb)).toBe(true);
    expect(events.filter((e) => e.type === 'campaign.status_changed' && e.payload.to === 'active')).toHaveLength(planned.length);
    expect(events.filter((e) => e.type === 'report.draft_ready')).toHaveLength(1);

    const [report] = await sql<{ status: string; period_start: string; period_end: string; title: string; sections: number }[]>`
      select r.status, r.period_start::text, r.period_end::text, r.title,
        (select count(*)::int from public.report_sections s where s.report_id = r.id) as sections
      from public.reports r where r.schedule_id = ${schedule.id} and r.created_at >= ${startedAt}`;
    // The schedule runs on the 1st of this month → the month that just ended.
    const prev = new Date(`${runOn}T12:00:00Z`);
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    expect(report).toMatchObject({ status: 'draft', period_start: `${prev.toISOString().slice(0, 7)}-01` });
    expect(report!.period_end < runOn).toBe(true);
    expect(report!.sections).toBeGreaterThan(0);
    expect(report!.title.length).toBeGreaterThan(0);

    const [next] = await sql<{ next_run_on: string }[]>`select next_run_on::text from public.report_schedules where id = ${schedule.id}`;
    expect(next!.next_run_on > runOn).toBe(true);

    const second = await runCampaignSweep(later);
    expect(second).toEqual({ started: 0, completed: 0, stale: 0, reports: 0 });
  });
});
