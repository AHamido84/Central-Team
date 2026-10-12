'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import { executiveNotes, executiveSchedules, executiveViews, kpiTargets } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import type { Locale } from '@/lib/i18n/localized';
import { can } from '@/lib/permissions/can';
import { getLocale } from 'next-intl/server';
import { generate } from '@/modules/ai/server/runtime';
import { briefLines, briefPrompt, resolveBriefCitations } from '@/modules/executive/brief';
import { executiveKit } from '@/modules/executive/kit';
import { kpis } from '@/modules/executive/catalog';
import { nextRunOn } from '@/modules/executive/schedule-dates';
import {
  addNoteSchema,
  noteIdSchema,
  pinViewSchema,
  saveTargetsSchema,
  saveViewSchema,
  scheduleIdSchema,
  scheduleSchema,
  viewIdSchema,
  writeBriefSchema,
} from '@/modules/executive/schemas';
import { getExecutiveReport } from '@/modules/executive/server/data';
import { deliverSchedule } from '@/modules/executive/server/schedules';
import { writeSnapshot } from '@/modules/executive/server/snapshots';
import { dayInZone } from '@/modules/tasks/constants';

const currentLocale = async (): Promise<Locale> => ((await getLocale()) === 'en' ? 'en' : 'ar');

/** The AI executive brief: the same numbered fact lines as the rules-based brief, restated by the model with `[n]`. */
export const writeBriefAction = defineAction({
  input: writeBriefSchema,
  side: 'agency',
  permission: 'executive:view',
  rateLimit: { key: 'ai_executive_brief', max: 20, windowSeconds: 300 },
  async handler({ ctx }) {
    if (!can(ctx.permissions, 'ai:use')) throw new ActionFailure('forbidden');
    return { locale: await currentLocale() };
  },
  async complete({ input, prepared, ctx }) {
    // Read as the executive (RLS) — the model only ever sees numbers the reader can see on the page.
    const report = await getExecutiveReport(ctx, input.config);
    const kit = executiveKit(prepared.locale, ctx.organization.defaultTimezone);
    const lines = briefLines(kit, report);
    const period = kit.t('periodRange', {
      from: kit.f.date(`${report.period.from}T12:00:00Z`),
      to: kit.f.date(`${report.period.to}T12:00:00Z`),
    });
    const result = await generate(
      { organizationId: ctx.organization.id, userId: ctx.session.userId },
      briefPrompt(prepared.locale, lines, { period }),
    );
    if (result.stop === 'refusal' || !result.text) throw new ActionFailure('ai_refused');
    return resolveBriefCitations(result.text.slice(0, 4000), lines);
  },
});

/** Replaces a year's targets (RLS: `executive:schedule` or `organization:update`). */
export const saveTargetsAction = defineAction({
  input: saveTargetsSchema,
  side: 'agency',
  async handler({ input, tx, ctx }) {
    if (!can(ctx.permissions, 'executive:schedule') && !can(ctx.permissions, 'organization:update')) throw new ActionFailure('forbidden');
    const orgId = ctx.organization.id;
    await tx.delete(kpiTargets).where(and(eq(kpiTargets.organizationId, orgId), eq(kpiTargets.year, input.year)));
    const rows = input.rows.filter((r) => r.value !== null);
    if (rows.length) {
      await tx.insert(kpiTargets).values(
        rows.map((r) => ({
          organizationId: orgId,
          metric: r.metric,
          year: input.year,
          quarter: r.quarter,
          value: r.value!,
          createdBy: ctx.session.userId,
        })),
      );
    }
    await emitEvent(tx, {
      organizationId: orgId,
      type: 'executive.targets_updated',
      actorId: ctx.session.userId,
      aggregate: { type: 'kpi_targets' },
      payload: { year: input.year, count: rows.length },
    });
    return { year: input.year, count: rows.length };
  },
  revalidate: ['/executive'],
});

// ---------------------------------------------------------------------------
// Saved views (private to their owner; RLS `executive_views_own`)
// ---------------------------------------------------------------------------

export const saveViewAction = defineAction({
  input: saveViewSchema,
  side: 'agency',
  permission: 'executive:view',
  async handler({ input, tx, ctx }) {
    const [row] = await tx
      .insert(executiveViews)
      .values({
        organizationId: ctx.organization.id,
        userId: ctx.session.userId,
        name: input.name,
        config: input.config,
        pinned: input.pinned,
      })
      .returning({ id: executiveViews.id });
    await emitEvent(tx, {
      type: 'executive.view_saved',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'executive_view', id: row!.id },
      payload: { viewId: row!.id, name: input.name },
    });
    return { id: row!.id };
  },
  revalidate: ['/executive'],
});

export const pinViewAction = defineAction({
  input: pinViewSchema,
  side: 'agency',
  permission: 'executive:view',
  async handler({ input, tx }) {
    const [row] = await tx
      .update(executiveViews)
      .set({ pinned: input.pinned })
      .where(eq(executiveViews.id, input.id))
      .returning({ id: executiveViews.id });
    if (!row) throw new ActionFailure('not_found');
    return { id: row.id };
  },
  revalidate: ['/executive'],
});

export const deleteViewAction = defineAction({
  input: viewIdSchema,
  side: 'agency',
  permission: 'executive:view',
  async handler({ input, tx, ctx }) {
    const [row] = await tx.delete(executiveViews).where(eq(executiveViews.id, input.id)).returning({ id: executiveViews.id });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'executive.view_deleted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'executive_view', id: row.id },
      payload: { viewId: row.id },
    });
    return { id: row.id };
  },
  revalidate: ['/executive'],
});

