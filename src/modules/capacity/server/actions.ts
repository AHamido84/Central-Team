'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import { memberCapacity, serviceEfforts, timeOff } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { effortsSchema, memberHoursSchema, timeOffSchema } from '@/modules/capacity/schemas';

const paths = ['/capacity', '/team'];

export const saveMemberHoursAction = defineAction({
  input: memberHoursSchema,
  side: 'agency',
  permission: 'capacity:manage',
  async handler({ input, tx, ctx }) {
    const orgId = ctx.organization.id;
    await tx
      .insert(memberCapacity)
      .values({ organizationId: orgId, userId: input.userId, hoursPerWeek: input.hoursPerWeek })
      .onConflictDoUpdate({ target: [memberCapacity.organizationId, memberCapacity.userId], set: { hoursPerWeek: input.hoursPerWeek } });
    await emitEvent(tx, {
      type: 'capacity.updated',
      organizationId: orgId,
      actorId: ctx.session.userId,
      aggregate: { type: 'member', id: input.userId },
      payload: { area: 'member', id: input.userId },
    });
    return { userId: input.userId };
  },
  revalidate: paths,
});

export const addTimeOffAction = defineAction({
  input: timeOffSchema,
  side: 'agency',
  permission: 'capacity:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .insert(timeOff)
      .values({ ...input, organizationId: ctx.organization.id })
      .returning({ id: timeOff.id });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'capacity.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'member', id: input.userId },
      payload: { area: 'time_off', id: row.id },
    });
    return { id: row.id };
  },
  revalidate: paths,
});

export const deleteTimeOffAction = defineAction({
  input: z.object({ id: z.uuid() }),
  side: 'agency',
  permission: 'capacity:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .delete(timeOff)
      .where(and(eq(timeOff.id, input.id), eq(timeOff.organizationId, ctx.organization.id)))
      .returning({ id: timeOff.id, userId: timeOff.userId });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'capacity.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'member', id: row.userId },
      payload: { area: 'time_off', id: row.id },
    });
    return row;
  },
  revalidate: paths,
});

/** Replaces the whole effort matrix (item type × department → hours per unit); zero-hour cells are dropped. */
export const saveEffortsAction = defineAction({
  input: effortsSchema,
  side: 'agency',
  permission: 'capacity:manage',
  async handler({ input, tx, ctx }) {
    const orgId = ctx.organization.id;
    await tx.delete(serviceEfforts).where(eq(serviceEfforts.organizationId, orgId));
    const rows = input.efforts.filter((e) => e.hours > 0).map((e) => ({ ...e, organizationId: orgId }));
    if (rows.length) await tx.insert(serviceEfforts).values(rows);
    await emitEvent(tx, {
      type: 'capacity.updated',
      organizationId: orgId,
      actorId: ctx.session.userId,
      aggregate: { type: 'organization', id: orgId },
      payload: { area: 'effort', id: orgId },
    });
    return { count: rows.length };
  },
  revalidate: paths,
});
