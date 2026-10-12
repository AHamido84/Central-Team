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
