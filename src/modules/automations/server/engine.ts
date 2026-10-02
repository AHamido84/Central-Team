import 'server-only';

import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';

import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';

import { dbAdmin, type Tx } from '@/lib/db/client';
import {
  automationRuns,
  automations,
  campaigns,
  clients,
  dealContacts,
  deals,
  deliverables,
  domainEvents,
  integrationConnections,
  leads,
  organizationMembers,
  organizations,
  pipelineStages,
  requests,
  taskMembers,
  taskStatuses,
  tasks,
  whatsappTemplates,
} from '@/lib/db/schema';
import { automationCause, emitEvent } from '@/lib/events/emit';
import { defineConsumer, type StoredEvent } from '@/lib/events/dispatcher';
import type { DomainEventType } from '@/lib/events/registry';
import { localized } from '@/lib/i18n/localized';
import {
  actionSubjects,
  MAX_RUNS_PER_HOUR,
  settableStatuses,
  triggerDefinition,
  triggerTypes,
  type Subject,
} from '@/modules/automations/constants';
import {
  checkWebhookUrl,
  evaluateConditions,
  isPrivateAddress,
  loopGuard,
  pickRoundRobin,
  renderText,
  type ContextValues,
} from '@/modules/automations/engine-core';
import { actionSchema, conditionSchema } from '@/modules/automations/schemas';
import type { ActionResult, AutomationAction } from '@/modules/automations/types';
import { dealReference, leadReference } from '@/modules/crm/constants';
import { normalizePhone } from '@/modules/crm/leads';
import { signingSecret } from '@/modules/integrations/providers';
import { sendWhatsApp } from '@/modules/integrations/server/whatsapp';
import { notify } from '@/modules/notifications/server/notify';
import { canTransition, type RequestStatus } from '@/modules/requests/constants';
import { addDays, dayInZone, taskReference } from '@/modules/tasks/constants';

type Automation = typeof automations.$inferSelect;
type Run = typeof automationRuns.$inferSelect;
type AnyEvent = StoredEvent<DomainEventType>;

/** Attempts per run before it is recorded as failed and the managers are told (the dispatcher backs off between). */
export const MAX_RUN_ATTEMPTS = 3;

/** What the rule is about, re-read from the database when it runs. */
export type RuleContext = {
  subject: Subject;
  subjectId: string | null;
  clientId: string | null;
  ownerIds: string[];
  phone: string | null;
  link: string;
  leadId: string | null;
  dealId: string | null;
  values: ContextValues;
};

const payloadOf = (event: AnyEvent) => event.payload as unknown as Record<string, unknown>;

