'use server';

import { and, eq, sql } from 'drizzle-orm';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import { holidays, slaBreaches, slaPolicies } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { timeToMinute } from '@/modules/sla/calendar';
import {
  acknowledgeBreachSchema,
  businessHoursSchema,
  holidayIdSchema,
  policyIdSchema,
  saveHolidaySchema,
  savePolicySchema,
} from '@/modules/sla/schemas';

const adminPaths = ['/admin/sla'];

export const savePolicyAction = defineAction({
  input: savePolicySchema,
  side: 'agency',
  permission: 'sla:manage',
  async handler({ input, tx, ctx }) {
    const values = {
      name: input.name,
      clientId: input.clientId,
      requestTypeId: input.requestTypeId,
      priority: input.priority,
      responseHours: input.responseHours,
      resolutionDays: input.resolutionDays,
      pauseOnClient: input.pauseOnClient,
      atRiskPercent: input.atRiskPercent,
      escalateTo: input.escalateTo,
      isActive: input.isActive,
    };
    let policyId = input.policyId;
    if (policyId) {
      const updated = await tx
        .update(slaPolicies)
        .set(values)
        .where(and(eq(slaPolicies.id, policyId), eq(slaPolicies.organizationId, ctx.organization.id)))
        .returning({ id: slaPolicies.id });
      if (!updated.length) throw new ActionFailure('not_found');
    } else {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`coalesce(max(${slaPolicies.sortOrder}), 0)::int + 1` })
        .from(slaPolicies)
        .where(eq(slaPolicies.organizationId, ctx.organization.id));
      const [created] = await tx
        .insert(slaPolicies)
        .values({ ...values, organizationId: ctx.organization.id, sortOrder: n })
        .returning({ id: slaPolicies.id });
      policyId = created!.id;
    }
    await emitEvent(tx, {
      type: 'sla_policy.saved',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'sla_policy', id: policyId },
      clientId: input.clientId,
      payload: { policyId },
    });
    return { policyId };
  },
  revalidate: adminPaths,
});

export const deletePolicyAction = defineAction({
  input: policyIdSchema,
  side: 'agency',
  permission: 'sla:manage',
  async handler({ input, tx, ctx }) {
    // Requests keep their targets; their `sla_policy_id` is cleared by the foreign key.
    const deleted = await tx
      .delete(slaPolicies)
      .where(and(eq(slaPolicies.id, input.policyId), eq(slaPolicies.organizationId, ctx.organization.id)))
      .returning({ id: slaPolicies.id });
    if (!deleted.length) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'sla_policy.deleted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'sla_policy', id: input.policyId },
      payload: { policyId: input.policyId },
    });
    return { policyId: input.policyId };
  },
  revalidate: adminPaths,
});

export const saveBusinessHoursAction = defineAction({
  input: businessHoursSchema,
  side: 'agency',
  permission: 'sla:manage',
  async handler({ input, tx, ctx }) {
    const start = timeToMinute(input.start);
    const end = timeToMinute(input.end);
    if (start === null || end === null || start >= end) throw new ActionFailure('validation', { end: ['time_order'] });
    // Security definer: re-checks `sla:manage` (organizations' own update policy needs `organization:update`).
    await tx.execute(sql`select app.set_business_hours(${ctx.organization.id}::uuid, ${start}::int, ${end}::int)`);
    await emitEvent(tx, {
      type: 'business_hours.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'organization', id: ctx.organization.id },
      payload: { start, end },
    });
    return { start, end };
  },
  revalidate: adminPaths,
});

export const saveHolidayAction = defineAction({
  input: saveHolidaySchema,
  side: 'agency',
  permission: 'sla:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .insert(holidays)
      .values({ organizationId: ctx.organization.id, date: input.date, name: input.name })
      .onConflictDoUpdate({ target: [holidays.organizationId, holidays.date], set: { name: input.name } })
      .returning({ id: holidays.id });
    await emitEvent(tx, {
      type: 'holiday.saved',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'holiday', id: row!.id },
      payload: { holidayId: row!.id, date: input.date },
    });
    return { holidayId: row!.id };
  },
  revalidate: adminPaths,
});

export const deleteHolidayAction = defineAction({
  input: holidayIdSchema,
  side: 'agency',
  permission: 'sla:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .delete(holidays)
      .where(and(eq(holidays.id, input.holidayId), eq(holidays.organizationId, ctx.organization.id)))
      .returning({ id: holidays.id, date: holidays.date });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'holiday.deleted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'holiday', id: row.id },
      payload: { holidayId: row.id, date: row.date },
    });
    return { holidayId: row.id };
  },
  revalidate: adminPaths,
});

export const acknowledgeBreachAction = defineAction({
  input: acknowledgeBreachSchema,
  side: 'agency',
  permission: 'requests:read',
  async handler({ input, tx, ctx }) {
    // RLS: request access + operations:read or requests:triage; the trigger stamps who and when.
    const [row] = await tx
      .update(slaBreaches)
      .set({ note: input.note, acknowledgedAt: new Date() })
      .where(eq(slaBreaches.id, input.breachId))
      .returning({ id: slaBreaches.id, requestId: slaBreaches.requestId, clientId: slaBreaches.clientId });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'sla_breach.acknowledged',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request', id: row.requestId },
      clientId: row.clientId,
      payload: { breachId: row.id, requestId: row.requestId, clientId: row.clientId },
    });
    return { breachId: row.id };
  },
  revalidate: ['/sla', '/dashboard'],
});
