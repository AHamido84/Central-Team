'use server';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import { crmActivities, crmFiles, dealContacts, deals, leads, pipelineStages, quotes } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { can } from '@/lib/permissions/can';
import { CRM_FILES_BUCKET } from '@/lib/storage';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { crmServices, type BudgetRange, type CrmService, type LeadSource } from '@/modules/crm/constants';
import { leadScore, mergeLeads, normalizeEmail, normalizePhone, type MergeableLead } from '@/modules/crm/leads';
import {
  activitySchema,
  assignLeadSchema,
  completeActivitySchema,
  contactSchema,
  convertLeadSchema,
  idSchema,
  importLeadsSchema,
  leadStatusSchema,
  mergeLeadsSchema,
  moveDealSchema,
  saveDealSchema,
  saveLeadSchema,
} from '@/modules/crm/schemas';
import { findDuplicateLeads, insertLead } from '@/modules/crm/server/intake';
import { cities } from '@/modules/clients/constants';

const leadPaths = (id?: string) => ['/crm/leads', '/crm/dashboard', ...(id ? [`/crm/leads/${id}`] : [])];
const dealPaths = (id?: string) => ['/crm/pipeline', '/crm/dashboard', '/crm/follow-ups', ...(id ? [`/crm/deals/${id}`] : [])];

/* -------------------------------------------------------------------------- */
/* Leads                                                                      */
/* -------------------------------------------------------------------------- */

export const saveLeadAction = defineAction({
  input: saveLeadSchema,
  side: 'agency',
  permission: 'leads:manage',
  async handler({ input, tx, ctx }) {
    const orgId = ctx.organization.id;
    const values = {
      fullName: input.fullName,
      company: input.company,
      phone: input.phone,
      email: input.email,
      source: input.source,
      sourceDetail: input.sourceDetail,
      services: input.services,
      budgetRange: input.budgetRange,
      city: input.city,
      tags: input.tags,
      notes: input.notes,
    };
    if (!input.leadId) {
      // Reps own what they create; people who manage everyone's pipeline may pick an owner or leave it to the rules.
      const ownerId = can(ctx.permissions, 'crm:manage_all') ? input.ownerId : (input.ownerId ?? ctx.session.userId);
      const { leadId } = await insertLead(
        tx,
        orgId,
        ctx.session.userId,
        { ...values, ownerId },
        {
          via: 'manual',
          useRules: can(ctx.permissions, 'crm:manage_all') && !input.ownerId,
        },
      );
      return { leadId };
    }
    const [before] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, orgId)));
    if (!before) throw new ActionFailure('not_found');
    const [row] = await tx
      .update(leads)
      .set({ ...values, ownerId: input.ownerId, score: leadScore(values) })
      .where(eq(leads.id, input.leadId))
      .returning({ id: leads.id });
    if (!row) throw new ActionFailure('forbidden');
    const fields = (Object.keys(values) as (keyof typeof values)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(values[k]));
    await emitEvent(tx, {
      type: 'lead.updated',
      organizationId: orgId,
      actorId: ctx.session.userId,
      aggregate: { type: 'lead', id: row.id },
      payload: { leadId: row.id, fields },
    });
    if (before.ownerId !== input.ownerId)
      await emitEvent(tx, {
        type: 'lead.assigned',
        organizationId: orgId,
        actorId: ctx.session.userId,
        aggregate: { type: 'lead', id: row.id },
        payload: { leadId: row.id, ownerId: input.ownerId, previousOwnerId: before.ownerId, ruleId: null },
      });
    return { leadId: row.id };
  },
  revalidate: (_i, r) => leadPaths(r.leadId),
});

export const setLeadStatusAction = defineAction({
  input: leadStatusSchema,
  side: 'agency',
  permission: 'leads:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx.update(leads).set({ status: input.status }).where(eq(leads.id, input.leadId)).returning({ id: leads.id });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'lead.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'lead', id: row.id },
      payload: { leadId: row.id, fields: ['status'] },
    });
    return { leadId: row.id };
  },
  revalidate: (i) => leadPaths(i.leadId),
});

