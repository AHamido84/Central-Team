import 'server-only';

import { and, asc, desc, eq, sql } from 'drizzle-orm';

import type { AgencyContext } from '@/lib/auth/context';
import { executiveNotes, executiveSchedules, executiveViews, kpiTargets } from '@/lib/db/schema';
import { withRls } from '@/lib/db/rls';
import type { ExecutiveViewConfig } from '@/modules/executive/types';

/** A year's KPI targets (RLS: executives and organization admins read them). */
export async function listTargets(ctx: AgencyContext, year: number) {
  return withRls((tx) =>
    tx
      .select({ metric: kpiTargets.metric, quarter: kpiTargets.quarter, value: kpiTargets.value })
      .from(kpiTargets)
      .where(and(eq(kpiTargets.organizationId, ctx.organization.id), eq(kpiTargets.year, year))),
  );
}

export type SavedView = { id: string; name: string; config: ExecutiveViewConfig; pinned: boolean };

/** The signed-in executive's saved views, pinned first (RLS: own rows only). */
export async function listViews(): Promise<SavedView[]> {
  return withRls((tx) =>
    tx
      .select({ id: executiveViews.id, name: executiveViews.name, config: executiveViews.config, pinned: executiveViews.pinned })
      .from(executiveViews)
      .orderBy(desc(executiveViews.pinned), asc(executiveViews.name)),
  );
}

export type NoteRow = {
  id: string;
  kpi: string;
  body: string;
  context: ExecutiveViewConfig;
  authorId: string | null;
  ownerId: string | null;
  taskId: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

/** Recent notes (RLS: executives read all of them; an owner reads the ones addressed to them). */
export async function listNotes(limit = 30): Promise<NoteRow[]> {
  const rows = await withRls((tx) =>
    tx
      .select()
      .from(executiveNotes)
      .orderBy(sql`${executiveNotes.resolvedAt} is not null`, desc(executiveNotes.createdAt))
      .limit(limit),
  );
  return rows.map((r) => ({
    id: r.id,
    kpi: r.kpi,
    body: r.body,
    context: r.context,
    authorId: r.authorId,
    ownerId: r.ownerId,
    taskId: r.taskId,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type ScheduleRow = {
  id: string;
  cadence: 'weekly' | 'monthly';
  locale: 'ar' | 'en';
  recipients: string[];
  isActive: boolean;
  nextRunOn: string;
  lastRunAt: string | null;
};

export async function listSchedules(): Promise<ScheduleRow[]> {
  const rows = await withRls((tx) => tx.select().from(executiveSchedules).orderBy(asc(executiveSchedules.createdAt)));
  return rows.map((r) => ({
    id: r.id,
    cadence: r.cadence === 'weekly' ? 'weekly' : 'monthly',
    locale: r.locale === 'en' ? 'en' : 'ar',
    recipients: r.recipients,
    isActive: r.isActive,
    nextRunOn: r.nextRunOn,
    lastRunAt: r.lastRunAt?.toISOString() ?? null,
  }));
}
