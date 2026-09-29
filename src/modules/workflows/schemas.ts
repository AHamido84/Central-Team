import { z } from 'zod';

import { localizedText } from '@/lib/validation';
import { statusCategories, statusColors } from '@/modules/tasks/constants';
import { assigneeModes, deliverableTypes, MAX_STEPS, orderSteps } from '@/modules/workflows/constants';

const bilingual = (max: number) =>
  z.object({ ar: z.string().trim().max(max, { message: 'too_long' }), en: z.string().trim().max(max, { message: 'too_long' }) });

export const templateSettingsSchema = z.object({
  name: localizedText(80),
  description: bilingual(300),
  requestTypeId: z.uuid().nullable(),
  isActive: z.boolean(),
  isDefault: z.boolean(),
});
export type TemplateSettingsInput = z.infer<typeof templateSettingsSchema>;

export const templateStepSchema = z
  .object({
    id: z.uuid(),
    name: localizedText(80),
    description: bilingual(500),
    departmentId: z.uuid().nullable(),
    assigneeMode: z.enum(assigneeModes),
    assigneeRoleId: z.uuid().nullable(),
    assigneeUserId: z.uuid().nullable(),
    slaDays: z.number().int().min(0, { message: 'number_min' }).max(60, { message: 'number_max' }),
    dependsOn: z.array(z.uuid()).max(MAX_STEPS),
    requiresInternalReview: z.boolean(),
    requiresClientApproval: z.boolean(),
    deliverableType: z.enum(deliverableTypes).nullable(),
  })
  .superRefine((s, ctx) => {
    if (s.assigneeMode === 'role' && !s.assigneeRoleId) ctx.addIssue({ code: 'custom', message: 'required', path: ['assigneeRoleId'] });
    if (s.assigneeMode === 'user' && !s.assigneeUserId) ctx.addIssue({ code: 'custom', message: 'required', path: ['assigneeUserId'] });
    if ((s.requiresInternalReview || s.requiresClientApproval) && !s.deliverableType) {
      ctx.addIssue({ code: 'custom', message: 'review_needs_deliverable', path: ['deliverableType'] });
    }
  });
export type TemplateStepInput = z.infer<typeof templateStepSchema>;

export const saveStepsSchema = z
  .object({ templateId: z.uuid(), steps: z.array(templateStepSchema).min(1, { message: 'steps_min' }).max(MAX_STEPS) })
  .superRefine((v, ctx) => {
    const ids = new Set<string>();
    v.steps.forEach((s, i) => {
      if (ids.has(s.id)) ctx.addIssue({ code: 'custom', message: 'duplicate', path: ['steps', i, 'id'] });
      ids.add(s.id);
    });
    const ordered = orderSteps(v.steps.map((s, i) => ({ ...s, sortOrder: i })));
    if (!ordered) ctx.addIssue({ code: 'custom', message: 'dependency_cycle', path: ['steps'] });
  });

export const taskStatusSchema = z.object({
  id: z.uuid().nullable(),
  name: localizedText(40),
  category: z.enum(statusCategories),
  color: z.enum(statusColors),
  isDefault: z.boolean(),
});

export const saveStatusesSchema = z.object({ statuses: z.array(taskStatusSchema).min(2).max(15) }).superRefine((v, ctx) => {
  if (!v.statuses.some((s) => s.category === 'done')) ctx.addIssue({ code: 'custom', message: 'status_done_required', path: ['statuses'] });
  if (v.statuses.filter((s) => s.isDefault).length !== 1)
    ctx.addIssue({ code: 'custom', message: 'status_default_required', path: ['statuses'] });
});

export const convertSchema = z.object({
  requestId: z.uuid(),
  templateId: z.uuid(),
  /** First working day of the workflow (defaults to today in the organization's time zone). */
  startDate: z.iso.date({ message: 'invalid_date' }).optional(),
});
