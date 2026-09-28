import { z } from 'zod';

import { localizedText } from '@/lib/validation';
import { formCategories, formIcons, requestPriorities, requestStatuses } from '@/modules/requests/constants';
import { requestFormFieldsSchema } from '@/modules/requests/form-schema';

/** Zod schemas shared by the request forms/triage UIs and their server actions. */
const optionalLocalizedText = (max: number) =>
  z.object({ ar: z.string().trim().max(max, { message: 'too_long' }), en: z.string().trim().max(max, { message: 'too_long' }) });

const slaHours = (max: number) => z.number().int().min(1, { message: 'number_min' }).max(max, { message: 'number_max' }).nullable();

export const formSettingsSchema = z.object({
  name: localizedText(80),
  description: optionalLocalizedText(300),
  icon: z.enum(formIcons),
  category: z.enum(formCategories),
  defaultPriority: z.enum(requestPriorities),
  responseSlaHours: slaHours(720),
  resolutionSlaHours: slaHours(2160),
});
export type FormSettingsInput = z.infer<typeof formSettingsSchema>;

export const saveFormFieldsSchema = z.object({ formId: z.uuid(), fields: requestFormFieldsSchema });

export const requestTitleSchema = z.string().trim().min(3, { message: 'too_short' }).max(140, { message: 'too_long' });

export const submitRequestSchema = z.object({
  formId: z.uuid(),
  /** Agency staff may log a request on a client's behalf; client users always submit for their active client. */
  clientId: z.uuid().optional(),
  title: requestTitleSchema,
  answers: z.record(z.string(), z.unknown()),
  desiredDate: z.union([z.literal(''), z.iso.date({ message: 'invalid_date' })]).optional(),
  urgent: z.boolean(),
  attachmentIds: z.array(z.uuid()).max(10),
});

export const changeStatusSchema = z.object({
  requestId: z.uuid(),
  status: z.enum(requestStatuses),
  /** Optional client-visible message posted in the request conversation with the change. */
  message: z.string().trim().max(5000, { message: 'too_long' }).optional(),
});

export const triageSchema = z.object({
  requestIds: z.array(z.uuid()).min(1).max(100),
  assigneeId: z.uuid().nullable().optional(),
  priority: z.enum(requestPriorities).optional(),
});
