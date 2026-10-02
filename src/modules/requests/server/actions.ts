'use server';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { ClientContext } from '@/lib/auth/context';
import type { Tx } from '@/lib/db/client';
import { comments, files, requestAttachments, requestTypes, requests, threadReads, threads } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { can } from '@/lib/permissions/can';
import { canTransition, triageOnlyTargets, type RequestStatus } from '@/modules/requests/constants';
import { briefFileIds, validateBrief, type RequestFormField } from '@/modules/requests/form-schema';
import {
  changeStatusSchema,
  requestDraftSchema,
  requestTitleSchema,
  saveTypeFormSchema,
  triageSchema,
  typeSettingsSchema,
  type RequestDraftInput,
} from '@/modules/requests/schemas';
import { getRequest, type RequestDetail } from '@/modules/requests/server/queries';

// ---------------------------------------------------------------------------
// Request types (agency, request_types:manage)
// ---------------------------------------------------------------------------

const starterFields: RequestFormField[] = [
  {
    id: 'details',
    type: 'long_text',
    label: { ar: 'تفاصيل الطلب', en: 'Request details' },
    help: { ar: 'اشرح ما تحتاجه بالتفصيل.', en: 'Describe what you need in detail.' },
    required: true,
  },
];

function typeKey(name: { ar: string; en: string }) {
  const base = name.en
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'type'}-${crypto.randomUUID().slice(0, 6)}`;
}

export const createRequestTypeAction = defineAction({
  input: typeSettingsSchema,
  side: 'agency',
  permission: 'request_types:manage',
  async handler({ input, tx, ctx }) {
    const [{ n }] = (await tx.execute<{ n: number }>(
      sql`select coalesce(max(sort_order), 0)::int + 1 as n from public.request_types`,
    )) as unknown as [{ n: number }];
    const [row] = await tx
      .insert(requestTypes)
      .values({
        organizationId: ctx.organization.id,
        key: typeKey(input.name),
        ...input,
        formSchema: { fields: starterFields },
        sortOrder: n,
        createdBy: ctx.session.userId,
      })
      .returning({ id: requestTypes.id });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'request_type.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request_type', id: row.id },
      payload: { typeId: row.id },
    });
    return { typeId: row.id };
  },
  revalidate: ['/admin/request-types'],
});

export const updateRequestTypeAction = defineAction({
  input: typeSettingsSchema.extend({ typeId: z.uuid() }),
  side: 'agency',
  permission: 'request_types:manage',
  async handler({ input, tx, ctx }) {
    const { typeId, ...patch } = input;
    const [row] = await tx.update(requestTypes).set(patch).where(eq(requestTypes.id, typeId)).returning({ id: requestTypes.id });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'request_type.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request_type', id: typeId },
      payload: { typeId, fields: Object.keys(patch) },
    });
    return { typeId };
  },
  revalidate: (input) => ['/admin/request-types', `/admin/request-types/${input.typeId}`, '/portal/requests'],
});

/** Saves the brief form. The DB bumps `schema_version`; submitted requests keep their own snapshot. */
export const saveRequestTypeFormAction = defineAction({
  input: saveTypeFormSchema,
  side: 'agency',
  permission: 'request_types:manage',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .update(requestTypes)
      .set({ formSchema: input.formSchema as { fields: RequestFormField[] } })
      .where(eq(requestTypes.id, input.typeId))
      .returning({ id: requestTypes.id, schemaVersion: requestTypes.schemaVersion });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'request_type.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request_type', id: input.typeId },
      payload: { typeId: input.typeId, fields: ['form_schema'] },
    });
    return row;
  },
  revalidate: (input) => ['/admin/request-types', `/admin/request-types/${input.typeId}`, '/portal/requests'],
});

// ---------------------------------------------------------------------------
// Client: drafts, submission, needs-info updates
// ---------------------------------------------------------------------------

function clientOnly(ctx: { side: string; permissions: ReadonlySet<string> }) {
  if (ctx.side !== 'client' || !can(ctx.permissions, 'portal_requests:create')) throw new ActionFailure('forbidden');
}

function normalizeLinks(links: string[], strict: boolean) {
  const out: string[] = [];
  for (const raw of links) {
    const v = raw.trim();
    if (!v) continue;
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    if (z.url().safeParse(url).success) out.push(url);
    else if (strict) throw new ActionFailure('validation', { referenceLinks: ['invalid_url'] });
  }
  return [...new Set(out)];
}

/** Links general attachments and brief-field files to the request (only the caller's own client uploads). */
async function syncAttachments(tx: Tx, ctx: ClientContext, requestId: string, entries: { fileId: string; fieldId: string | null }[]) {
  const ids = [...new Set(entries.map((e) => e.fileId))];
  if (ids.length) {
    const owned = await tx
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          inArray(files.id, ids),
          eq(files.uploadedBy, ctx.session.userId),
          eq(files.clientId, ctx.client.id),
          eq(files.source, 'attachment'),
          eq(files.visibility, 'client'),
          isNull(files.deletedAt),
        ),
      );
    if (owned.length !== ids.length) throw new ActionFailure('forbidden');
  }
  // Attachment rows are immutable (no UPDATE grant): drop rows that changed or went away, insert the new ones.
  const wanted = new Map(entries.map((e) => [e.fileId, e.fieldId]));
  const existing = await tx
    .select({ fileId: requestAttachments.fileId, fieldId: requestAttachments.fieldId })
    .from(requestAttachments)
    .where(eq(requestAttachments.requestId, requestId));
  const stale = existing.filter((r) => !wanted.has(r.fileId) || wanted.get(r.fileId) !== r.fieldId).map((r) => r.fileId);
  if (stale.length) {
    await tx.delete(requestAttachments).where(and(eq(requestAttachments.requestId, requestId), inArray(requestAttachments.fileId, stale)));
  }
  const kept = new Set(existing.map((r) => r.fileId).filter((id) => !stale.includes(id)));
  const fresh = [...wanted].filter(([fileId]) => !kept.has(fileId));
  if (fresh.length) {
    await tx
      .insert(requestAttachments)
      .values(
        fresh.map(([fileId, fieldId]) => ({ requestId, fileId, fieldId, organizationId: ctx.organization.id, clientId: ctx.client.id })),
      );
  }
}

async function activeType(tx: Tx, typeId: string) {
  const [type] = await tx
    .select()
    .from(requestTypes)
    .where(and(eq(requestTypes.id, typeId), eq(requestTypes.isActive, true)));
  if (!type) throw new ActionFailure('request_type_inactive');
  return type;
}

function briefErrors(errors: Record<string, string>) {
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [`brief.${k}`, [v]]));
}

/** Writes the draft row (insert or update) with a brief validated in the given mode. */
async function writeDraft(tx: Tx, ctx: ClientContext, input: RequestDraftInput, mode: 'draft' | 'submit') {
  const type = await activeType(tx, input.typeId);
  const fields = type.formSchema.fields ?? [];
  const result = validateBrief(fields, input.brief, mode);
  const fieldErrors: Record<string, string[]> = result.ok ? {} : briefErrors(result.errors);
  if (mode === 'submit') {
    const title = requestTitleSchema.safeParse(input.title);
    if (!title.success) fieldErrors.title = [title.error.issues[0]!.message];
  }
  if (Object.keys(fieldErrors).length) throw new ActionFailure('validation', fieldErrors);
  const values = {
    requestTypeId: type.id,
    title: input.title,
    brief: result.data,
    referenceLinks: normalizeLinks(input.referenceLinks, mode === 'submit'),
    desiredDate: input.desiredDate || null,
    priority: input.priority,
  };

  let requestId = input.requestId;
  if (requestId) {
    const [row] = await tx
      .update(requests)
      .set(values)
      .where(and(eq(requests.id, requestId), eq(requests.status, 'draft'), eq(requests.createdBy, ctx.session.userId)))
      .returning({ id: requests.id });
    if (!row) throw new ActionFailure('not_found');
  } else {
    const [row] = await tx
      .insert(requests)
      .values({ ...values, organizationId: ctx.organization.id, clientId: ctx.client.id, status: 'draft', createdBy: ctx.session.userId })
      .returning({ id: requests.id });
    if (!row) throw new ActionFailure('forbidden');
    requestId = row.id;
  }
  await syncAttachments(tx, ctx, requestId, [
    ...input.attachmentIds.map((fileId) => ({ fileId, fieldId: null })),
    ...briefFileIds(fields, result.data),
  ]);
  return { requestId, type };
}

export const saveRequestDraftAction = defineAction({
  input: requestDraftSchema,
  side: 'client',
  rateLimit: { key: 'request_draft', max: 300, windowSeconds: 3600 },
  async handler({ input, tx, ctx }) {
    clientOnly(ctx);
    const { requestId } = await writeDraft(tx, ctx, input, 'draft');
    return { requestId };
  },
  revalidate: ['/portal/requests'],
});

export const submitRequestAction = defineAction({
  input: requestDraftSchema,
  side: 'client',
  rateLimit: { key: 'request_submit', max: 30, windowSeconds: 3600 },
  async handler({ input, tx, ctx }) {
    clientOnly(ctx);
    const { requestId, type } = await writeDraft(tx, ctx, input, 'submit');
    // The trigger numbers it, sets the due date and the "extra" flag, and opens the discussion thread.
    const [row] = await tx
      .update(requests)
      .set({ status: 'submitted' })
      .where(eq(requests.id, requestId))
      .returning({ reference: requests.reference, isExtra: requests.isExtra });
    if (!row) throw new ActionFailure('forbidden');
    const [thread] = await tx
      .select({ id: threads.id })
      .from(threads)
      .where(and(eq(threads.subjectType, 'request'), eq(threads.subjectId, requestId)));
    if (thread) {
      await tx
        .insert(threadReads)
        .values({ threadId: thread.id, userId: ctx.session.userId, organizationId: ctx.organization.id, clientId: ctx.client.id })
        .onConflictDoNothing();
    }
    await emitEvent(tx, {
      type: 'request.submitted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request', id: requestId },
      clientId: ctx.client.id,
      payload: { requestId, clientId: ctx.client.id, reference: row.reference ?? '', typeId: type.id, isExtra: row.isExtra },
    });
    return { requestId, reference: row.reference ?? '', isExtra: row.isExtra };
  },
  revalidate: ['/requests', '/portal/requests', '/portal'],
});

/** Needs info → the client edits the brief (against the snapshot it was submitted with) and sends it back for review. */
export const resubmitRequestAction = defineAction({
  input: requestDraftSchema.extend({ requestId: z.uuid(), note: z.string().trim().max(2000).optional() }),
  side: 'client',
  async handler({ input, tx, ctx }) {
    clientOnly(ctx);
    const [current] = await tx.select().from(requests).where(eq(requests.id, input.requestId));
    if (!current || current.clientId !== ctx.client.id) throw new ActionFailure('not_found');
    if (current.status !== 'needs_info') throw new ActionFailure('invalid_transition');
    const fields = current.formSnapshot;
    const result = validateBrief(fields, input.brief, 'submit');
    const fieldErrors: Record<string, string[]> = result.ok ? {} : briefErrors(result.errors);
    const title = requestTitleSchema.safeParse(input.title);
    if (!title.success) fieldErrors.title = [title.error.issues[0]!.message];
    if (Object.keys(fieldErrors).length) throw new ActionFailure('validation', fieldErrors);
    await tx.execute(sql`select set_config('app.transition_reason', ${input.note ?? ''}, true)`);
    const [row] = await tx
      .update(requests)
      .set({
        title: input.title,
        brief: result.data,
        referenceLinks: normalizeLinks(input.referenceLinks, true),
        desiredDate: input.desiredDate || null,
        priority: input.priority,
        status: 'under_review',
      })
      .where(eq(requests.id, current.id))
      .returning({ id: requests.id });
    if (!row) throw new ActionFailure('forbidden');
    await syncAttachments(tx, ctx, current.id, [
      ...input.attachmentIds.map((fileId) => ({ fileId, fieldId: null })),
      ...briefFileIds(fields, result.data),
    ]);
    if (input.note) await postToThread(tx, ctx.organization.id, current.clientId, current.id, ctx.session.userId, 'client', input.note);
    await emitEvent(tx, {
      type: 'request.brief_updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request', id: current.id },
      clientId: current.clientId,
      payload: { requestId: current.id, clientId: current.clientId },
    });
    await emitEvent(tx, {
      type: 'request.status_changed',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request', id: current.id },
      clientId: current.clientId,
      payload: { requestId: current.id, clientId: current.clientId, from: 'needs_info', to: 'under_review', reason: input.note ?? null },
    });
    return { requestId: current.id };
  },
  revalidate: (input) => [
    '/requests',
    `/requests/${input.requestId}`,
    '/portal/requests',
    `/portal/requests/${input.requestId}`,
    '/portal',
  ],
});

export const deleteDraftAction = defineAction({
  input: z.object({ requestId: z.uuid() }),
  side: 'client',
  async handler({ input, tx, ctx }) {
    clientOnly(ctx);
    const [row] = await tx
      .delete(requests)
      .where(and(eq(requests.id, input.requestId), eq(requests.status, 'draft'), eq(requests.createdBy, ctx.session.userId)))
      .returning({ id: requests.id });
    if (!row) throw new ActionFailure('not_found');
    return null;
  },
  revalidate: ['/portal/requests'],
});

// ---------------------------------------------------------------------------
// Lifecycle & triage
// ---------------------------------------------------------------------------

/**
 * A reason / note that goes with a transition is also posted to the discussion so the conversation stays in one
 * place. No `comment.created` event: the status notification already carries it (no double emails).
 */
async function postToThread(
  tx: Tx,
  orgId: string,
  clientId: string,
  requestId: string,
  authorId: string,
  side: 'agency' | 'client',
  body: string,
) {
  const [thread] = await tx
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.subjectType, 'request'), eq(threads.subjectId, requestId)));
  if (!thread) return;
  await tx
    .insert(comments)
    .values({ organizationId: orgId, clientId, threadId: thread.id, authorId, authorSide: side, body, visibility: 'client' });
}

/** Moves a request through its lifecycle; the DB enforces the same per-role rules and required reasons. */
export const changeRequestStatusAction = defineAction({
  input: changeStatusSchema,
  side: 'any',
  async handler({ input, tx, ctx }) {
    const [current] = await tx.select().from(requests).where(eq(requests.id, input.requestId));
    if (!current) throw new ActionFailure('not_found');
    const from = current.status as RequestStatus;
    if (ctx.side === 'client') {
      if (current.clientId !== ctx.client.id || !can(ctx.permissions, 'portal_requests:create')) throw new ActionFailure('forbidden');
    } else {
      const triage = can(ctx.permissions, 'requests:triage');
      const assignee = can(ctx.permissions, 'requests:update') && current.assigneeId === ctx.session.userId;
      if (!triage && !(assignee && !triageOnlyTargets.includes(input.status))) throw new ActionFailure('forbidden');
    }
    if (from === 'draft' || !canTransition(ctx.side, from, input.status)) throw new ActionFailure('invalid_transition');

    await tx.execute(sql`select set_config('app.transition_reason', ${input.reason ?? ''}, true)`);
    const [row] = await tx.update(requests).set({ status: input.status }).where(eq(requests.id, current.id)).returning({ id: requests.id });
    if (!row) throw new ActionFailure('forbidden');
    if (input.reason) await postToThread(tx, ctx.organization.id, current.clientId, current.id, ctx.session.userId, ctx.side, input.reason);
    await emitEvent(tx, {
      type: 'request.status_changed',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request', id: current.id },
      clientId: current.clientId,
      payload: { requestId: current.id, clientId: current.clientId, from, to: input.status, reason: input.reason ?? null },
    });
    return { requestId: current.id, status: input.status };
  },
  revalidate: (_i, r) => ['/requests', `/requests/${r.requestId}`, '/portal/requests', `/portal/requests/${r.requestId}`, '/portal'],
});

/** Assign, prioritize, set due date and billing flags on one or many requests (inbox bulk actions and the detail panel). */
export const triageRequestsAction = defineAction({
  input: triageSchema,
  side: 'agency',
  permission: 'requests:triage',
  async handler({ input, tx, ctx }) {
    const rows = await tx.select().from(requests).where(inArray(requests.id, input.requestIds));
    if (rows.length !== input.requestIds.length) throw new ActionFailure('not_found');
    let updated = 0;
    for (const current of rows) {
      const patch: Partial<typeof requests.$inferInsert> = {};
      if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) patch.assigneeId = input.assigneeId;
      if (input.priority !== undefined && input.priority !== current.priority) patch.priority = input.priority;
      if (input.dueDate !== undefined && input.dueDate !== current.dueDate) patch.dueDate = input.dueDate;
      if (input.isExtra !== undefined && input.isExtra !== current.isExtra) patch.isExtra = input.isExtra;
      if (input.isBillable !== undefined && input.isBillable !== current.isBillable) patch.isBillable = input.isBillable;
      const changed = Object.keys(patch);
      if (!changed.length) continue;
      const [row] = await tx.update(requests).set(patch).where(eq(requests.id, current.id)).returning({ id: requests.id });
      if (!row) throw new ActionFailure('forbidden');
      updated++;
      if ('assigneeId' in patch) {
        await emitEvent(tx, {
          type: 'request.assigned',
          organizationId: ctx.organization.id,
          actorId: ctx.session.userId,
          aggregate: { type: 'request', id: current.id },
          clientId: current.clientId,
          payload: {
            requestId: current.id,
            clientId: current.clientId,
            assigneeId: patch.assigneeId ?? null,
            previousAssigneeId: current.assigneeId,
          },
        });
      }
      const other = changed.filter((k) => k !== 'assigneeId');
      if (other.length) {
        await emitEvent(tx, {
          type: 'request.triaged',
          organizationId: ctx.organization.id,
          actorId: ctx.session.userId,
          aggregate: { type: 'request', id: current.id },
          clientId: current.clientId,
          payload: { requestId: current.id, clientId: current.clientId, fields: other },
        });
      }
    }
    return { updated };
  },
  revalidate: (input) => ['/requests', ...input.requestIds.map((id) => `/requests/${id}`), '/portal/requests'],
});

/** Inbox quick-preview drawer: the request with its brief (RLS-scoped read). */
export const previewRequestAction = defineAction({
  input: z.object({ requestId: z.uuid() }),
  side: 'agency',
  permission: 'requests:read',
  async handler({ input }): Promise<RequestDetail> {
    const request = await getRequest(input.requestId);
    if (!request) throw new ActionFailure('not_found');
    return request;
  },
});
