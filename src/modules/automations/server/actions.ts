'use server';

import { eq } from 'drizzle-orm';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import { automations, whatsappTemplates } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { actionSubjects, triggerDefinition } from '@/modules/automations/constants';
import { checkWebhookUrl } from '@/modules/automations/engine-core';
import { automationInputSchema, dryRunSchema, idSchema, toggleSchema } from '@/modules/automations/schemas';
import { loadEvent, runAutomation } from '@/modules/automations/server/engine';

const paths = (id?: string) => ['/admin/automations', ...(id ? [`/admin/automations/${id}`] : [])];

export const saveAutomationAction = defineAction({
  input: automationInputSchema,
  side: 'agency',
  permission: 'automations:manage',
  async handler({ input, tx, ctx }) {
    const def = triggerDefinition(input.triggerType)!;
    const fieldKeys = new Set(def.fields.map((f) => f.key));
    const badCondition = input.conditions.findIndex((c) => !fieldKeys.has(c.field));
    if (badCondition >= 0) throw new ActionFailure('validation', { [`conditions.${badCondition}`]: ['unknown_field'] });
    for (const [i, action] of input.actions.entries()) {
      const allowed = actionSubjects[action.type];
      if (allowed !== 'any' && !allowed.includes(def.subject))
        throw new ActionFailure('validation', { [`actions.${i}`]: ['not_applicable'] });
      if (action.type === 'webhook' && !checkWebhookUrl(action.config.url).ok) throw new ActionFailure('webhook_url_blocked');
      if (action.type === 'send_whatsapp') {
        const [tpl] = await tx.select().from(whatsappTemplates).where(eq(whatsappTemplates.id, action.config.templateId));
        if (!tpl) throw new ActionFailure('validation', { [`actions.${i}`]: ['template'] });
        if (tpl.status !== 'approved') throw new ActionFailure('template_not_approved');
      }
    }
    const values = {
      name: input.name,
      description: input.description,
      isActive: input.isActive,
      triggerType: input.triggerType,
      match: input.match,
      conditions: input.conditions,
      actions: input.actions,
    };
    let id = input.id;
    if (id) {
      const [row] = await tx.update(automations).set(values).where(eq(automations.id, id)).returning({ id: automations.id });
      if (!row) throw new ActionFailure('not_found');
    } else {
      id = crypto.randomUUID();
      await tx.insert(automations).values({ id, organizationId: ctx.organization.id, ...values });
    }
    await emitEvent(tx, {
      type: 'automation.saved',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'automation', id },
      payload: { automationId: id, created: !input.id },
    });
    return { id };
  },
  revalidate: (_input, r) => paths(r.id),
});

export const toggleAutomationAction = defineAction({
  input: toggleSchema,
  side: 'agency',
  permission: 'automations:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .update(automations)
      .set({ isActive: input.isActive })
      .where(eq(automations.id, input.id))
      .returning({ id: automations.id });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'automation.toggled',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'automation', id: row.id },
      payload: { automationId: row.id, isActive: input.isActive },
    });
    return { id: row.id };
  },
  revalidate: (input) => paths(input.id),
});

export const duplicateAutomationAction = defineAction({
  input: idSchema,
  side: 'agency',
  permission: 'automations:manage',
  async handler({ input, tx, ctx }) {
    const [a] = await tx.select().from(automations).where(eq(automations.id, input.id));
    if (!a) throw new ActionFailure('not_found');
    const id = crypto.randomUUID();
    await tx.insert(automations).values({
      id,
      organizationId: ctx.organization.id,
      name: `${a.name}`.slice(0, 110) + ' (2)',
      description: a.description,
      isActive: false,
      triggerType: a.triggerType,
      match: a.match,
      conditions: a.conditions,
      actions: a.actions,
    });
    await emitEvent(tx, {
      type: 'automation.saved',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'automation', id },
      payload: { automationId: id, created: true },
    });
    return { id };
  },
  revalidate: () => paths(),
});

export const deleteAutomationAction = defineAction({
  input: idSchema,
  side: 'agency',
  permission: 'automations:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx.delete(automations).where(eq(automations.id, input.id)).returning({ id: automations.id });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'automation.deleted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'automation', id: row.id },
      payload: { automationId: row.id },
    });
    return { id: row.id };
  },
  revalidate: () => paths(),
});

/**
 * Dry run: evaluates the saved rule against a real recent event (the picked one, or the latest of its type) and
 * records what each action *would* do — no notification, task, message or webhook is produced.
 */
export const dryRunAutomationAction = defineAction({
  input: dryRunSchema,
  side: 'agency',
  permission: 'automations:manage',
  rateLimit: { key: 'automation-dry-run', max: 30, windowSeconds: 600 },
  async handler({ input, tx, ctx }) {
    const [a] = await tx.select().from(automations).where(eq(automations.id, input.id));
    if (!a) throw new ActionFailure('not_found');
    const event = await loadEvent(ctx.organization.id, input.eventId, a.triggerType);
    if (!event) throw new ActionFailure('not_found');
    const outcome = await runAutomation(a, event, { dryRun: true, requestedBy: ctx.session.userId });
    return { runId: outcome.runId, status: outcome.status, skipReason: outcome.skipReason };
  },
  revalidate: (input) => paths(input.id),
});