export const assignLeadsAction = defineAction({
  input: assignLeadSchema,
  side: 'agency',
  permission: 'leads:manage',
  async handler({ input, tx, ctx }) {
    const before = await tx.select({ id: leads.id, ownerId: leads.ownerId }).from(leads).where(inArray(leads.id, input.leadIds));
    // RLS: reps may only move their own or unassigned leads, and only to themselves.
    const updated = await tx
      .update(leads)
      .set({ ownerId: input.ownerId })
      .where(inArray(leads.id, input.leadIds))
      .returning({ id: leads.id });
    if (updated.length !== input.leadIds.length) throw new ActionFailure('forbidden');
    for (const b of before)
      if (b.ownerId !== input.ownerId)
        await emitEvent(tx, {
          type: 'lead.assigned',
          organizationId: ctx.organization.id,
          actorId: ctx.session.userId,
          aggregate: { type: 'lead', id: b.id },
          payload: { leadId: b.id, ownerId: input.ownerId, previousOwnerId: b.ownerId, ruleId: null },
        });
    return { count: updated.length };
  },
  revalidate: () => leadPaths(),
});

export const mergeLeadsAction = defineAction({
  input: mergeLeadsSchema,
  side: 'agency',
  permission: 'crm:manage_all',
  async handler({ input, tx, ctx }) {
    const rows = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.organizationId, ctx.organization.id), inArray(leads.id, [input.primaryId, input.otherId])));
    const primary = rows.find((r) => r.id === input.primaryId);
    const other = rows.find((r) => r.id === input.otherId);
    if (!primary || !other || primary.status === 'merged' || other.status === 'merged') throw new ActionFailure('invalid_merge');
    const asMergeable = (l: typeof primary): MergeableLead => ({
      ...l,
      source: l.source as LeadSource,
      budgetRange: l.budgetRange as BudgetRange,
      status: l.status as MergeableLead['status'],
    });
    const merged = mergeLeads(asMergeable(primary), asMergeable(other));
    await tx
      .update(leads)
      .set({
        company: merged.company,
        phone: merged.phone,
        email: merged.email,
        city: merged.city,
        sourceDetail: merged.sourceDetail,
        ownerId: merged.ownerId,
        budgetRange: merged.budgetRange,
        services: merged.services as string[],
        tags: merged.tags as string[],
        notes: merged.notes,
        status: merged.status,
        score: merged.score,
        lastActivityAt: primary.lastActivityAt > other.lastActivityAt ? primary.lastActivityAt : other.lastActivityAt,
      })
      .where(eq(leads.id, primary.id));
    // Everything that hung off the other lead now belongs to the survivor.
    await tx.update(crmActivities).set({ leadId: primary.id }).where(eq(crmActivities.leadId, other.id));
    await tx.update(deals).set({ leadId: primary.id }).where(eq(deals.leadId, other.id));
    await tx.update(leads).set({ status: 'merged', mergedIntoId: primary.id }).where(eq(leads.id, other.id));
    await emitEvent(tx, {
      type: 'lead.merged',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'lead', id: primary.id },
      payload: { leadId: primary.id, mergedId: other.id },
    });
    return { leadId: primary.id };
  },
  revalidate: (i) => [...leadPaths(i.primaryId), `/crm/leads/${i.otherId}`],
});

export const deleteLeadAction = defineAction({
  input: idSchema,
  side: 'agency',
  permission: 'crm:manage_all',
  async handler({ input, tx }) {
    const [row] = await tx.delete(leads).where(eq(leads.id, input.id)).returning({ id: leads.id });
    if (!row) throw new ActionFailure('not_found');
    return { leadId: row.id };
  },
  revalidate: () => leadPaths(),
});

