import { z } from 'zod';

import { packageItemTypes } from '@/modules/clients/constants';

export const memberHoursSchema = z.object({
  userId: z.uuid(),
  hoursPerWeek: z.coerce.number().min(0, { message: 'positive_number' }).max(80),
});

export const timeOffSchema = z
  .object({
    userId: z.uuid(),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    kind: z.enum(['annual', 'sick', 'other']),
    note: z.string().trim().max(200, { message: 'too_long' }).default(''),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'invalid_date', path: ['endDate'] });

export const effortsSchema = z.object({
  efforts: z
    .array(z.object({ itemType: z.enum(packageItemTypes), departmentId: z.uuid(), hours: z.coerce.number().min(0).max(200) }))
    .max(500),
});