// ---------------------------------------------------------------------------
// Notes on a KPI: the owner is notified (or gets a task) by the event consumer
// ---------------------------------------------------------------------------

export const addNoteAction = defineAction({
  input: addNoteSchema,
  side: 'agency',
  permission: 'executive:view',
  rateLimit: { key: 'executive_note', max: 30, windowSeconds: 300 },
  async handler({ input, tx, ctx }) {
    if (!(input.kpi in kpis)) throw new ActionFailure('validation');
    const [row] = await tx
      .insert(executiveNotes)
      .values({
        organizationId: ctx.organization.id,
        authorId: ctx.session.userId,
        kpi: input.kpi,
        context: input.context,
        body: input.body,
        ownerId: input.ownerId,
      })
      .returning({ id: executiveNotes.id });
    await emitEvent(tx, {
      type: 'executive.note_added',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'executive_note', id: row!.id },
      clientId: input.asTask ? input.clientId : null,
      payload: {
        noteId: row!.id,
        kpi: input.kpi,
        ownerId: input.ownerId,
        task: input.asTask && input.ownerId && input.clientId ? { clientId: input.clientId, dueDate: input.dueDate } : null,
      },
    });
    return { id: row!.id };
  },
  revalidate: ['/executive'],
});

export const resolveNoteAction = defineAction({
  input: noteIdSchema,
  side: 'agency',
  async handler({ input, tx, ctx }) {
    // RLS: only the author or the owner can update a note.
    const [row] = await tx
      .update(executiveNotes)
      .set({ resolvedAt: new Date() })
      .where(and(eq(executiveNotes.id, input.id), isNull(executiveNotes.resolvedAt)))
      .returning({ id: executiveNotes.id });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'executive.note_resolved',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'executive_note', id: row.id },
      payload: { noteId: row.id },
    });
    return { id: row.id };
  },
  revalidate: ['/executive'],
});

// ---------------------------------------------------------------------------
// Board report schedules (`executive:schedule`)
// ---------------------------------------------------------------------------

export const saveScheduleAction = defineAction({
  input: scheduleSchema,
  side: 'agency',
  permission: 'executive:schedule',
  async handler({ input, tx, ctx }) {
    const today = dayInZone(new Date(), ctx.organization.defaultTimezone);
    const values = {
      cadence: input.cadence,
      locale: input.locale,
      recipients: [...new Set(input.recipients.map((r) => r.trim().toLowerCase()))],
      isActive: input.isActive,
      nextRunOn: nextRunOn(input.cadence, today),
    };
    let id = input.id ?? null;
    if (id) {
      const [row] = await tx
        .update(executiveSchedules)
        .set(values)
        .where(eq(executiveSchedules.id, id))
        .returning({ id: executiveSchedules.id });
      if (!row) throw new ActionFailure('not_found');
    } else {
      const [row] = await tx
        .insert(executiveSchedules)
        .values({ ...values, organizationId: ctx.organization.id, createdBy: ctx.session.userId })
        .returning({ id: executiveSchedules.id });
      id = row!.id;
    }
    await emitEvent(tx, {
      type: 'executive.schedule_saved',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'executive_schedule', id },
      payload: { scheduleId: id, cadence: input.cadence },
    });
    return { id };
  },
  revalidate: ['/executive/reports'],
});

export const deleteScheduleAction = defineAction({
  input: scheduleIdSchema,
  side: 'agency',
  permission: 'executive:schedule',
  async handler({ input, tx, ctx }) {
    const [row] = await tx.delete(executiveSchedules).where(eq(executiveSchedules.id, input.id)).returning({ id: executiveSchedules.id });
    if (!row) throw new ActionFailure('not_found');
    await emitEvent(tx, {
      type: 'executive.schedule_deleted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'executive_schedule', id: row.id },
      payload: { scheduleId: row.id },
    });
    return { id: row.id };
  },
  revalidate: ['/executive/reports'],
});

/** Sends a schedule's board report now, as the person clicking (they hold `executive:schedule`). */
export const sendScheduleNowAction = defineAction({
  input: scheduleIdSchema,
  side: 'agency',
  permission: 'executive:schedule',
  rateLimit: { key: 'executive_send_now', max: 5, windowSeconds: 600 },
  async handler({ input, tx }) {
    const [row] = await tx
      .select({
        id: executiveSchedules.id,
        cadence: executiveSchedules.cadence,
        locale: executiveSchedules.locale,
        recipients: executiveSchedules.recipients,
      })
      .from(executiveSchedules)
      .where(eq(executiveSchedules.id, input.id));
    if (!row) throw new ActionFailure('not_found');
    await tx.update(executiveSchedules).set({ lastRunAt: new Date() }).where(eq(executiveSchedules.id, row.id));
    return row;
  },
  async complete({ prepared, ctx }) {
    return { recipients: await deliverSchedule(ctx, prepared) };
  },
  revalidate: ['/executive/reports'],
});

/** "Refresh now": recomputes today's snapshot as the executive asking, then the page reloads with it. */
export const refreshSnapshotAction = defineAction({
  input: z.object({}),
  side: 'agency',
  permission: 'executive:view',
  rateLimit: { key: 'executive_refresh', max: 6, windowSeconds: 300 },
  async handler() {
    return {};
  },
  async complete({ ctx }) {
    return { metrics: await writeSnapshot(ctx) };
  },
  revalidate: ['/executive'],
});
