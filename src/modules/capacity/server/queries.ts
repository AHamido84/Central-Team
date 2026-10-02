import 'server-only';

import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';

import type { AgencyContext } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import { departmentMembers, departments, holidays, memberCapacity, packageItems, packages, serviceEfforts, timeOff } from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import { can } from '@/lib/permissions/can';
import {
  addDaysIso,
  DEFAULT_HOURS_PER_WEEK,
  weeksFrom,
  type ActivePackage,
  type Effort,
  type Member,
  type PipelineDeal,
  type TaskDemand,
  type TimeOff,
  type Week,
} from '@/modules/capacity/calc';
import { dayInZone } from '@/modules/tasks/constants';

export const HORIZON_WEEKS = 8;

export type CapacityData = {
  today: string;
  weeks: Week[];
  departments: { id: string; name: LocalizedText; color: string }[];
  people: { id: string; name: string; avatarPath: string | null; hoursPerWeek: number; departmentIds: string[] }[];
  members: Member[];
  timeOff: (TimeOff & { id: string; kind: string; note: string })[];
  holidays: string[];
  tasks: TaskDemand[];
  packages: ActivePackage[];
  deals: PipelineDeal[];
  efforts: Effort[];
  catalog: { id: string; name: LocalizedText; items: { itemType: string; quantity: number }[] }[];
  canManage: boolean;
};

/**
 * Inputs for the capacity grid (computed in the browser too, for the simulator). People, departments, hours, time off
 * and efforts come through RLS; the demand rows come from the `app.capacity_*` definer functions, which return only
 * numbers and require `capacity:read` (ADR-060).
 */
export async function getCapacity(ctx: AgencyContext): Promise<CapacityData> {
  const orgId = ctx.organization.id;
  const today = dayInZone(new Date(), ctx.organization.defaultTimezone);
  const weeks = weeksFrom(today, HORIZON_WEEKS);
  const horizonEnd = weeks.at(-1)!.end;
  return withRls(async (tx) => {
    const depts = await tx
      .select({ id: departments.id, name: departments.name, color: departments.color })
      .from(departments)
      .where(and(eq(departments.organizationId, orgId), eq(departments.isArchived, false)))
      .orderBy(asc(departments.sortOrder));
    const people = await tx.execute<{ id: string; name: string; avatar_path: string | null }>(sql`
      select p.id, p.full_name as name, p.avatar_path from public.organization_members m join public.profiles p on p.id = m.user_id
      where m.organization_id = ${orgId} and m.user_type = 'agency' and m.status = 'active' order by p.full_name`);
    const dm = await tx.select().from(departmentMembers).where(eq(departmentMembers.organizationId, orgId));
    const hours = await tx.select().from(memberCapacity).where(eq(memberCapacity.organizationId, orgId));
    const off = await tx
      .select()
      .from(timeOff)
      .where(
        and(
          eq(timeOff.organizationId, orgId),
          gte(timeOff.endDate, addDaysIso(today, -30)),
          lte(timeOff.startDate, addDaysIso(horizonEnd, 90)),
        ),
      )
      .orderBy(asc(timeOff.startDate));
    const hol = await tx
      .select({ date: holidays.date })
      .from(holidays)
      .where(and(eq(holidays.organizationId, orgId), gte(holidays.date, weeks[0]!.start), lte(holidays.date, horizonEnd)));
    const efforts = await tx.select().from(serviceEfforts).where(eq(serviceEfforts.organizationId, orgId));
    const pkgs = await tx
      .select({ id: packages.id, name: packages.name })
      .from(packages)
      .where(and(eq(packages.organizationId, orgId), eq(packages.isActive, true)))
      .orderBy(asc(packages.priceMinor));
    const items = await tx.select().from(packageItems).where(eq(packageItems.organizationId, orgId)).orderBy(asc(packageItems.sortOrder));

    const taskRows = await tx.execute<{
      task_id: string;
      client_id: string | null;
      department_id: string | null;
      estimate_minutes: number;
      start_date: string | null;
      due_date: string;
      assignee_ids: string[];
    }>(sql`select * from app.capacity_tasks(${orgId}::uuid)`);
    const pkgRows = await tx.execute<{
      client_id: string;
      period_start: string;
      period_end: string;
      item_type: string;
      quantity: number;
      used: number;
    }>(sql`select * from app.capacity_packages(${orgId}::uuid, ${today}::date)`);
    const dealRows = await tx.execute<{
      deal_id: string;
      probability: number;
      expected_close_date: string | null;
      item_type: string;
      quantity: number;
    }>(sql`select * from app.capacity_deals(${orgId}::uuid)`);

    const deptIds = new Set(depts.map((d) => d.id));
    const peopleOut = [...people].map((p) => ({
      id: p.id,
      name: p.name,
      avatarPath: p.avatar_path,
      hoursPerWeek: hours.find((h) => h.userId === p.id)?.hoursPerWeek ?? DEFAULT_HOURS_PER_WEEK,
      departmentIds: dm.filter((m) => m.userId === p.id && deptIds.has(m.departmentId)).map((m) => m.departmentId),
    }));

    const byClient = new Map<string, ActivePackage & { items: { itemType: string; quantity: number; used: number }[] }>();
    for (const r of pkgRows) {
      const key = `${r.client_id}:${r.period_start}`;
      const p = byClient.get(key) ?? {
        clientId: r.client_id,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        items: [],
        renews: true,
      };
      p.items.push({ itemType: r.item_type, quantity: r.quantity, used: r.used });
      byClient.set(key, p);
    }
    const byDeal = new Map<string, PipelineDeal & { items: { itemType: string; quantity: number }[] }>();
    for (const r of dealRows) {
      const d = byDeal.get(r.deal_id) ?? { id: r.deal_id, probability: r.probability, expectedCloseDate: r.expected_close_date, items: [] };
      d.items.push({ itemType: r.item_type, quantity: r.quantity });
      byDeal.set(r.deal_id, d);
    }

    return {
      today,
      weeks,
      departments: depts,
      people: peopleOut,
      members: peopleOut.map((p) => ({ id: p.id, hoursPerWeek: p.hoursPerWeek, departmentIds: p.departmentIds })),
      timeOff: off.map((o) => ({ id: o.id, userId: o.userId, startDate: o.startDate, endDate: o.endDate, kind: o.kind, note: o.note })),
      holidays: hol.map((h) => h.date),
      tasks: [...taskRows].map((t) => ({
        id: t.task_id,
        clientId: t.client_id,
        departmentId: t.department_id,
        estimateMinutes: t.estimate_minutes,
        startDate: t.start_date,
        dueDate: t.due_date,
        assigneeIds: t.assignee_ids ?? [],
      })),
      packages: [...byClient.values()],
      deals: [...byDeal.values()],
      efforts: efforts.map((e) => ({ itemType: e.itemType, departmentId: e.departmentId, hours: e.hours })),
      catalog: pkgs.map((p) => ({
        id: p.id,
        name: p.name,
        items: items.filter((i) => i.packageId === p.id).map((i) => ({ itemType: i.itemType, quantity: i.quantity })),
      })),
      canManage: can(ctx.permissions, 'capacity:manage'),
    };
  });
}
