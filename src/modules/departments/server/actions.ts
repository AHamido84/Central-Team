'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import { departmentMembers, departments } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { localizedText } from '@/lib/validation';
import { departmentColors } from '@/modules/departments/constants';

const fields = z.object({
  name: localizedText(60),
  color: z.enum(departmentColors),
});

export const createDepartmentAction = defineAction({
  input: fields,
  side: 'agency',
  permission: 'departments:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .insert(departments)
      .values({
        organizationId: ctx.organization.id,
        key: `dept_${crypto.randomUUID().slice(0, 8)}`,
        name: input.name,
        color: input.color,
      })
      .returning({ id: departments.id });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'department.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'department', id: row.id },
      payload: { departmentId: row.id },
    });
    return { id: row.id };
  },
  revalidate: ['/admin/departments'],
});

export const updateDepartmentAction = defineAction({
  input: fields.extend({ departmentId: z.uuid(), isArchived: z.boolean() }),
  side: 'agency',
  permission: 'departments:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .update(departments)
      .set({ name: input.name, color: input.color, isArchived: input.isArchived })
      .where(and(eq(departments.id, input.departmentId), eq(departments.organizationId, ctx.organization.id)))
      .returning({ id: departments.id });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'department.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'department', id: row.id },
      payload: { departmentId: row.id },
    });
    return null;
  },
  revalidate: ['/admin/departments'],
});

export const setDepartmentMembersAction = defineAction({
  input: z.object({
    departmentId: z.uuid(),
    members: z.array(z.object({ userId: z.uuid(), isLead: z.boolean() })).max(500),
  }),
  side: 'agency',
  permission: 'departments:manage',
  async handler({ input, tx, ctx }) {
    const current = await tx
      .select({ userId: departmentMembers.userId })
      .from(departmentMembers)
      .where(eq(departmentMembers.departmentId, input.departmentId));
    const currentIds = current.map((c) => c.userId);
    const nextIds = input.members.map((m) => m.userId);
    await tx.delete(departmentMembers).where(eq(departmentMembers.departmentId, input.departmentId));
    if (input.members.length) {
      await tx.insert(departmentMembers).values(
        input.members.map((m) => ({
          departmentId: input.departmentId,
          userId: m.userId,
          organizationId: ctx.organization.id,
          isLead: m.isLead,
        })),
      );
    }
    await emitEvent(tx, {
      type: 'department.members_changed',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'department', id: input.departmentId },
      payload: {
        departmentId: input.departmentId,
        added: nextIds.filter((id) => !currentIds.includes(id)),
        removed: currentIds.filter((id) => !nextIds.includes(id)),
      },
    });
    return null;
  },
  revalidate: ['/admin/departments', '/admin/users'],
});
