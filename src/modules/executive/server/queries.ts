import 'server-only';

import { and, eq } from 'drizzle-orm';

import type { AgencyContext } from '@/lib/auth/context';
import { kpiTargets } from '@/lib/db/schema';
import { withRls } from '@/lib/db/rls';

/** A year's KPI targets (RLS: executives and organization admins read them). */
export async function listTargets(ctx: AgencyContext, year: number) {
  return withRls((tx) =>
    tx
      .select({ metric: kpiTargets.metric, quarter: kpiTargets.quarter, value: kpiTargets.value })
      .from(kpiTargets)
      .where(and(eq(kpiTargets.organizationId, ctx.organization.id), eq(kpiTargets.year, year))),
  );
}
