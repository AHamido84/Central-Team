import 'server-only';

import { and, eq, inArray, isNull, ne } from 'drizzle-orm';

import type { AgencyContext } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import { dealStageHistory, deals, leads, profiles, salesTargets } from '@/lib/db/schema';
import type { DealStatus, LostReason, SalesPeriod } from '@/modules/crm/constants';
import type { LeadForSource, MetricDeal, StageMove } from '@/modules/crm/metrics';
import { listPipelinesTx, type PipelineWithStages } from '@/modules/crm/server/queries';
import { dayInZone } from '@/modules/tasks/constants';

/** First day of the window: this month, the last 3 months or the last 12 months (calendar months, org time zone). */
export function periodStart(period: SalesPeriod, today: string): string {
  const back = period === 'month' ? 0 : period === 'quarter' ? 2 : 11;
  const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1)).toISOString().slice(0, 10);
}

export type SalesData = {
  today: string;
  from: string;
  pipeline: PipelineWithStages;
  pipelines: PipelineWithStages[];
  deals: (MetricDeal & { lostReason: LostReason | null })[];
  moves: StageMove[];
  leads: LeadForSource[];
  /** YYYY-MM → target (team target, or the salesperson's when filtered). */
  targets: Map<string, number>;
  people: Map<string, string>;
};

/**
 * Everything the sales dashboard needs, read through RLS (a rep without `crm:manage_all` only sees their own deals
 * and leads, so the dashboard becomes "my numbers"). Metrics are computed with the pure functions in `metrics.ts`.
 */
export async function getSalesData(
  ctx: AgencyContext,
  opts: { period: SalesPeriod; ownerId: string | null; pipelineId: string | null },
): Promise<SalesData | null> {
  const orgId = ctx.organization.id;
  const today = dayInZone(new Date(), ctx.organization.defaultTimezone);
  const from = periodStart(opts.period, today);
  return withRls(async (tx) => {
    const pipelines = await listPipelinesTx(tx, orgId);
    const pipeline = pipelines.find((p) => p.id === opts.pipelineId) ?? pipelines[0];
    if (!pipeline) return null;
    const dealRows = await tx
      .select()
      .from(deals)
      .where(
        and(eq(deals.organizationId, orgId), eq(deals.pipelineId, pipeline.id), opts.ownerId ? eq(deals.ownerId, opts.ownerId) : undefined),
      );
    const ids = new Set(dealRows.map((d) => d.id));
    const history = await tx
      .select({ dealId: dealStageHistory.dealId, toStageId: dealStageHistory.toStageId })
      .from(dealStageHistory)
      .where(eq(dealStageHistory.organizationId, orgId));
    const leadRows = await tx
      .select({ source: leads.source, status: leads.status, createdAt: leads.createdAt })
      .from(leads)
      .where(and(eq(leads.organizationId, orgId), ne(leads.status, 'merged'), opts.ownerId ? eq(leads.ownerId, opts.ownerId) : undefined));
    const targetRows = await tx
      .select()
      .from(salesTargets)
      .where(
        and(eq(salesTargets.organizationId, orgId), opts.ownerId ? eq(salesTargets.ownerId, opts.ownerId) : isNull(salesTargets.ownerId)),
      );
    const ownerIds = [...new Set(dealRows.map((d) => d.ownerId).filter((x): x is string => Boolean(x)))];
    const people = ownerIds.length
      ? await tx.select({ id: profiles.id, name: profiles.fullName }).from(profiles).where(inArray(profiles.id, ownerIds))
      : [];
    return {
      today,
      from,
      pipeline,
      pipelines,
      deals: dealRows.map((d) => ({
        id: d.id,
        stageId: d.stageId,
        status: d.status as DealStatus,
        valueMinor: d.valueMinor,
        probability: d.probability,
        expectedCloseDate: d.expectedCloseDate,
        ownerId: d.ownerId,
        source: d.source,
        createdAt: d.createdAt.toISOString(),
        wonAt: d.wonAt?.toISOString() ?? null,
        lostAt: d.lostAt?.toISOString() ?? null,
        lostReason: (d.lostReason as LostReason | null) ?? null,
      })),
      moves: history.filter((h) => ids.has(h.dealId)),
      leads: leadRows.map((l) => ({ source: l.source, status: l.status, createdAt: l.createdAt.toISOString() })),
      targets: new Map(targetRows.map((t) => [t.month.slice(0, 7), t.amountMinor])),
      people: new Map(people.map((p) => [p.id, p.name])),
    };
  });
}
