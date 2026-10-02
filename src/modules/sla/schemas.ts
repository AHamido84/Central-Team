import { z } from 'zod';

import { localizedText } from '@/lib/validation';
import { requestPriorities } from '@/modules/requests/constants';

const uuid = z.uuid();
const optionalUuid = z
  .union([z.uuid(), z.literal('')])
  .optional()
  .nullable()
  .transform((v) => v || null);

export const savePolicySchema = z.object({
  policyId: uuid.optional(),
  name: localizedText(80),
  clientId: optionalUuid,
  requestTypeId: optionalUuid,
  priority: z
    .union([z.enum(requestPriorities), z.literal('')])
    .optional()
    .nullable()
    .transform((v) => v || null),
  responseHours: z.coerce.number().int({ message: 'invalid_number' }).min(1, { message: 'number_min' }).max(240, { message: 'number_max' }),
  resolutionDays: z
    .union([
      z.coerce.number().int({ message: 'invalid_number' }).min(1, { message: 'number_min' }).max(90, { message: 'number_max' }),
      z.literal(''),
    ])
    .optional()
    .nullable()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  pauseOnClient: z.boolean(),
  atRiskPercent: z.coerce.number().int().min(50, { message: 'number_min' }).max(95, { message: 'number_max' }),
  escalateTo: optionalUuid,
  isActive: z.boolean(),
});
export type SavePolicyInput = z.input<typeof savePolicySchema>;

export const policyIdSchema = z.object({ policyId: uuid });

const time = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/, { message: 'invalid_time' });

export const businessHoursSchema = z
  .object({ start: time, end: time })
  .refine((v) => v.start < v.end, { message: 'time_order', path: ['end'] });

export const saveHolidaySchema = z.object({
  date: z.iso.date({ message: 'invalid_date' }),
  name: localizedText(80),
});

export const holidayIdSchema = z.object({ holidayId: uuid });

export const acknowledgeBreachSchema = z.object({
  breachId: uuid,
  note: z
    .string()
    .trim()
    .max(1000, { message: 'too_long' })
    .optional()
    .transform((v) => (v ? v : null)),
});
