import { z } from 'zod';

import {
  baseMetrics,
  campaignObjectives,
  campaignStatuses,
  IMPORT_MAX_ROWS,
  importPresets,
  metricKeys,
  platforms,
  reportCadences,
  reportSectionKinds,
} from '@/modules/campaigns/constants';

const date = z.iso.date({ message: 'invalid_date' });
/** SAR amounts as entered (major units, up to 2 decimals) → halalas. */
const money = z
  .number({ message: 'invalid_number' })
  .finite()
  .min(0, { message: 'invalid_number' })
  .max(1_000_000_000, { message: 'too_large' })
  .transform((v) => Math.round(v * 100));
const count = z.number({ message: 'invalid_number' }).int().min(0).max(1e12);

export const channelInputSchema = z.object({
  /** Client-generated for new channels, so KPIs in the same save can point at them. */
  id: z.uuid(),
  platform: z.enum(platforms),
  name: z.string().trim().max(120, { message: 'too_long' }).default(''),
  budget: money.default(0),
  externalRef: z.string().trim().max(120).nullable().default(null),
});

export const kpiInputSchema = z.object({
  metric: z.enum(metricKeys),
  /** Rates are entered as percentages in the UI and stored as fractions; money in SAR → halalas (see form). */
  target: z.number({ message: 'invalid_number' }).finite().positive({ message: 'invalid_number' }),
  channelId: z.uuid().nullable().default(null),
});

export const campaignInputSchema = z
  .object({
    campaignId: z.uuid().optional(),
    clientId: z.uuid(),
    name: z.string().trim().min(1, { message: 'required' }).max(160, { message: 'too_long' }),
    objective: z.enum(campaignObjectives),
    status: z.enum(campaignStatuses).default('draft'),
    startDate: date,
    endDate: date,
    budget: money,
    ownerId: z.uuid().nullable(),
    description: z.string().max(5000, { message: 'too_long' }).default(''),
    visibility: z.enum(['internal', 'client']).default('client'),
    channels: z.array(channelInputSchema).min(1, { message: 'channel_required' }).max(12),
    kpis: z.array(kpiInputSchema).max(20),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'dates_order', path: ['endDate'] })
  .refine((v) => v.kpis.every((k) => !k.channelId || v.channels.some((c) => c.id === k.channelId)), {
    message: 'invalid_channel',
    path: ['kpis'],
  })
  .refine((v) => new Set(v.kpis.map((k) => `${k.channelId ?? '*'}:${k.metric}`)).size === v.kpis.length, {
    message: 'duplicate_kpi',
    path: ['kpis'],
  });
export type CampaignInput = z.input<typeof campaignInputSchema>;

export const campaignStatusSchema = z.object({ campaignId: z.uuid(), status: z.enum(campaignStatuses) });

export const campaignIdSchema = z.object({ campaignId: z.uuid() });

const metricValues = z.object(Object.fromEntries(baseMetrics.map((k) => [k, count])) as Record<(typeof baseMetrics)[number], typeof count>);

/** Manual entry: whole days per channel (money already in halalas from the grid). */
export const saveMetricsSchema = z.object({
  campaignId: z.uuid(),
  rows: z
    .array(metricValues.extend({ channelId: z.uuid(), date }))
    .min(1)
    .max(400),
});

export const importMetricsSchema = z.object({
  campaignId: z.uuid(),
  channelId: z.uuid(),
  fileName: z.string().trim().min(1).max(255),
  preset: z.enum(importPresets),
  rows: z
    .array(metricValues.extend({ date }))
    .min(1, { message: 'import_empty' })
    .max(IMPORT_MAX_ROWS)
    .refine((rows) => new Set(rows.map((r) => r.date)).size === rows.length, { message: 'duplicate_date' }),
});

export const linkDeliverableSchema = z.object({ deliverableId: z.uuid(), campaignId: z.uuid().nullable() });
export const linkRequestSchema = z.object({ requestId: z.uuid(), campaignId: z.uuid().nullable() });

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const sectionConfigSchema = z
  .object({
    metrics: z.array(z.enum(metricKeys)).max(8).optional(),
    grain: z.enum(['day', 'week']).optional(),
  })
  .default({});

export const sectionInputSchema = z.object({
  kind: z.enum(reportSectionKinds),
  config: sectionConfigSchema,
  body: z.string().max(10000, { message: 'too_long' }).default(''),
});

export const reportTitleSchema = z.string().trim().min(1, { message: 'required' }).max(200, { message: 'too_long' });

export const createReportSchema = z
  .object({
    clientId: z.uuid(),
    campaignId: z.uuid().nullable(),
    title: reportTitleSchema,
    periodStart: date,
    periodEnd: date,
    locale: z.enum(['ar', 'en']),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { message: 'dates_order', path: ['periodEnd'] });

export const saveReportSchema = z
  .object({
    reportId: z.uuid(),
    title: reportTitleSchema,
    periodStart: date,
    periodEnd: date,
    locale: z.enum(['ar', 'en']),
    sections: z.array(sectionInputSchema).min(1).max(20),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { message: 'dates_order', path: ['periodEnd'] });

export const reportIdSchema = z.object({ reportId: z.uuid() });

export const saveScheduleSchema = z.object({
  scheduleId: z.uuid().optional(),
  clientId: z.uuid(),
  campaignId: z.uuid().nullable(),
  cadence: z.enum(reportCadences),
  locale: z.enum(['ar', 'en']),
  autoPublish: z.boolean(),
  isActive: z.boolean(),
  sections: z
    .array(z.object({ kind: z.enum(reportSectionKinds), config: sectionConfigSchema }))
    .min(1)
    .max(20),
});

export const scheduleIdSchema = z.object({ scheduleId: z.uuid() });