/** Column mapping and parsing happen in the browser; every row is re-validated and normalised here. */
export const importLeadsAction = defineAction({
  input: importLeadsSchema,
  side: 'agency',
  permission: 'leads:manage',
  async handler({ input, tx, ctx }) {
    const orgId = ctx.organization.id;
    const manageAll = can(ctx.permissions, 'crm:manage_all');
    const ownerId = manageAll ? input.ownerId : ctx.session.userId;
    let created = 0;
    let skipped = 0;
    const rejected: number[] = [];
    for (const [i, row] of input.rows.entries()) {
      const phone = normalizePhone(row.phone);
      const email = normalizeEmail(row.email);
      if (!phone && !email) {
        rejected.push(i);
        continue;
      }
      if (input.skipDuplicates && (await findDuplicateLeads(tx, orgId, { phone, email })).length) {
        skipped++;
        continue;
      }
      const city = (cities as readonly string[]).find((c) => c === row.city?.toLowerCase()) ?? null;
      const services = (row.services ?? '')
        .split(/[,;،|]/)
        .map((s) => s.trim().toLowerCase().replace(/\s+/g, '_'))
        .filter((s): s is CrmService => (crmServices as readonly string[]).includes(s));
      await insertLead(
        tx,
        orgId,
        ctx.session.userId,
        {
          fullName: row.fullName,
          company: row.company,
          phone,
          email,
          source: input.source,
          sourceDetail: null,
          services,
          budgetRange: 'unknown',
          city,
          ownerId,
          tags: [],
          notes: row.notes ?? '',
        },
        { via: 'import', useRules: manageAll && input.useRules && !ownerId },
      );
      created++;
    }
    await emitEvent(tx, {
      type: 'leads.imported',
      organizationId: orgId,
      actorId: ctx.session.userId,
      aggregate: { type: 'lead' },
      payload: { count: created, skipped, source: input.source },
    });
    return { created, skipped, rejected };
  },
  revalidate: () => leadPaths(),
});

/** Lead → deal: the deal starts in the pipeline's first open stage and inherits owner, company and source. */
export const convertLeadAction = defineAction({
  input: convertLeadSchema,
  side: 'agency',
  permission: 'deals:manage',
  async handler({ input, tx, ctx }) {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.organizationId, ctx.organization.id)));
    if (!lead || lead.status === 'merged') throw new ActionFailure('not_found');
    const [stage] = await tx
      .select({ id: pipelineStages.id })
      .from(pipelineStages)
      .where(and(eq(pipelineStages.pipelineId, input.pipelineId), eq(pipelineStages.kind, 'open')))
      .orderBy(pipelineStages.sortOrder)
      .limit(1);
    if (!stage) throw new ActionFailure('invalid_stage');
    const [deal] = await tx
      .insert(deals)
      .values({
        organizationId: ctx.organization.id,
        title: input.title,
        leadId: lead.id,
        company: lead.company,
        pipelineId: input.pipelineId,
        stageId: stage.id,
        valueMinor: Math.round(input.valueSar * 100),
        expectedCloseDate: input.expectedCloseDate,
        ownerId: lead.ownerId ?? ctx.session.userId,
        packageId: input.packageId,
        source: lead.source,
      })
      .returning({ id: deals.id, ownerId: deals.ownerId });
    if (!deal) throw new ActionFailure('forbidden');
    await tx.insert(dealContacts).values({
      organizationId: ctx.organization.id,
      dealId: deal.id,
      fullName: lead.fullName,
      phone: lead.phone,
      email: lead.email,
      isPrimary: true,
    });
    await tx.update(leads).set({ status: 'converted' }).where(eq(leads.id, lead.id));
    await emitEvent(tx, {
      type: 'deal.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'deal', id: deal.id },
      payload: { dealId: deal.id, leadId: lead.id, ownerId: deal.ownerId },
    });
    await emitEvent(tx, {
      type: 'lead.converted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'lead', id: lead.id },
      payload: { leadId: lead.id, dealId: deal.id },
    });
    return { dealId: deal.id };
  },
  revalidate: (i, r) => [...leadPaths(i.leadId), ...dealPaths(r.dealId)],
});

/* -------------------------------------------------------------------------- */
/* Deals                                                                      */
/* -------------------------------------------------------------------------- */