function eventValues(event: AnyEvent): ContextValues {
  const out: ContextValues = { 'event.type': event.type };
  for (const [k, v] of Object.entries(payloadOf(event))) {
    const key = `event.${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[key] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out[key] = v as string[];
  }
  return out;
}

async function clientName(clientId: string | null): Promise<string | null> {
  if (!clientId) return null;
  const [c] = await dbAdmin.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId));
  return c ? localized(c.name, 'ar') : null;
}

/** Loads the record the event is about and flattens it into condition / placeholder values. */
export async function loadRuleContext(event: AnyEvent): Promise<RuleContext | null> {
  const def = triggerDefinition(event.type);
  if (!def) return null;
  const p = payloadOf(event);
  const base = eventValues(event);
  const ctx = (c: Omit<RuleContext, 'values'> & { values: ContextValues }): RuleContext => ({ ...c, values: { ...base, ...c.values } });

  switch (def.subject) {
    case 'lead': {
      const [l] = await dbAdmin
        .select()
        .from(leads)
        .where(eq(leads.id, String(p.leadId)));
      if (!l) return null;
      return ctx({
        subject: 'lead',
        subjectId: l.id,
        clientId: null,
        ownerIds: l.ownerId ? [l.ownerId] : [],
        phone: l.phone,
        link: `/crm/leads/${l.id}`,
        leadId: l.id,
        dealId: null,
        values: {
          'lead.full_name': l.fullName,
          'lead.reference': leadReference(l.number),
          'lead.company': l.company,
          'lead.phone': l.phone,
          'lead.email': l.email,
          'lead.source': l.source,
          'lead.source_detail': l.sourceDetail,
          'lead.city': l.city,
          'lead.services': l.services,
          'lead.budget_range': l.budgetRange,
          'lead.score': l.score,
          'lead.status': l.status,
          'lead.owner_id': l.ownerId,
        },
      });
    }
    case 'deal': {
      const [row] = await dbAdmin
        .select({ d: deals, stage: pipelineStages.name, leadPhone: leads.phone })
        .from(deals)
        .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
        .leftJoin(leads, eq(leads.id, deals.leadId))
        .where(eq(deals.id, String(p.dealId)));
      if (!row) return null;
      const [contact] = await dbAdmin
        .select({ phone: dealContacts.phone, name: dealContacts.fullName })
        .from(dealContacts)
        .where(eq(dealContacts.dealId, row.d.id))
        .orderBy(desc(dealContacts.isPrimary))
        .limit(1);
      const d = row.d;
      return ctx({
        subject: 'deal',
        subjectId: d.id,
        clientId: d.clientId,
        ownerIds: d.ownerId ? [d.ownerId] : [],
        phone: normalizePhone(contact?.phone) ?? row.leadPhone,
        link: `/crm/deals/${d.id}`,
        leadId: null,
        dealId: d.id,
        values: {
          'deal.title': d.title,
          'deal.reference': dealReference(d.number),
          'deal.company': d.company,
          'deal.contact_name': contact?.name ?? null,
          'deal.status': d.status,
          'deal.stage': localized(row.stage, 'en'),
          'deal.value_sar': Math.round(d.valueMinor / 100),
          'deal.probability': d.probability,
          'deal.owner_id': d.ownerId,
        },
      });
    }
    case 'request': {
      const [r] = await dbAdmin
        .select()
        .from(requests)
        .where(eq(requests.id, String(p.requestId)));
      if (!r) return null;
      return ctx({
        subject: 'request',
        subjectId: r.id,
        clientId: r.clientId,
        ownerIds: r.assigneeId ? [r.assigneeId] : [],
        phone: null,
        link: `/requests/${r.id}`,
        leadId: null,
        dealId: null,
        values: {
          'request.title': r.title,
          'request.reference': r.reference,
          'request.client_id': r.clientId,
          'request.client_name': await clientName(r.clientId),
          'request.priority': r.priority,
          'request.status': r.status,
          'request.is_extra': r.isExtra,
          'request.assignee_id': r.assigneeId,
        },
      });
    }
    case 'task': {
      const [t] = await dbAdmin
        .select()
        .from(tasks)
        .where(eq(tasks.id, String(p.taskId)));
      if (!t) return null;
      const members = await dbAdmin
        .select({ userId: taskMembers.userId })
        .from(taskMembers)
        .where(and(eq(taskMembers.taskId, t.id), eq(taskMembers.role, 'assignee')));
      return ctx({
        subject: 'task',
        subjectId: t.id,
        clientId: t.clientId,
        ownerIds: members.map((m) => m.userId),
        phone: null,
        link: `/tasks?task=${t.id}`,
        leadId: null,
        dealId: null,
        values: {
          'task.title': t.title,
          'task.reference': taskReference(t.number),
          'task.client_id': t.clientId,
          'task.client_name': await clientName(t.clientId),
          'task.priority': t.priority,
          'task.status_category': t.statusCategory,
          'task.due_date': t.dueDate,
        },
      });
    }
    case 'campaign': {
      const [c] = await dbAdmin
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, String(p.campaignId)));
      if (!c) return null;
      return ctx({
        subject: 'campaign',
        subjectId: c.id,
        clientId: c.clientId,
        ownerIds: c.ownerId ? [c.ownerId] : [],
        phone: null,
        link: `/campaigns/${c.id}`,
        leadId: null,
        dealId: null,
        values: {
          'campaign.name': c.name,
          'campaign.client_id': c.clientId,
          'campaign.client_name': await clientName(c.clientId),
          'campaign.status': c.status,
          'campaign.health': c.health,
          'campaign.owner_id': c.ownerId,
        },
      });
    }
    case 'deliverable': {
      const [d] = await dbAdmin
        .select()
        .from(deliverables)
        .where(eq(deliverables.id, String(p.deliverableId)));
      if (!d) return null;
      return ctx({
        subject: 'deliverable',
        subjectId: d.id,
        clientId: d.clientId,
        ownerIds: [],
        phone: null,
        link: `/deliverables/${d.id}`,
        leadId: null,
        dealId: null,
        values: {
          'deliverable.title': d.title,
          'deliverable.client_id': d.clientId,
          'deliverable.client_name': await clientName(d.clientId),
        },
      });
    }
    case 'connection': {
      const [c] = await dbAdmin
        .select()
        .from(integrationConnections)
        .where(eq(integrationConnections.id, String(p.connectionId)));
      if (!c) return null;
      return ctx({
        subject: 'connection',
        subjectId: c.id,
        clientId: null,
        ownerIds: c.connectedBy ? [c.connectedBy] : [],
        phone: null,
        link: `/admin/integrations/${c.id}`,
        leadId: null,
        dealId: null,
        values: { 'connection.provider': c.provider, 'connection.name': c.name },
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

type ActionEnv = { automation: Automation; run: Run; event: AnyEvent; rule: RuleContext; dryRun: boolean };

async function activeAgencyMembers(organizationId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await dbAdmin
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        inArray(organizationMembers.userId, ids),
        eq(organizationMembers.status, 'active'),
        eq(organizationMembers.userType, 'agency'),
      ),
    );
  return rows.map((r) => r.userId);
}

/** The per-organization key outbound webhooks are signed with (shown to `automations:manage` in the builder). */
export function webhookSigningKey(organizationId: string): string {
  return createHmac('sha256', signingSecret()).update(`automation-webhook:${organizationId}`).digest('hex');
}

class ActionError extends Error {}

async function runAction(action: AutomationAction, env: ActionEnv): Promise<ActionResult> {
  const { automation, event, rule, dryRun, run } = env;
  const org = automation.organizationId;
  const allowed = actionSubjects[action.type];
  if (allowed !== 'any' && !allowed.includes(rule.subject))
    return { id: action.id, type: action.type, status: 'skipped', error: 'not_applicable' };
  const done = (output: ActionResult['output']): ActionResult => ({
    id: action.id,
    type: action.type,
    status: dryRun ? 'planned' : 'succeeded',
    output,
  });

  switch (action.type) {
    case 'notify': {
      const c = action.config;
      let ids: string[] = [];
      if (c.recipients.includes('owner')) ids.push(...rule.ownerIds);
      if (c.recipients.includes('account_manager') && rule.clientId) {
        const [cl] = await dbAdmin.select({ am: clients.accountManagerId }).from(clients).where(eq(clients.id, rule.clientId));
        if (cl?.am) ids.push(cl.am);
      }
      if (c.recipients.includes('users')) ids.push(...c.userIds);
      ids = await activeAgencyMembers(org, [...new Set(ids)]);
      const title = renderText(c.title, rule.values).slice(0, 200);
      const body = renderText(c.body, rule.values).slice(0, 1000);
      if (!dryRun && ids.length)
        await notify({
          organizationId: org,
          userIds: ids,
          type: 'automation_message',
          params: { title, body },
          link: rule.link,
          actorId: null,
        });
      return done({ notified: ids.length, title });
    }
    case 'assign': {
      const members = await activeAgencyMembers(org, action.config.userIds);
      const ordered = action.config.userIds.filter((id) => members.includes(id));
      const userId = pickRoundRobin(ordered, automation.runCount);
      if (!userId) throw new ActionError('no_assignee');
      if (dryRun) return done({ userId });
      await dbAdmin.transaction(async (tx) => {
        if (rule.subject === 'lead') {
          const [before] = await tx.select({ ownerId: leads.ownerId }).from(leads).where(eq(leads.id, rule.subjectId!));
          if (before?.ownerId === userId) return;
          await tx.update(leads).set({ ownerId: userId }).where(eq(leads.id, rule.subjectId!));
          await emitEvent(tx, {
            type: 'lead.assigned',
            organizationId: org,
            actorId: null,
            aggregate: { type: 'lead', id: rule.subjectId },
            payload: { leadId: rule.subjectId!, ownerId: userId, previousOwnerId: before?.ownerId ?? null, ruleId: null },
          });
        } else if (rule.subject === 'deal') {
          await tx.update(deals).set({ ownerId: userId }).where(eq(deals.id, rule.subjectId!));
          await emitEvent(tx, {
            type: 'deal.updated',
            organizationId: org,
            actorId: null,
            aggregate: { type: 'deal', id: rule.subjectId },
            payload: { dealId: rule.subjectId!, fields: ['ownerId'] },
          });
        } else {
          const [before] = await tx.select({ assigneeId: requests.assigneeId }).from(requests).where(eq(requests.id, rule.subjectId!));
          if (before?.assigneeId === userId) return;
          await tx.update(requests).set({ assigneeId: userId }).where(eq(requests.id, rule.subjectId!));
          await emitEvent(tx, {
            type: 'request.assigned',
            organizationId: org,
            actorId: null,
            aggregate: { type: 'request', id: rule.subjectId },
            clientId: rule.clientId,
            payload: {
              requestId: rule.subjectId!,
              clientId: rule.clientId!,
              assigneeId: userId,
              previousAssigneeId: before?.assigneeId ?? null,
            },
          });
        }
      });
      return done({ userId });
    }
    case 'create_task': {
      if (!rule.clientId) throw new ActionError('no_client');
      const c = action.config;
      const [status] = await dbAdmin
        .select()
        .from(taskStatuses)
        .where(and(eq(taskStatuses.organizationId, org), eq(taskStatuses.isDefault, true)));
      if (!status) throw new ActionError('no_task_status');
      const [o] = await dbAdmin.select({ tz: organizations.defaultTimezone }).from(organizations).where(eq(organizations.id, org));
      const due = addDays(dayInZone(new Date(), o?.tz ?? 'Asia/Riyadh'), c.dueInDays);
      const title = renderText(c.title, rule.values).slice(0, 200) || automation.name;
      if (dryRun) return done({ title, dueDate: due });
      const assignees = await activeAgencyMembers(org, c.assigneeIds);
      const taskId = await dbAdmin.transaction(async (tx) => {
        const id = crypto.randomUUID();
        await tx.insert(tasks).values({
          id,
          organizationId: org,
          clientId: rule.clientId!,
          requestId: rule.subject === 'request' ? rule.subjectId : null,
          title,
          description: renderText(c.description, rule.values).slice(0, 20000),
          statusId: status.id,
          priority: c.priority,
          dueDate: due,
          departmentId: c.departmentId,
        });
        await emitEvent(tx, {
          type: 'task.created',
          organizationId: org,
          actorId: null,
          aggregate: { type: 'task', id },
          clientId: rule.clientId,
          payload: { taskId: id, clientId: rule.clientId!, parentId: null },
        });
        if (assignees.length) {
          await tx
            .insert(taskMembers)
            .values(assignees.map((userId) => ({ taskId: id, userId, role: 'assignee', organizationId: org, clientId: rule.clientId! })))
            .onConflictDoNothing();
          await emitEvent(tx, {
            type: 'task.assigned',
            organizationId: org,
            actorId: null,
            aggregate: { type: 'task', id },
            clientId: rule.clientId,
            payload: { taskId: id, clientId: rule.clientId!, userIds: assignees },
          });
        }
        return id;
      });
      return done({ taskId, title });
    }
    case 'change_status': {
      const to = action.config.status;
      if (rule.subject === 'lead') {
        if (!(settableStatuses.lead as readonly string[]).includes(to)) throw new ActionError('invalid_status');
        if (dryRun) return done({ status: to });
        await dbAdmin.transaction(async (tx) => {
          const [l] = await tx.select({ status: leads.status }).from(leads).where(eq(leads.id, rule.subjectId!));
          if (!l || l.status === to || l.status === 'converted' || l.status === 'merged') return;
          await tx.update(leads).set({ status: to }).where(eq(leads.id, rule.subjectId!));
          await emitEvent(tx, {
            type: 'lead.updated',
            organizationId: org,
            actorId: null,
            aggregate: { type: 'lead', id: rule.subjectId },
            payload: { leadId: rule.subjectId!, fields: ['status'] },
          });
        });
        return done({ status: to });
      }
      if (rule.subject === 'request') {
        if (!(settableStatuses.request as readonly string[]).includes(to)) throw new ActionError('invalid_status');
        const [r] = await dbAdmin.select({ status: requests.status }).from(requests).where(eq(requests.id, rule.subjectId!));
        if (!r) throw new ActionError('not_found');
        if (r.status === to) return { id: action.id, type: action.type, status: 'skipped', error: 'already_in_status' };
        if (!canTransition('agency', r.status as RequestStatus, to as RequestStatus)) throw new ActionError('invalid_transition');
        if (dryRun) return done({ from: r.status, status: to });
        await dbAdmin.transaction(async (tx) => {
          await tx.update(requests).set({ status: to }).where(eq(requests.id, rule.subjectId!));
          await emitEvent(tx, {
            type: 'request.status_changed',
            organizationId: org,
            actorId: null,
            aggregate: { type: 'request', id: rule.subjectId },
            clientId: rule.clientId,
            payload: { requestId: rule.subjectId!, clientId: rule.clientId!, from: r.status, to, reason: null },
          });
        });
        return done({ from: r.status, status: to });
      }
      if (rule.subject === 'task') {
        if (!(settableStatuses.task as readonly string[]).includes(to)) throw new ActionError('invalid_status');
        const [target] = await dbAdmin
          .select()
          .from(taskStatuses)
          .where(and(eq(taskStatuses.organizationId, org), eq(taskStatuses.category, to)))
          .orderBy(asc(taskStatuses.sortOrder))
          .limit(1);
        if (!target) throw new ActionError('invalid_status');
        if (dryRun) return done({ status: to });
        await dbAdmin.transaction(async (tx) => {
          const [t] = await tx
            .select({ statusId: tasks.statusId, category: tasks.statusCategory })
            .from(tasks)
            .where(eq(tasks.id, rule.subjectId!));
          if (!t || t.statusId === target.id) return;
          await tx.update(tasks).set({ statusId: target.id }).where(eq(tasks.id, rule.subjectId!));
          await emitEvent(tx, {
            type: 'task.status_changed',
            organizationId: org,
            actorId: null,
            aggregate: { type: 'task', id: rule.subjectId },
            clientId: rule.clientId,
            payload: { taskId: rule.subjectId!, clientId: rule.clientId!, from: t.category, to },
          });
        });
        return done({ status: to });
      }
      return { id: action.id, type: action.type, status: 'skipped', error: 'not_applicable' };
    }
    case 'send_whatsapp': {
      const c = action.config;
      const to = c.to === 'record' ? rule.phone : normalizePhone(c.phone);
      if (!to) throw new ActionError('no_phone');
      const [template] = await dbAdmin
        .select()
        .from(whatsappTemplates)
        .where(and(eq(whatsappTemplates.id, c.templateId), eq(whatsappTemplates.organizationId, org)));
      if (!template || template.status !== 'approved') throw new ActionError('template_not_approved');
      const params = c.params.map((p) => renderText(p, rule.values).slice(0, 500) || '-');
      if (dryRun) return done({ to, template: template.name, language: template.language });
      const result = await sendWhatsApp({
        organizationId: org,
        template,
        to,
        params,
        purpose: 'automation',
        leadId: rule.leadId,
        dealId: rule.dealId,
        automationRunId: run.id,
      });
      if (result.status === 'failed') throw new ActionError(result.errorCode ?? 'whatsapp_failed');
      return done({ messageId: result.messageId, to });
    }
    case 'webhook': {
      const checked = checkWebhookUrl(action.config.url);
      if (!checked.ok) throw new ActionError('webhook_url_blocked');
      if (dryRun) return done({ url: checked.url.origin });
      const addresses = await lookup(checked.url.hostname, { all: true }).catch(() => []);
      if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new ActionError('webhook_url_blocked');
      const body = JSON.stringify({
        automation: { id: automation.id, name: automation.name },
        event: { id: event.id, type: event.type, occurredAt: event.occurredAt.toISOString(), payload: event.payload },
        subject: { type: rule.subject, id: rule.subjectId },
        data: rule.values,
      });
      const t = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', webhookSigningKey(org)).update(`${t}.${body}`).digest('hex');
      let status = 0;
      try {
        const res = await fetch(checked.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Central-Automations/1.0',
            'x-central-event': event.type,
            'x-central-delivery': run.id,
            'x-central-signature': `t=${t},v1=${signature}`,
          },
          body,
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        });
        status = res.status;
      } catch {
        throw new ActionError('webhook_unreachable');
      }
      if (status < 200 || status >= 300) throw new ActionError(`webhook_http_${status}`);
      return done({ status });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Runs                                                                       */
/* -------------------------------------------------------------------------- */

async function recentRuns(automationId: string): Promise<number> {
  const [row] = await dbAdmin
    .select({ n: sql<number>`count(*)::int` })
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.automationId, automationId),
        eq(automationRuns.dryRun, false),
        inArray(automationRuns.status, ['succeeded', 'failed', 'running']),
        gte(automationRuns.startedAt, new Date(Date.now() - 3_600_000)),
      ),
    );
  return row?.n ?? 0;
}

/** Validates stored JSON again: a rule saved by an older version, or edited in the database, can't run garbage. */
function parseRule(a: Automation) {
  const conditions = a.conditions.map((c) => conditionSchema.parse(c));
  const actions = a.actions.map((x) => actionSchema.parse(x));
  return { conditions, actions };
}

export type RunOutcome = { status: Run['status']; skipReason: Run['skipReason']; runId: string; retry: boolean };

/**
 * Evaluates one rule against one event and runs its actions in order (ADR-071). Real runs are unique per
 * (rule, event): a redelivery resumes the same run and skips actions that already succeeded. A failing action stops
 * the run; the dispatcher retries it with backoff up to `MAX_RUN_ATTEMPTS`, then the run is failed for good and
 * `automation.failed` tells the managers. Dry runs evaluate and plan without side effects.
 */
export async function runAutomation(
  automation: Automation,
  event: AnyEvent,
  opts: { dryRun?: boolean; requestedBy?: string | null } = {},
): Promise<RunOutcome> {
  const dryRun = !!opts.dryRun;
  const skip = async (reason: NonNullable<Run['skipReason']>) => {
    const [row] = await dbAdmin
      .insert(automationRuns)
      .values({
        organizationId: automation.organizationId,
        automationId: automation.id,
        eventId: event.id,
        eventType: event.type,
        dryRun,
        status: 'skipped',
        skipReason: reason,
        depth: event.automationDepth,
        requestedBy: opts.requestedBy ?? null,
        finishedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: automationRuns.id });
    return { status: 'skipped' as const, skipReason: reason, runId: row?.id ?? '', retry: false };
  };

  if (!dryRun) {
    const loop = loopGuard(event, automation.id);
    if (loop) return skip(loop);
  }

  let run: Run | undefined;
  if (dryRun) {
    [run] = await dbAdmin
      .insert(automationRuns)
      .values({
        organizationId: automation.organizationId,
        automationId: automation.id,
        eventId: event.id,
        eventType: event.type,
        dryRun: true,
        depth: event.automationDepth,
        requestedBy: opts.requestedBy ?? null,
      })
      .returning();
  } else {
    [run] = await dbAdmin
      .insert(automationRuns)
      .values({
        organizationId: automation.organizationId,
        automationId: automation.id,
        eventId: event.id,
        eventType: event.type,
        depth: event.automationDepth,
      })
      .onConflictDoNothing()
      .returning();
    if (!run) {
      const [existing] = await dbAdmin
        .select()
        .from(automationRuns)
        .where(and(eq(automationRuns.automationId, automation.id), eq(automationRuns.eventId, event.id), eq(automationRuns.dryRun, false)));
      if (!existing || existing.status === 'succeeded' || existing.status === 'skipped' || existing.attempts >= MAX_RUN_ATTEMPTS)
        return { status: existing?.status ?? 'skipped', skipReason: existing?.skipReason ?? null, runId: existing?.id ?? '', retry: false };
      [run] = await dbAdmin
        .update(automationRuns)
        .set({ attempts: existing.attempts + 1, status: 'running', error: null })
        .where(eq(automationRuns.id, existing.id))
        .returning();
    } else if ((await recentRuns(automation.id)) > MAX_RUNS_PER_HOUR) {
      await dbAdmin
        .update(automationRuns)
        .set({ status: 'skipped', skipReason: 'rate_limited', finishedAt: new Date() })
        .where(eq(automationRuns.id, run.id));
      return { status: 'skipped', skipReason: 'rate_limited', runId: run.id, retry: false };
    }
  }
  const current = run!;

  const finish = async (patch: Partial<Run>) => {
    await dbAdmin
      .update(automationRuns)
      .set({ ...patch, finishedAt: new Date() })
      .where(eq(automationRuns.id, current.id));
  };

  let rule;
  try {
    rule = parseRule(automation);
  } catch {
    await finish({ status: 'failed', error: 'invalid_rule', attempts: MAX_RUN_ATTEMPTS });
    return { status: 'failed', skipReason: null, runId: current.id, retry: false };
  }
  const ctx = await loadRuleContext(event);
  if (!ctx) {
    await finish({ status: 'skipped', skipReason: 'conditions', error: 'record_not_found' });
    return { status: 'skipped', skipReason: 'conditions', runId: current.id, retry: false };
  }
  const evaluation = evaluateConditions(rule.conditions, automation.match as 'all' | 'any', ctx.values);
  if (!evaluation.passed) {
    await finish({ status: 'skipped', skipReason: 'conditions', conditions: evaluation.results });
    return { status: 'skipped', skipReason: 'conditions', runId: current.id, retry: false };
  }

  const previous = new Map((current.actions ?? []).map((r) => [r.id, r]));
  const results: ActionResult[] = [];
  let failed: ActionResult | null = null;
  // Events emitted by the actions carry depth + 1 and this rule in their chain (loop guard).
  await automationCause.run({ depth: event.automationDepth + 1, chain: [...event.automationChain, automation.id] }, async () => {
    for (const action of rule.actions) {
      const before = previous.get(action.id);
      if (!dryRun && before && (before.status === 'succeeded' || before.status === 'skipped')) {
        results.push(before);
        continue;
      }
      if (failed) {
        results.push({ id: action.id, type: action.type, status: 'skipped', error: 'previous_failed' });
        continue;
      }
      try {
        results.push(await runAction(action, { automation, run: current, event, rule: ctx, dryRun }));
      } catch (error) {
        const code = error instanceof ActionError ? error.message : 'action_failed';
        if (!(error instanceof ActionError)) console.error('[automations] action crashed', automation.id, action.type, error);
        failed = { id: action.id, type: action.type, status: 'failed', error: code.slice(0, 120) };
        results.push(failed);
      }
    }
  });

  const failure = failed as ActionResult | null;
  if (dryRun) {
    await finish({
      status: failure ? 'failed' : 'succeeded',
      conditions: evaluation.results,
      actions: results,
      error: failure?.error ?? null,
    });
    return { status: failure ? 'failed' : 'succeeded', skipReason: null, runId: current.id, retry: false };
  }
  const final = !failure || current.attempts >= MAX_RUN_ATTEMPTS;
  await finish({
    status: failure ? 'failed' : 'succeeded',
    conditions: evaluation.results,
    actions: results,
    error: failure?.error ?? null,
  });
  if (final)
    await dbAdmin.transaction(async (tx: Tx) => {
      await tx
        .update(automations)
        .set({
          runCount: sql`${automations.runCount} + 1`,
          failureCount: failure ? sql`${automations.failureCount} + 1` : automations.failureCount,
          lastRunAt: new Date(),
        })
        .where(eq(automations.id, automation.id));
      if (failure)
        await emitEvent(tx, {
          type: 'automation.failed',
          organizationId: automation.organizationId,
          actorId: null,
          aggregate: { type: 'automation', id: automation.id },
          payload: { automationId: automation.id, runId: current.id, error: failure.error ?? 'action_failed' },
        });
    });
  return { status: failure ? 'failed' : 'succeeded', skipReason: null, runId: current.id, retry: !final };
}

/**
 * The engine as an event consumer (ADR-027/028/071): every active rule of the organization whose trigger is this
 * event type. A run that should retry throws, so the dispatcher redelivers with backoff; other rules' completed
 * runs are not repeated (one run per rule × event).
 */
export const automationEngine = defineConsumer({
  name: 'automations.engine',
  types: triggerTypes,
  async handle(event) {
    const rules = await dbAdmin
      .select()
      .from(automations)
      .where(
        and(eq(automations.organizationId, event.organizationId), eq(automations.triggerType, event.type), eq(automations.isActive, true)),
      )
      .orderBy(asc(automations.createdAt));
    const retry: string[] = [];
    for (const rule of rules) {
      const outcome = await runAutomation(rule, event as AnyEvent);
      if (outcome.retry) retry.push(rule.name);
    }
    if (retry.length) throw new Error(`automation retry: ${retry.join(', ')}`);
  },
});

/** A stored event as the engine sees it (dry run against a recent event). */
export async function loadEvent(organizationId: string, eventId: string | null, type: string): Promise<AnyEvent | null> {
  const [row] = await dbAdmin
    .select()
    .from(domainEvents)
    .where(and(eq(domainEvents.organizationId, organizationId), eventId ? eq(domainEvents.id, eventId) : eq(domainEvents.type, type)))
    .orderBy(desc(domainEvents.occurredAt))
    .limit(1);
  if (!row || row.type !== type) return null;
  return {
    id: row.id,
    organizationId: row.organizationId,
    type: row.type as DomainEventType,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    clientId: row.clientId,
    actorId: row.actorId,
    payload: row.payload as never,
    occurredAt: row.occurredAt,
    automationDepth: row.automationDepth,
    automationChain: row.automationChain,
  };
}
