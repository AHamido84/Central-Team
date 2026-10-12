'use server';

import { and, eq } from 'drizzle-orm';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import { kpiTargets } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import type { Locale } from '@/lib/i18n/localized';
import { can } from '@/lib/permissions/can';
import { getLocale } from 'next-intl/server';
import { generate } from '@/modules/ai/server/runtime';
import { briefLines, briefPrompt, resolveBriefCitations } from '@/modules/executive/brief';
import { executiveKit } from '@/modules/executive/kit';
import { saveTargetsSchema, writeBriefSchema } from '@/modules/executive/schemas';
import { getExecutiveReport } from '@/modules/executive/server/data';

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
      await tx
        .insert(kpiTargets)
        .values(
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