export const saveDealAction = defineAction({
  input: saveDealSchema,
  side: 'agency',
  permission: 'deals:manage',
  async handler({ input, tx, ctx }) {
    const orgId = ctx.organization.id;
    const values = {
      title: input.title,
      company: input.company,
      valueMinor: Math.round(input.valueSar * 100),
      expectedCloseDate: input.expectedCloseDate,
      packageId: input.packageId,
    };
    if (!input.dealId) {
      let stageId = input.stageId;
      if (!stageId) {
        const [first] = await tx
          .select({ id: pipelineStages.id })
          .from(pipelineStages)
          .where(and(eq(pipelineStages.pipelineId, input.pipelineId), eq(pipelineStages.kind, 'open')))
          .orderBy(pipelineStages.sortOrder)
          .limit(1);
        stageId = first?.id;
      }
      if (!stageId) throw new ActionFailure('invalid_stage');
      const ownerId = can(ctx.permissions, 'crm:manage_all') ? (input.ownerId ?? ctx.session.userId) : ctx.session.userId;
      const [deal] = await tx
        .insert(deals)
        .values({ ...values, organizationId: orgId, pipelineId: input.pipelineId, stageId, ownerId, leadId: input.leadId })
        .returning({ id: deals.id });
      if (!deal) throw new ActionFailure('forbidden');
      await emitEvent(tx, {
        type: 'deal.created',
        organizationId: orgId,
        actorId: ctx.session.userId,
        aggregate: { type: 'deal', id: deal.id },
        payload: { dealId: deal.id, leadId: input.leadId, ownerId },
      });
      return { dealId: deal.id };
    }
    const [before] = await tx
      .select()
      .from(deals)
      .where(and(eq(deals.id, input.dealId), eq(deals.organizationId, orgId)));
    if (!before) throw new ActionFailure('not_found');
    const [row] = await tx
      .update(deals)
      .set({ ...values, ownerId: input.ownerId, ...(input.probability !== undefined ? { probability: input.probability } : {}) })
      .where(eq(deals.id, input.dealId))
      .returning({ id: deals.id });
    if (!row) throw new ActionFailure('forbidden');
    const changed = Object.entries({ ...values, ownerId: input.ownerId, probability: input.probability ?? before.probability })
      .filter(([k, v]) => JSON.stringify(before[k as keyof typeof before]) !== JSON.stringify(v))
      .map(([k]) => k);
    await emitEvent(tx, {
      type: 'deal.updated',
      organizationId: orgId,
      actorId: ctx.session.userId,
      aggregate: { type: 'deal', id: row.id },
      payload: { dealId: row.id, fields: changed },
    });
    return { dealId: row.id };
  },
  revalidate: (_i, r) => dealPaths(r.dealId),
});

/** Drag & drop and the stage bar. The trigger derives status, probability and won / lost stamps from the stage. */
export const moveDealAction = defineAction({
  input: moveDealSchema,
  side: 'agency',
  permission: 'deals:manage',
  async handler({ input, tx, ctx }) {
    const [before] = await tx
      .select()
      .from(deals)
      .where(and(eq(deals.id, input.dealId), eq(deals.organizationId, ctx.organization.id)));
    if (!before) throw new ActionFailure('not_found');
    if (before.stageId === input.stageId) return { dealId: before.id, status: before.status };
    const [stage] = await tx.select().from(pipelineStages).where(eq(pipelineStages.id, input.stageId));
    if (!stage || stage.pipelineId !== before.pipelineId) throw new ActionFailure('invalid_stage');
    if (stage.kind === 'lost' && !input.lostReason) throw new ActionFailure('reason_required');
    const [row] = await tx
      .update(deals)
      .set({
        stageId: stage.id,
        lostReason: stage.kind === 'lost' ? input.lostReason : null,
        lostNote: stage.kind === 'lost' ? input.lostNote : null,
      })
      .where(eq(deals.id, before.id))
      .returning({ id: deals.id, status: deals.status, valueMinor: deals.valueMinor, ownerId: deals.ownerId });
    if (!row) throw new ActionFailure('forbidden');
    const base = { organizationId: ctx.organization.id, actorId: ctx.session.userId, aggregate: { type: 'deal', id: row.id } };
    await emitEvent(tx, {
      ...base,
      type: 'deal.stage_changed',
      payload: { dealId: row.id, fromStageId: before.stageId, toStageId: stage.id, status: row.status },
    });
    if (row.status === 'won' && before.status !== 'won')
      await emitEvent(tx, { ...base, type: 'deal.won', payload: { dealId: row.id, valueMinor: row.valueMinor, ownerId: row.ownerId } });
    if (row.status === 'lost' && before.status !== 'lost')
      await emitEvent(tx, { ...base, type: 'deal.lost', payload: { dealId: row.id, reason: input.lostReason ?? 'other' } });
    return { dealId: row.id, status: row.status };
  },
  revalidate: (i) => dealPaths(i.dealId),
});

