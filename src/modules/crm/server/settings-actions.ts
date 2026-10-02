'use server';

import { randomBytes } from 'node:crypto';

import { and, eq, notInArray, sql } from 'drizzle-orm';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { Tx } from '@/lib/db/client';
import { crmSettings, crmWebhookTokens, leadAssignmentRules, leadForms, pipelineStages, pipelines, salesTargets } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import {
  crmSettingsSchema,
  idSchema,
  leadFormSchema,
  pipelineSchema,
  ruleSchema,
  targetSchema,
  webhookTokenSchema,
} from '@/modules/crm/schemas';
import { generateWebhookToken } from '@/modules/crm/server/intake';

const paths = ['/admin/crm', '/crm/pipeline', '/crm/dashboard'];

async function logSettings(tx: Tx, orgId: string, actorId: string, area: string, id: string | null) {
  await emitEvent(tx, {
    type: 'crm_settings.updated',
    organizationId: orgId,
    actorId,
    aggregate: { type: 'crm_settings', id },
    payload: { area, id },
  });
}

/** Saves a pipeline and its ordered stages; stages that still hold deals can't be removed (FK restrict). */
export const savePipelineAction = defineAction({
  input: pipelineSchema,
  side: 'agency',
  permission: 'crm:admin',
  async handler({ input, tx, ctx }) {
    const orgId = ctx.organization.id;
    if (input.isDefault)
      await tx
        .update(pipelines)
        .set({ isDefault: false })
        .where(and(eq(pipelines.organizationId, orgId), eq(pipelines.isDefault, true)));
    let pipelineId = input.pipelineId;
    if (pipelineId) {
      const [row] = await tx
        .update(pipelines)
        .set({ name: input.name, isDefault: input.isDefault })
        .where(and(eq(pipelines.id, pipelineId), eq(pipelines.organizationId, orgId)))
        .returning({ id: pipelines.id });
      if (!row) throw new ActionFailure('not_found');
    } else {
      const [row] = await tx
        .insert(pipelines)
        .values({ organizationId: orgId, name: input.name, isDefault: input.isDefault })
        .returning({ id: pipelines.id });
      pipelineId = row!.id;
    }
    const keep = input.stages.map((s) => s.id).filter(Boolean) as string[];
    await tx
      .delete(pipelineStages)
      .where(and(eq(pipelineStages.pipelineId, pipelineId), keep.length ? notInArray(pipelineStages.id, keep) : sql`true`));
    for (const [i, s] of input.stages.entries()) {
      const values = {
        name: s.name,
        kind: s.kind,
        probability: s.kind === 'won' ? 100 : s.kind === 'lost' ? 0 : s.probability,
        sortOrder: i + 1,
      };
      if (s.id)
        await tx
          .update(pipelineStages)
          .set(values)
          .where(and(eq(pipelineStages.id, s.id), eq(pipelineStages.pipelineId, pipelineId)));
      else await tx.insert(pipelineStages).values({ ...values, organizationId: orgId, pipelineId });
    }
    // Keep exactly one default pipeline.
    const [def] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(pipelines)
      .where(and(eq(pipelines.organizationId, orgId), eq(pipelines.isDefault, true)));
    if (!def?.n) await tx.update(pipelines).set({ isDefault: true }).where(eq(pipelines.id, pipelineId));
    await logSettings(tx, orgId, ctx.session.userId, 'pipeline', pipelineId);
    return { pipelineId };
  },
  revalidate: paths,
});

export const deletePipelineAction = defineAction({
  input: idSchema,
  side: 'agency',
  permission: 'crm:admin',
  async handler({ input, tx, ctx }) {
    const [p] = await tx
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.id, input.id), eq(pipelines.organizationId, ctx.organization.id)));
    if (!p) throw new ActionFailure('not_found');
    if (p.isDefault) throw new ActionFailure('conflict');
    // Deals restrict the delete (FK); the error surfaces as `validation`.
    await tx.delete(pipelines).where(eq(pipelines.id, p.id));
    await logSettings(tx, ctx.organization.id, ctx.session.userId, 'pipeline', p.id);
    return { pipelineId: p.id };
  },
  revalidate: paths,
});

export const saveLeadFormAction = defineAction({
  input: leadFormSchema,
  side: 'agency',
  permission: 'crm:admin',
  async handler({ input, tx, ctx }) {
    const values = { name: input.name, isActive: input.isActive, services: input.services, thankYou: input.thankYou };
    let formId = input.formId;
    if (formId) {
      const [row] = await tx
        .update(leadForms)
        .set(values)
        .where(and(eq(leadForms.id, formId), eq(leadForms.organizationId, ctx.organization.id)))
        .returning({ id: leadForms.id });
      if (!row) throw new ActionFailure('not_found');
    } else {
      const [row] = await tx
        .insert(leadForms)
        .values({
          ...values,
          organizationId: ctx.organization.id,
          token: randomBytes(18).toString('base64url'),
          createdBy: ctx.session.userId,
        })
        .returning({ id: leadForms.id });
      formId = row!.id;
    }
    await logSettings(tx, ctx.organization.id, ctx.session.userId, 'lead_form', formId);
    return { formId };
  },
  revalidate: paths,
});

export const deleteLeadFormAction = defineAction({
  input: idSchema,
  side: 'agency',
  permission: 'crm:admin',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .delete(leadForms)
      .where(and(eq(leadForms.id, input.id), eq(leadForms.organizationId, ctx.organization.id)))
      .returning({ id: leadForms.id });
    if (!row) throw new ActionFailure('not_found');
    await logSettings(tx, ctx.organization.id, ctx.session.userId, 'lead_form', row.id);
    return { formId: row.id };
  },
  revalidate: paths,
});

