import 'server-only';

import { asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { withRls } from '@/lib/db/rls';
import { automationRuns, automations, clients, departments, profiles, whatsappTemplates } from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import type { AutomationAction, AutomationCondition, ActionResult, ConditionResult } from '@/modules/automations/types';

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export type AutomationListItem = {
  id: string;
  name: string;
  description: string;
  triggerType: string;
  isActive: boolean;
  actions: string[];
  runCount: number;
  failureCount: number;
  lastRunAt: string | null;
};

export async function listAutomations(): Promise<AutomationListItem[]> {
  const rows = await withRls((tx) => tx.select().from(automations).orderBy(desc(automations.isActive), asc(automations.name)));
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    triggerType: a.triggerType,
    isActive: a.isActive,
    actions: a.actions.map((x) => x.type),
    runCount: a.runCount,
    failureCount: a.failureCount,
    lastRunAt: iso(a.lastRunAt),
  }));
}

export type AutomationRunItem = {
  id: string;
  eventId: string | null;
  eventType: string;
  dryRun: boolean;
  status: 'running' | 'succeeded' | 'failed' | 'skipped';
  skipReason: string | null;
  depth: number;
  attempts: number;
  conditions: ConditionResult[];
  actions: ActionResult[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type AutomationDetail = {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  triggerType: string;
  match: 'all' | 'any';
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  runCount: number;
  failureCount: number;
  lastRunAt: string | null;
  runs: AutomationRunItem[];
};

export async function getAutomation(id: string): Promise<AutomationDetail | null> {
  return withRls(async (tx) => {
    const [a] = await tx.select().from(automations).where(eq(automations.id, id));
    if (!a) return null;
    const runs = await tx
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.automationId, a.id))
      .orderBy(desc(automationRuns.startedAt))
      .limit(50);
    return {
      id: a.id,
      name: a.name,
      description: a.description,
      isActive: a.isActive,
      triggerType: a.triggerType,
      match: a.match as 'all' | 'any',
      conditions: a.conditions,
      actions: a.actions,
      runCount: a.runCount,
      failureCount: a.failureCount,
      lastRunAt: iso(a.lastRunAt),
      runs: runs.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        eventType: r.eventType,
        dryRun: r.dryRun,
        status: r.status as AutomationRunItem['status'],
        skipReason: r.skipReason,
        depth: r.depth,
        attempts: r.attempts,
        conditions: r.conditions,
        actions: r.actions,
        error: r.error,
        startedAt: r.startedAt.toISOString(),
        finishedAt: iso(r.finishedAt),
      })),
    };
  });
}

export type BuilderOptions = {
  people: { id: string; name: string }[];
  clients: { id: string; name: LocalizedText }[];
  departments: { id: string; name: LocalizedText }[];
  templates: { id: string; name: string; language: string; paramCount: number; body: string }[];
};

export async function getBuilderOptions(organizationId: string): Promise<BuilderOptions> {
  return withRls(async (tx) => {
    const people = await tx.execute<{ id: string; name: string }>(sql`
      select p.id, p.full_name as name from public.profiles p
      join public.organization_members m on m.user_id = p.id
      where m.organization_id = ${organizationId} and m.status = 'active' and m.user_type = 'agency'
      order by p.full_name`);
    const clientRows = await tx
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(eq(clients.status, 'active'))
      .orderBy(asc(clients.slug));
    const deptRows = await tx.select({ id: departments.id, name: departments.name }).from(departments).orderBy(asc(departments.sortOrder));
    const templates = await tx
      .select({
        id: whatsappTemplates.id,
        name: whatsappTemplates.name,
        language: whatsappTemplates.language,
        paramCount: whatsappTemplates.paramCount,
        body: whatsappTemplates.body,
      })
      .from(whatsappTemplates)
      .where(eq(whatsappTemplates.status, 'approved'))
      .orderBy(asc(whatsappTemplates.name));
    return { people: [...people], clients: clientRows, departments: deptRows, templates };
  });
}

export type RecentEvent = { id: string; occurredAt: string; label: string };

/** Recent events of the rule's trigger type for the dry run picker (definer function checks `automations:manage`). */
export async function recentEvents(organizationId: string, type: string): Promise<RecentEvent[]> {
  const rows = await withRls((tx) =>
    tx.execute<{ id: string; occurred_at: string; aggregate_type: string; payload: Record<string, unknown> }>(
      sql`select id, occurred_at, aggregate_type, payload from app.automation_recent_events(${organizationId}::uuid, ${type}, 10)`,
    ),
  );
  return [...rows].map((r) => {
    const p = r.payload ?? {};
    const hint = ['reference', 'to', 'kind', 'source', 'provider'].map((k) => p[k]).find((v) => typeof v === 'string') as
      string | undefined;
    return { id: r.id, occurredAt: new Date(r.occurred_at).toISOString(), label: [r.aggregate_type, hint].filter(Boolean).join(' · ') };
  });
}

export async function peopleNames(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const rows = await withRls((tx) =>
    tx.select({ id: profiles.id, name: profiles.fullName }).from(profiles).where(inArray(profiles.id, ids)),
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}
