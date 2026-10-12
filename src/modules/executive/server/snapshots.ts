import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';

import type { AgencyContext } from '@/lib/auth/context';
import { dbAdmin } from '@/lib/db/client';
import { runWithSession } from '@/lib/db/rls';
import { kpiSnapshots, organizations, roles, userRoles } from '@/lib/db/schema';
import { defaultViewConfig } from '@/modules/executive/config';
import { getExecutiveReport } from '@/modules/executive/server/data';
import { agencyContextFor } from '@/modules/executive/server/run-as';
import { dayInZone } from '@/modules/tasks/constants';

/**
 * Stores today's value of the state metrics (client health, backlog, pipeline, open risks…) so they get a history:
 * the sparklines, the health and risk trends and "vs previous" for state KPIs read these rows (FR7.5). Computed with
 * the same report as the screen, unfiltered, read as an executive; written with the service connection (users have
 * no write access to `kpi_snapshots`). One row per organization, day and metric — a refresh overwrites today's.
 */
export async function writeSnapshot(ctx: AgencyContext): Promise<number> {
  const report = await getExecutiveReport(ctx, defaultViewConfig);
  const day = report.today;
  const rows = Object.entries(report.snapshot).map(([metric, s]) => ({
    organizationId: ctx.organization.id,
    day,
    metric,
    value: s.value,
    details: s.details,
  }));
  if (!rows.length) return 0;
  await dbAdmin
    .insert(kpiSnapshots)
    .values(rows)
    .onConflictDoUpdate({
      target: [kpiSnapshots.organizationId, kpiSnapshots.day, kpiSnapshots.metric],
      set: { value: sql`excluded.value`, details: sql`excluded.details`, createdAt: sql`now()` },
    });
  return rows.length;
}

const READER_ROLES = ['executive_board', 'executive_viewer', 'super_admin'];

/** Cron step: one snapshot per organization per day, read as one of its executives (or a Super Admin). */
export async function runKpiSnapshots(now = new Date()): Promise<{ organizations: number; skipped: number }> {
  const out = { organizations: 0, skipped: 0 };
  const orgs = await dbAdmin.select({ id: organizations.id, tz: organizations.defaultTimezone }).from(organizations);
  for (const org of orgs) {
    const today = dayInZone(now, org.tz);
    const [done] = await dbAdmin
      .select({ n: sql<number>`count(*)::int` })
      .from(kpiSnapshots)
      .where(and(eq(kpiSnapshots.organizationId, org.id), eq(kpiSnapshots.day, today)));
    if (Number(done?.n ?? 0) > 0) continue;
    const readers = await dbAdmin
      .select({ userId: userRoles.userId, key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.organizationId, org.id), inArray(roles.key, READER_ROLES)));
    readers.sort((a, b) => READER_ROLES.indexOf(a.key) - READER_ROLES.indexOf(b.key));
    let ctx: AgencyContext | null = null;
    for (const r of readers) {
      ctx = await agencyContextFor(r.userId, org.id, 'executive:view');
      if (ctx) break;
    }
    if (!ctx) {
      out.skipped++;
      continue;
    }
    try {
      const reader = ctx;
      await runWithSession(reader.session, () => writeSnapshot(reader));
      out.organizations++;
    } catch (error) {
      console.error('[executive] snapshot failed', org.id, error);
      out.skipped++;
    }
  }
  return out;
}
