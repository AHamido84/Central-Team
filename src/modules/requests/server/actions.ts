'use server';

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { AppContext } from '@/lib/auth/context';
import type { Tx } from '@/lib/db/client';
import { comments, files, requestAttachments, requestFormVersions, requestForms, requests, threadReads, threads } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { can } from '@/lib/permissions/can';
import { canTransition, clientPriorities, type RequestPriority, type RequestStatus } from '@/modules/requests/constants';
import { buildAnswersSchema, type RequestFormField } from '@/modules/requests/form-schema';
import {
  changeStatusSchema,
  formSettingsSchema,
  saveFormFieldsSchema,
  submitRequestSchema,
  triageSchema,
} from '@/modules/requests/schemas';

// ---------------------------------------------------------------------------
// Forms (agency, request_forms:manage)
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

function formKey(name: { ar: string; en: string }) {
  const base = name.en
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'form'}-${crypto.randomUUID().slice(0, 6)}`;
}

export const createFormAction = defineAction({
  input: formSettingsSchema,
  side: 'agency',
  permission: 'request_forms:manage',
  async handler({ input, tx, ctx }) {
    const formId = crypto.randomUUID();
    const [{ n }] = (await tx.execute<{ n: number }>(
      sql`select coalesce(max(sort_order), 0)::int + 1 as n from public.request_forms`,
    )) as unknown as [{ n: number }];
    await tx.insert(requestForms).values({
      id: formId,
      organizationId: ctx.organization.id,
      key: formKey(input.name),
      ...input,
      status: 'draft',
      sortOrder: n,
      createdBy: ctx.session.userId,
    });
    await tx.insert(requestFormVersions).values({
      organizationId: ctx.organization.id,
      formId,
      version: 1,
      fields: starterFields,
      createdBy: ctx.session.userId,
    });
    await emitEvent(tx, {
      type: 'request_form.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request_form', id: formId },
      payload: { formId },
    });
    return { formId };
  },
  revalidate: ['/admin/request-forms'],
});

export const updateFormSettingsAction = defineAction({
  input: formSettingsSchema.extend({ formId: z.uuid() }),
  side: 'agency',
  permission: 'request_forms:manage',
  async handler({ input, tx, ctx }) {
    const { formId, ...patch } = input;
    const [row] = await tx.update(requestForms).set(patch).where(eq(requestForms.id, formId)).returning({ id: requestForms.id });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'request_form.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request_form', id: formId },
      payload: { formId, fields: Object.keys(patch) },
    });
    return { formId };
  },
  revalidate: (input) => ['/admin/request-forms', `/admin/request-forms/${input.formId}`, '/portal/requests'],
});

async function draftOf(tx: Tx, formId: string) {
  const [draft] = await tx
    .select()
    .from(requestFormVersions)
    .where(and(eq(requestFormVersions.formId, formId), isNull(requestFormVersions.publishedAt)));
  return draft ?? null;
}

async function saveDraft(tx: Tx, ctx: AppContext, formId: string, fields: RequestFormField[]) {
  const [form] = await tx.select({ id: requestForms.id }).from(requestForms).where(eq(requestForms.id, formId));
  if (!form) throw new ActionFailure('not_found');
  const draft = await draftOf(tx, formId);
  if (draft) {
    const [row] = await tx
      .update(requestFormVersions)
      .set({ fields })
      .where(eq(requestFormVersions.id, draft.id))
      .returning({ id: requestFormVersions.id, version: requestFormVersions.version });
    if (!row) throw new ActionFailure('forbidden');
    return row;
  }
  const [latest] = await tx
    .select({ version: requestFormVersions.version })
    .from(requestFormVersions)
    .where(eq(requestFormVersions.formId, formId))
    .orderBy(desc(requestFormVersions.version))
    .limit(1);
  const [row] = await tx
    .insert(requestFormVersions)
    .values({ organizationId: ctx.organization.id, formId, version: (latest?.version ?? 0) + 1, fields, createdBy: ctx.session.userId })
    .returning({ id: requestFormVersions.id, version: requestFormVersions.version });
  if (!row) throw new ActionFailure('forbidden');
  return row;
}

export const saveFormDraftAction = defineAction({
  input: saveFormFieldsSchema,
  side: 'agency',
  permission: 'request_forms:manage',
  async handler({ input, tx, ctx }) {
    const version = await saveDraft(tx, ctx, input.formId, input.fields as RequestFormField[]);
    await emitEvent(tx, {
      type: 'request_form.draft_saved',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request_form', id: input.formId },
      payload: { formId: input.formId, versionId: version.id, version: version.version },
    });
    return version;
  },
  revalidate: (input) => ['/admin/request-forms', `/admin/request-forms/${input.formId}`],
});

/** Saves the fields as the draft and publishes it as the form's new current version. */
export const publishFormAction = defineAction({
  input: saveFormFieldsSchema,
  side: 'agency',
  permission: 'request_forms:manage',
  async handler({ input, tx, ctx }) {
    if (input.fields.length === 0) throw new ActionFailure('validation', { fields: ['fields_min'] });
    const draft = await saveDraft(tx, ctx, input.formId, input.fields as RequestFormField[]);
    await tx.update(requestFormVersions).set({ publishedAt: new Date() }).where(eq(requestFormVersions.id, draft.id));
    const [row] = await tx
      .update(requestForms)
      .set({ currentVersionId: draft.id, status: 'published' })
      .where(eq(requestForms.id, input.formId))
      .returning({ id: requestForms.id });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'request_form.published',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request_form', id: input.formId },
      payload: { formId: input.formId, versionId: draft.id, version: draft.version },
    });
    return draft;
  },
  revalidate: (input) => ['/admin/request-forms', `/admin/request-forms/${input.formId}`, '/portal/requests'],
});

export const discardFormDraftAction = defineAction({
  input: z.object({ formId: z.uuid() }),
  side: 'agency',
  permission: 'request_forms:manage',
  async handler({ input, tx }) {
    const [form] = await tx.select().from(requestForms).where(eq(requestForms.id, input.formId));
    if (!form) throw new ActionFailure('not_found');
    // A form that was never published has nothing to fall back to.
    if (!form.currentVersionId) throw new ActionFailure('conflict');
    await tx.delete(requestFormVersions).where(and(eq(requestFormVersions.formId, input.formId), isNull(requestFormVersions.publishedAt)));
    return null;
  },
  revalidate: (input) => [`/admin/request-forms/${input.formId}`],
});

export const setFormArchivedAction = defineAction({
  input: z.object({ formId: z.uuid(), archived: z.boolean() }),
  side: 'agency',
  permission: 'request_forms:manage',
  async handler({ input, tx, ctx }) {
    const [form] = await tx.select().from(requestForms).where(eq(requestForms.id, input.formId));
    if (!form) throw new ActionFailure('not_found');
    const status = input.archived ? 'archived' : form.currentVersionId ? 'published' : 'draft';
    await tx.update(requestForms).set({ status }).where(eq(requestForms.id, input.formId));
    await emitEvent(tx, {
      type: 'request_form.archived',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request_form', id: input.formId },
      payload: { formId: input.formId, archived: input.archived },
    });
    return { status };
  },
  revalidate: (input) => ['/admin/request-forms', `/admin/request-forms/${input.formId}`, '/portal/requests'],
});

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const submitRequestAction = defineAction({
  input: submitRequestSchema,
  side: 'any',
  rateLimit: { key: 'request_submit', max: 30, windowSeconds: 3600 },
  async handler({ input, tx, ctx }) {
    let clientId: string;
    if (ctx.side === 'client') {
      if (!can(ctx.permissions, 'portal_requests:create')) throw new ActionFailure('forbidden');
      clientId = ctx.client.id;
    } else {
      if (!can(ctx.permissions, 'requests:triage') || !input.clientId) throw new ActionFailure('forbidden');
      clientId = input.clientId;
    }
    // RLS: client users only see published forms; the insert trigger re-checks the version is current.
    const [form] = await tx
      .select({ f: requestForms, v: requestFormVersions })
      .from(requestForms)
      .innerJoin(requestFormVersions, eq(requestFormVersions.id, requestForms.currentVersionId))
      .where(and(eq(requestForms.id, input.formId), eq(requestForms.status, 'published')));
    if (!form) throw new ActionFailure('form_not_published');

    const parsed = buildAnswersSchema(form.v.fields).safeParse(input.answers);
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = `answers.${String(issue.path[0] ?? '')}`;
        (fieldErrors[key] ??= []).push(issue.message);
      }
      throw new ActionFailure('validation', fieldErrors);
    }

    // Client users choose normal or high ("urgent" toggle); the form's default applies otherwise.
    const fallback =
      ctx.side === 'agency'
        ? form.f.defaultPriority
        : clientPriorities.includes(form.f.defaultPriority as RequestPriority)
          ? form.f.defaultPriority
          : 'normal';
    const priority = input.urgent ? 'high' : fallback;
    const [row] = await tx
      .insert(requests)
      .values({
        organizationId: ctx.organization.id,
        clientId,
        formId: form.f.id,
        formVersionId: form.v.id,
        title: input.title,
        answers: parsed.data,
        priority,
        desiredDate: input.desiredDate || null,
        submittedBy: ctx.session.userId,
      })
      .returning({ id: requests.id, number: requests.number });
    if (!row) throw new ActionFailure('forbidden');

    if (input.attachmentIds.length) {
      const owned = await tx
        .select({ id: files.id })
        .from(files)
        .where(
          and(
            inArray(files.id, input.attachmentIds),
            eq(files.uploadedBy, ctx.session.userId),
            eq(files.clientId, clientId),
            eq(files.source, 'attachment'),
            eq(files.visibility, 'client'),
            isNull(files.deletedAt),
          ),
        );
      if (owned.length !== input.attachmentIds.length) throw new ActionFailure('forbidden');
      await tx
        .insert(requestAttachments)
        .values(input.attachmentIds.map((fileId) => ({ requestId: row.id, fileId, organizationId: ctx.organization.id, clientId })));
    }

    // The submitter has "read" their own request conversation.
    const [thread] = await tx
      .select({ id: threads.id })
      .from(threads)
      .where(and(eq(threads.subjectType, 'request'), eq(threads.subjectId, row.id)));
    if (thread) {
      await tx
        .insert(threadReads)
        .values({ threadId: thread.id, userId: ctx.session.userId, organizationId: ctx.organization.id, clientId });
    }

    await emitEvent(tx, {
      type: 'request.submitted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request', id: row.id },
      clientId,
      payload: { requestId: row.id, clientId, number: row.number, formId: form.f.id, side: ctx.side },
    });
    return { requestId: row.id, number: row.number, clientId };
  },
  revalidate: (_input, r) => ['/requests', '/portal/requests', '/portal', `/clients/${r.clientId}`],
});

/** Moves a request through its lifecycle. Client users can only cancel; the DB enforces the same rules. */
export const changeRequestStatusAction = defineAction({
  input: changeStatusSchema,
  side: 'any',
  async handler({ input, tx, ctx }) {
    const [current] = await tx.select().from(requests).where(eq(requests.id, input.requestId));
    if (!current) throw new ActionFailure('not_found');
    const from = current.status as RequestStatus;
    if (from === input.status) return { requestId: current.id, clientId: current.clientId, status: from };
    if (ctx.side === 'client') {
      if (current.clientId !== ctx.client.id || !can(ctx.permissions, 'portal_requests:create')) throw new ActionFailure('forbidden');
    } else if (
      !can(ctx.permissions, 'requests:triage') &&
      !(can(ctx.permissions, 'requests:update') && current.assigneeId === ctx.session.userId)
    ) {
      throw new ActionFailure('forbidden');
    }
    if (!canTransition(ctx.side, from, input.status)) throw new ActionFailure('invalid_transition');

    const [row] = await tx.update(requests).set({ status: input.status }).where(eq(requests.id, current.id)).returning({ id: requests.id });
    if (!row) throw new ActionFailure('forbidden');

    let commentId: string | null = null;
    if (input.message) {
      const [thread] = await tx
        .select({ id: threads.id })
        .from(threads)
        .where(and(eq(threads.subjectType, 'request'), eq(threads.subjectId, current.id)));
      if (thread) {
        commentId = crypto.randomUUID();
        await tx.insert(comments).values({
          id: commentId,
          organizationId: ctx.organization.id,
          clientId: current.clientId,
          threadId: thread.id,
          authorId: ctx.session.userId,
          authorSide: ctx.side,
          body: input.message,
          visibility: 'client',
        });
        await emitEvent(tx, {
          type: 'comment.created',
          organizationId: ctx.organization.id,
          actorId: ctx.session.userId,
          aggregate: { type: 'comment', id: commentId },
          clientId: current.clientId,
          payload: { commentId, threadId: thread.id, clientId: current.clientId, visibility: 'client', mentions: [] },
        });
      }
    }
    await emitEvent(tx, {
      type: 'request.status_changed',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'request', id: current.id },
      clientId: current.clientId,
      payload: { requestId: current.id, clientId: current.clientId, from, to: input.status, commentId },
    });
    return { requestId: current.id, clientId: current.clientId, status: input.status };
  },
  revalidate: (_i, r) => ['/requests', `/requests/${r.requestId}`, '/portal/requests', `/portal/requests/${r.requestId}`, '/portal'],
});

/** Assign and/or prioritize one or many requests (inbox bulk actions and the detail panel). */
export const triageRequestsAction = defineAction({
  input: triageSchema,
  side: 'agency',
  permission: 'requests:triage',
  async handler({ input, tx, ctx }) {
    if (input.assigneeId === undefined && input.priority === undefined) return { updated: 0 };
    const rows = await tx.select().from(requests).where(inArray(requests.id, input.requestIds));
    if (rows.length !== input.requestIds.length) throw new ActionFailure('not_found');
    let updated = 0;
    for (const current of rows) {
      const patch: Partial<typeof requests.$inferInsert> = {};
      if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) patch.assigneeId = input.assigneeId;
      if (input.priority !== undefined && input.priority !== current.priority) patch.priority = input.priority;
      if (Object.keys(patch).length === 0) continue;
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
      if ('priority' in patch) {
        await emitEvent(tx, {
          type: 'request.priority_changed',
          organizationId: ctx.organization.id,
          actorId: ctx.session.userId,
          aggregate: { type: 'request', id: current.id },
          clientId: current.clientId,
          payload: { requestId: current.id, clientId: current.clientId, from: current.priority, to: patch.priority! },
        });
      }
    }
    return { updated };
  },
  revalidate: (input) => ['/requests', ...input.requestIds.map((id) => `/requests/${id}`), '/portal/requests'],
});