export const deleteDealAction = defineAction({
  input: idSchema,
  side: 'agency',
  permission: 'crm:manage_all',
  async handler({ input, tx }) {
    const [row] = await tx.delete(deals).where(eq(deals.id, input.id)).returning({ id: deals.id });
    if (!row) throw new ActionFailure('forbidden');
    return { dealId: row.id };
  },
  revalidate: () => dealPaths(),
});

export const saveContactAction = defineAction({
  input: contactSchema,
  side: 'agency',
  permission: 'deals:manage',
  async handler({ input, tx, ctx }) {
    if (input.isPrimary)
      await tx
        .update(dealContacts)
        .set({ isPrimary: false })
        .where(and(eq(dealContacts.dealId, input.dealId), eq(dealContacts.isPrimary, true)));
    const values = {
      fullName: input.fullName,
      jobTitle: input.jobTitle,
      phone: input.phone,
      email: input.email,
      isPrimary: input.isPrimary,
    };
    const [row] = input.contactId
      ? await tx
          .update(dealContacts)
          .set(values)
          .where(and(eq(dealContacts.id, input.contactId), eq(dealContacts.dealId, input.dealId)))
          .returning({ id: dealContacts.id })
      : await tx
          .insert(dealContacts)
          .values({ ...values, dealId: input.dealId, organizationId: ctx.organization.id })
          .returning({ id: dealContacts.id });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'deal.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'deal', id: input.dealId },
      payload: { dealId: input.dealId, fields: ['contacts'] },
    });
    return { contactId: row.id };
  },
  revalidate: (i) => dealPaths(i.dealId),
});

export const deleteContactAction = defineAction({
  input: idSchema,
  side: 'agency',
  permission: 'deals:manage',
  async handler({ input, tx }) {
    const [row] = await tx.delete(dealContacts).where(eq(dealContacts.id, input.id)).returning({ dealId: dealContacts.dealId });
    if (!row) throw new ActionFailure('forbidden');
    return { dealId: row.dealId };
  },
  revalidate: (_i, r) => dealPaths(r.dealId),
});

/* -------------------------------------------------------------------------- */
/* Activities                                                                 */
/* -------------------------------------------------------------------------- */

export const saveActivityAction = defineAction({
  input: activitySchema,
  side: 'agency',
  permission: (i) => (i.dealId ? 'deals:manage' : 'leads:manage'),
  async handler({ input, tx, ctx }) {
    const now = new Date();
    const values = {
      type: input.type,
      subject: input.subject,
      body: input.body,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      completedAt: input.done ? now : null,
    };
    if (input.activityId) {
      const [row] = await tx
        .update(crmActivities)
        .set(values)
        .where(and(eq(crmActivities.id, input.activityId), eq(crmActivities.organizationId, ctx.organization.id)))
        .returning({ id: crmActivities.id, leadId: crmActivities.leadId, dealId: crmActivities.dealId });
      if (!row) throw new ActionFailure('forbidden');
      return { activityId: row.id, leadId: row.leadId, dealId: row.dealId };
    }
    // On a deal, remember the lead too so the lead's timeline stays complete.
    let leadId = input.leadId;
    if (input.dealId && !leadId) {
      const [d] = await tx.select({ leadId: deals.leadId }).from(deals).where(eq(deals.id, input.dealId));
      leadId = d?.leadId ?? null;
    }
    const [row] = await tx
      .insert(crmActivities)
      .values({ ...values, organizationId: ctx.organization.id, leadId, dealId: input.dealId, ownerId: ctx.session.userId })
      .returning({ id: crmActivities.id });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'crm_activity.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: input.dealId ? 'deal' : 'lead', id: input.dealId ?? leadId },
      payload: { activityId: row.id, leadId, dealId: input.dealId, type: input.type },
    });
    return { activityId: row.id, leadId, dealId: input.dealId };
  },
  revalidate: (_i, r) => [
    '/crm/follow-ups',
    '/crm/dashboard',
    ...(r.dealId ? [`/crm/deals/${r.dealId}`] : []),
    ...(r.leadId ? [`/crm/leads/${r.leadId}`] : []),
  ],
});

