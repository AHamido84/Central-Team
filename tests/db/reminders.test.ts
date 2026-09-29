/**
 * Reminder sweep: "due soon" / "overdue" once per task per due date, and "waiting for your approval" every N days —
 * as domain events (notifications come from consumers). Runs against the seeded DB and cleans up after itself.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { dbAdmin } from '@/lib/db/client';
import { runReminderSweep } from '@/modules/tasks/server/reminders';

import { sql } from './helpers';

const startedAt = new Date();

afterAll(async () => {
  // Leave the seed as it was: drop the events this test produced and the reminder markers it set.
  await sql`delete from public.domain_events where occurred_at >= ${startedAt} and type in ('task.due_soon', 'task.overdue', 'deliverable.approval_reminder')`;
  await sql`update public.tasks set due_soon_notified_for = null, overdue_notified_for = null`;
  await sql.end();
  await (dbAdmin as unknown as { $client: { end: () => Promise<void> } }).$client.end();
});

describe('reminder sweep', () => {
  it('emits each reminder once and stays quiet on the next run', async () => {
    const [expected] = await sql<{ overdue: number; soon: number }[]>`
      select
        count(*) filter (where due_date < (now() at time zone 'Asia/Riyadh')::date)::int as overdue,
        count(*) filter (where due_date between (now() at time zone 'Asia/Riyadh')::date and (now() at time zone 'Asia/Riyadh')::date + 1)::int as soon
      from public.tasks where status_category <> 'done' and due_date is not null`;
    const first = await runReminderSweep();
    expect(first.overdue).toBe(expected!.overdue);
    expect(first.dueSoon).toBe(expected!.soon);
    const events = await sql<{ type: string; n: number }[]>`
      select type, count(*)::int as n from public.domain_events where occurred_at >= ${startedAt} group by type`;
    expect(events.find((e) => e.type === 'task.overdue')?.n).toBe(first.overdue);

    const second = await runReminderSweep();
    expect(second).toEqual({ dueSoon: 0, overdue: 0, approvalReminders: 0 });
  });

  it('reminds clients about deliverables waiting longer than the organization setting', async () => {
    const later = new Date(Date.now() + 30 * 86400000);
    const [waiting] = await sql<{ n: number }[]>`select count(*)::int as n from public.deliverables where status = 'client_review'`;
    const result = await runReminderSweep(later);
    expect(result.approvalReminders).toBe(waiting!.n);
    expect((await runReminderSweep(later)).approvalReminders).toBe(0);
    await sql`update public.deliverables set reminded_at = null where status = 'client_review'`;
  });
});