export const saveRuleAction = defineAction({
  input: ruleSchema,
  side: 'agency',
  permission: 'crm:admin',
  async handler({ input, tx, ctx }) {
    const values = {
      name: input.name,
      matchServices: input.matchServices,
      matchCities: input.matchCities,
      matchSources: input.matchSources,
      memberIds: input.memberIds,
      isActive: input.isActive,
    };
    let ruleId = input.ruleId;
    if (ruleId) {
      const [row] = await tx
        .update(leadAssignmentRules)
        .set(values)
        .where(and(eq(leadAssignmentRules.id, ruleId), eq(leadAssignmentRules.organizationId, ctx.organization.id)))
        .returning({ id: leadAssignmentRules.id });
      if (!row) throw new ActionFailure('not_found');
    } else {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`coalesce(max(${leadAssignmentRules.sortOrder}), 0)::int + 1` })
        .from(leadAssignmentRules)
        .where(eq(leadAssignmentRules.organizationId, ctx.organization.id));
      const [row] = await tx
        .insert(leadAssignmentRules)
        .values({ ...values, organizationId: ctx.organization.id, sortOrder: n })
        .returning({ id: leadAssignmentRules.id });
      ruleId = row!.id;
    }
    await logSettings(tx, ctx.organization.id, ctx.session.userId, 'rule', ruleId);
    return { ruleId };
  },
  revalidate: paths,
});

/** Moves a rule one place up (earlier rules win). */
export const moveRuleUpAction = defineAction({
  input: idSchema,
  side: 'agency',
  permission: 'crm:admin',
  async handler({ input, tx, ctx }) {
    const rules = await tx
      .select()
      .from(leadAssignmentRules)
      .where(eq(leadAssignmentRules.organizationId, ctx.organization.id))
      .orderBy(leadAssignmentRules.sortOrder);
    const i = rules.findIndex((r) => r.id === input.id);
    if (i <= 0) return { moved: false };
    const [a, b] = [rules[i - 1]!, rules[i]!];
    await tx.update(leadAssignmentRules).set({ sortOrder: b.sortOrder }).where(eq(leadAssignmentRules.id, a.id));
    await tx.update(leadAssignmentRules).set({ sortOrder: a.sortOrder }).where(eq(leadAssignmentRules.id, b.id));
    await logSettings(tx, ctx.organization.id, ctx.session.userId, 'rule', b.id);
    return { moved: true };
  },
  revalidate: paths,
});

export const deleteRuleAction = defineAction({
  input: idSchema,
  side: 'agency',
  permission: 'crm:admin',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .delete(leadAssignmentRules)
      .where(and(eq(leadAssignmentRules.id, input.id), eq(leadAssignmentRules.organizationId, ctx.organization.id)))
      .returning({ id: leadAssignmentRules.id });
    if (!row) throw new ActionFailure('not_found');
    await logSettings(tx, ctx.organization.id, ctx.session.userId, 'rule', row.id);
    return { ruleId: row.id };
  },
  revalidate: paths,
});

export const saveTargetAction = defineAction({
  input: targetSchema,
  side: 'agency',
  permission: 'crm:admin',
  async handler({ input, tx, ctx }) {
    const month = `${input.month}-01`;
    const owner = input.ownerId;
    await tx
      .delete(salesTargets)
      .where(
        and(
          eq(salesTargets.organizationId, ctx.organization.id),
          eq(salesTargets.month, month),
          owner ? eq(salesTargets.ownerId, owner) : sql`${salesTargets.ownerId} is null`,
        ),
      );
    let id: string | null = null;
    if (input.amountSar > 0) {
      const [row] = await tx
        .insert(salesTargets)
        .values({ organizationId: ctx.organization.id, ownerId: owner, month, amountMinor: Math.round(input.amountSar * 100) })
        .returning({ id: salesTargets.id });
      id = row!.id;
    }
    await logSettings(tx, ctx.organization.id, ctx.session.userId, 'target', id);
    return { targetId: id };
  },
  revalidate: paths,
});

export const saveCrmSettingsAction = defineAction({
  input: crmSettingsSchema,
  side: 'agency',
  permission: 'crm:admin',
  async handler({ input, tx, ctx }) {
    await tx
      .insert(crmSettings)
      .values({ organizationId: ctx.organization.id, ...input })
      .onConflictDoUpdate({ target: crmSettings.organizationId, set: input });
    await logSettings(tx, ctx.organization.id, ctx.session.userId, 'general', null);
    return { ok: true };
  },
  revalidate: paths,
});

/** The raw token is shown once; only its SHA-256 is stored (CLAUDE.md §8.7). */
export const createWebhookTokenAction = defineAction({
  input: webhookTokenSchema,
  side: 'agency',
  permission: 'crm:admin',
  async handler({ input, tx, ctx }) {
    const { token, hash } = generateWebhookToken();
    const [row] = await tx
      .insert(crmWebhookTokens)
      .values({ organizationId: ctx.organization.id, name: input.name, tokenHash: hash, createdBy: ctx.session.userId })
      .returning({ id: crmWebhookTokens.id });
    await logSettings(tx, ctx.organization.id, ctx.session.userId, 'webhook_token', row!.id);
    return { tokenId: row!.id, token };
  },
  revalidate: paths,
});

export const revokeWebhookTokenAction = defineAction({
  input: idSchema,
  side: 'agency',
  permission: 'crm:admin',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .update(crmWebhookTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(crmWebhookTokens.id, input.id), eq(crmWebhookTokens.organizationId, ctx.organization.id)))
      .returning({ id: crmWebhookTokens.id });
    if (!row) throw new ActionFailure('not_found');
    await logSettings(tx, ctx.organization.id, ctx.session.userId, 'webhook_token', row.id);
    return { tokenId: row.id };
  },
  revalidate: paths,
});
