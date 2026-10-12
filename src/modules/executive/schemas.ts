import { z } from 'zod';

import { comparisons, executiveTabs, periodPresets, targetMetrics } from '@/modules/executive/types';

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const viewConfigSchema = z.object({
  tab: z.enum(executiveTabs),
  preset: z.enum(periodPresets),
  from: isoDay.nullish(),
  to: isoDay.nullish(),
  compare: z.enum(comparisons),
  filters: z.object({
    clientId: z.uuid().nullish(),
    departmentId: z.uuid().nullish(),
    accountManagerId: z.uuid().nullish(),
    platform: z
      .string()
      .regex(/^[a-z_]{1,32}$/)
      .nullish(),
  }),
});

export const writeBriefSchema = z.object({ config: viewConfigSchema });

/** Targets for one year: a full-year value and/or quarterly values per metric (null clears). In KPI units. */
export const saveTargetsSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  rows: z
    .array(
      z.object({
        metric: z.enum(targetMetrics),
        quarter: z.number().int().min(1).max(4).nullable(),
        value: z.number().min(0).max(1e13).nullable(),
      }),
    )
    .max(targetMetrics.length * 5),
});

export const saveViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  config: viewConfigSchema,
  pinned: z.boolean().default(false),
});
export const viewIdSchema = z.object({ id: z.uuid() });
export const pinViewSchema = z.object({ id: z.uuid(), pinned: z.boolean() });

export const addNoteSchema = z
  .object({
    kpi: z.string().regex(/^[a-z0-9_]{1,40}$/),
    body: z.string().trim().min(1).max(2000),
    context: viewConfigSchema,
    ownerId: z.uuid().nullable(),
    asTask: z.boolean().default(false),
    clientId: z.uuid().nullable().default(null),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
  })
  .refine((v) => !v.asTask || (v.ownerId && v.clientId), { path: ['clientId'], message: 'required' });
export const noteIdSchema = z.object({ id: z.uuid() });

export const scheduleSchema = z.object({
  id: z.uuid().nullish(),
  cadence: z.enum(['weekly', 'monthly']),
  locale: z.enum(['ar', 'en']),
  recipients: z.array(z.email()).min(1).max(20),
  isActive: z.boolean().default(true),
});
export const scheduleIdSchema = z.object({ id: z.uuid() });