export const completeActivityAction = defineAction({
  input: completeActivitySchema,
  side: 'agency',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .update(crmActivities)
      .set({ completedAt: input.done ? new Date() : null })
      .where(and(eq(crmActivities.id, input.activityId), eq(crmActivities.organizationId, ctx.organization.id)))
      .returning({ id: crmActivities.id, leadId: crmActivities.leadId, dealId: crmActivities.dealId });
    if (!row) throw new ActionFailure('forbidden');
    if (input.done)
      await emitEvent(tx, {
        type: 'crm_activity.completed',
        organizationId: ctx.organization.id,
        actorId: ctx.session.userId,
        aggregate: { type: row.dealId ? 'deal' : 'lead', id: row.dealId ?? row.leadId },
        payload: { activityId: row.id, leadId: row.leadId, dealId: row.dealId },
      });
    return row;
  },
  revalidate: (_i, r) => [
    '/crm/follow-ups',
    ...(r.dealId ? [`/crm/deals/${r.dealId}`] : []),
    ...(r.leadId ? [`/crm/leads/${r.leadId}`] : []),
  ],
});

export const deleteActivityAction = defineAction({
  input: idSchema,
  side: 'agency',
  async handler({ input, tx }) {
    const [row] = await tx
      .delete(crmActivities)
      .where(eq(crmActivities.id, input.id))
      .returning({ leadId: crmActivities.leadId, dealId: crmActivities.dealId });
    if (!row) throw new ActionFailure('forbidden');
    return row;
  },
  revalidate: (_i, r) => [
    '/crm/follow-ups',
    ...(r.dealId ? [`/crm/deals/${r.dealId}`] : []),
    ...(r.leadId ? [`/crm/leads/${r.leadId}`] : []),
  ],
});

export const deleteCrmFileAction = defineAction({
  input: idSchema,
  side: 'agency',
  permission: 'deals:manage',
  async handler({ input, tx }) {
    const [row] = await tx
      .delete(crmFiles)
      .where(eq(crmFiles.id, input.id))
      .returning({ dealId: crmFiles.dealId, path: crmFiles.storagePath });
    if (!row) throw new ActionFailure('forbidden');
    return row;
  },
  async after({ result }) {
    // The row is gone (RLS-checked delete above); remove the object with the service client.
    await supabaseAdmin().storage.from(CRM_FILES_BUCKET).remove([result.path]);
  },
  revalidate: (_i, r) => dealPaths(r.dealId),
});

export const deleteQuoteAction = defineAction({
  input: idSchema,
  side: 'agency',
  permission: 'deals:manage',
  async handler({ input, tx }) {
    const [row] = await tx
      .delete(quotes)
      .where(and(eq(quotes.id, input.id), sql`${quotes.status} = 'draft'`))
      .returning({ dealId: quotes.dealId });
    if (!row) throw new ActionFailure('forbidden');
    return row;
  },
  revalidate: (_i, r) => dealPaths(r.dealId),
});

/** Live duplicate warning while typing a phone or email in the lead form. */
export const findLeadDuplicatesAction = defineAction({
  input: z.object({ phone: z.string().max(40).nullable(), email: z.string().max(200).nullable(), excludeId: z.uuid().optional() }),
  side: 'agency',
  permission: 'leads:read',
  async handler({ input, tx, ctx }) {
    const rows = await findDuplicateLeads(
      tx,
      ctx.organization.id,
      { phone: normalizePhone(input.phone), email: normalizeEmail(input.email) },
      input.excludeId,
    );
    return rows.map((r) => ({ id: r.id, number: r.number, fullName: r.fullName }));
  },
});
