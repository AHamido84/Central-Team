import { z } from 'zod';

import { packageItemTypes } from '@/modules/clients/constants';
import { localizedText } from '@/lib/validation';
import { clientPriorities, requestPriorities, requestStatuses, typeCategories, typeIcons } from '@/modules/requests/constants';
import { formSchemaSchema } from '@/modules/requests/form-schema';

/** Zod schemas shared by the request UIs and their server actions. */
const bilingual = (max: number) =>
  z.object({ ar: z.string().trim().max(max, { message: 'too_long' }), en: z.string().trim().max(max, { message: 'too_long' }) });

export const typeSettingsSchema = z.object({
  name: localizedText(80),
  description: bilingual(300),
  icon: z.enum(typeIcons),
  category: z.enum(typeCategories),
  defaultPriority: z.enum(requestPriorities),
  slaDays: z.number().int().min(1, { message: 'number_min' }).max(90, { message: 'number_max' }).nullable(),
  packageItemType: z.enum(packageItemTypes).nullable(),
  isActive: z.boolean(),
});
export type TypeSettingsInput = z.infer<typeof typeSettingsSchema>;

export const saveTypeFormSchema = z.object({ typeId: z.uuid(), formSchema: formSchemaSchema });

export const requestTitleSchema = z.string().trim().min(3, { message: 'too_short' }).max(140, { message: 'too_long' });

const optionalDate = z.union([z.literal(''), z.iso.date({ message: 'invalid_date' })]).optional();

/** What the wizard sends, for both "save draft" and "submit". The brief is validated against the type's form. */
export const requestDraftSchema = z.object({
  requestId: z.uuid().optional(),
  typeId: z.uuid(),
  title: z.string().trim().max(140, { message: 'too_long' }),
  brief: z.record(z.string(), z.unknown()),
  referenceLinks: z.array(z.string().trim().max(500)).max(10),
  desiredDate: optionalDate,
  priority: z.enum(clientPriorities as [string, ...string[]]),
  /** General attachments (wizard step 3); brief file fields carry their own ids inside `brief`. */
  attachmentIds: z.array(z.uuid()).max(20),
});
export type RequestDraftInput = z.infer<typeof requestDraftSchema>;

export const changeStatusSchema = z
  .object({
    requestId: z.uuid(),
    status: z.enum(requestStatuses),
    /** Required for needs info / reject; optional note otherwise (posted to the discussion). */
    reason: z.string().trim().max(2000, { message: 'too_long' }).optional(),
  })
  .refine((v) => !['needs_info', 'rejected'].includes(v.status) || (v.reason ?? '').length >= 3, {
    message: 'reason_required',
    path: ['reason'],
  });

export const triageSchema = z.object({
  requestIds: z.array(z.uuid()).min(1).max(100),
  assigneeId: z.uuid().nullable().optional(),
  priority: z.enum(requestPriorities).optional(),
  dueDate: z.iso.date({ message: 'invalid_date' }).optional(),
  isExtra: z.boolean().optional(),
  isBillable: z.boolean().optional(),
});
