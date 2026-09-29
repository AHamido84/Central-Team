import { timingSafeEqual } from 'node:crypto';

import { NextResponse, type NextRequest } from 'next/server';

import { runDispatcher } from '@/lib/events/schedule';
import { runCampaignSweep } from '@/modules/campaigns/server/sweep';
import { runSlaSweep } from '@/modules/sla/server/sweep';
import { runReminderSweep } from '@/modules/tasks/server/reminders';

export const dynamic = 'force-dynamic';

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/**
 * Safety net for the event dispatcher (retries, events left behind by a crashed process) and the time-based
 * reminder sweeps (due soon / overdue tasks, pending approvals; campaign status, health, stale metrics and scheduled
 * reports; SLA at-risk / breach detection). Called by the platform scheduler (Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`). Disabled when CRON_SECRET is unset.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const reminders = await runReminderSweep();
  const campaigns = await runCampaignSweep();
  const sla = await runSlaSweep();
  const result = await runDispatcher();
  return NextResponse.json({ ...result, reminders, campaigns, sla });
}
