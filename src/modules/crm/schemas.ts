import { z } from 'zod';

import { cities } from '@/modules/clients/constants';
import { activityTypes, budgetRanges, crmServices, leadSources, leadStatuses, lostReasons, quoteStatuses } from '@/modules/crm/constants';
import { normalizeEmail, normalizePhone } from '@/modules/crm/leads';

const optionalId = z
  .union([z.uuid(), z.literal('')])
  .optional()
  .nullable()
  .transform((v) => v || null);

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: 'too_long' })
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/** Phone: empty → null, otherwise a valid Saudi (or E.164) number, normalised. */
export const leadPhone = z
  .string()
  .trim()
  .max(40, { message: 'too_long' })
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = normalizePhone(v);
    if (!n) ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
    return n;
  });

export const leadEmail = z
  .string()
  .trim()
  .max(200, { message: 'too_long' })
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const n = normalizeEmail(v);
    if (!n) ctx.addIssue({ code: 'custom', message: 'invalid_email' });
    return n;
  });

const tags = z
  .array(z.string().trim().min(1).max(30))
  .max(10, { message: 'too_many' })
  .transform((v) => [...new Set(v)]);

export const leadFields = z
  .object({
    fullName: z.string().trim().min(1, { message: 'required' }).max(120, { message: 'too_long' }),
    company: text(120),
    phone: leadPhone,
    email: leadEmail,
    source: z.enum(leadSources),
    sourceDetail: text(200),
    services: z.array(z.enum(crmServices)).max(crmServices.length),
    budgetRange: z.enum(budgetRanges),
    city: z
      .enum(cities)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    ownerId: optionalId,
    tags,
    notes: z.string().trim().max(4000, { message: 'too_long' }).default(''),
  })
  .refine((v) => v.phone || v.email, { message: 'contact_required', path: ['phone'] });

export const saveLeadSchema = z.intersection(z.object({ leadId: z.uuid().optional() }), leadFields);
export type SaveLeadInput = z.input<typeof saveLeadSchema>;

export const leadStatusSchema = z.object({ leadId: z.uuid(), status: z.enum(leadStatuses).exclude(['merged', 'converted']) });
export const assignLeadSchema = z.object({ leadIds: z.array(z.uuid()).min(1).max(200), ownerId: optionalId });
export const mergeLeadsSchema = z.object({ primaryId: z.uuid(), otherId: z.uuid() }).refine((v) => v.primaryId !== v.otherId, {
  message: 'invalid',
  path: ['otherId'],
});

/** One CSV row after the browser mapped columns; the server re-validates everything. */
export const importLeadRow = z.object({
  fullName: z.string().trim().min(1).max(120),
  company: text(120),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(40).optional().nullable(),
  services: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export const importLeadsSchema = z.object({
  source: z.enum(leadSources),
  ownerId: optionalId,
  useRules: z.boolean(),
  skipDuplicates: z.boolean(),
  rows: z.array(importLeadRow).min(1, { message: 'import_empty' }).max(2000, { message: 'too_many' }),
});

export const convertLeadSchema = z.object({
  leadId: z.uuid(),
  title: z.string().trim().min(1, { message: 'required' }).max(160, { message: 'too_long' }),
  pipelineId: z.uuid(),
  valueSar: z.coerce.number().min(0, { message: 'positive_number' }).max(100_000_000),
  expectedCloseDate: z.iso.date().nullable(),
  packageId: optionalId,
});

export const saveDealSchema = z.object({
  dealId: z.uuid().optional(),
  title: z.string().trim().min(1, { message: 'required' }).max(160, { message: 'too_long' }),
  company: text(120),
  pipelineId: z.uuid(),
  stageId: z.uuid().optional(),
  valueSar: z.coerce.number().min(0, { message: 'positive_number' }).max(100_000_000),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.iso.date().nullable(),
  ownerId: optionalId,
  packageId: optionalId,
  leadId: optionalId,
});
export type SaveDealInput = z.input<typeof saveDealSchema>;

export const moveDealSchema = z.object({
  dealId: z.uuid(),
  stageId: z.uuid(),
  lostReason: z.enum(lostReasons).optional().nullable(),
  lostNote: text(1000),
});

export const contactSchema = z.object({
  contactId: z.uuid().optional(),
  dealId: z.uuid(),
  fullName: z.string().trim().min(1, { message: 'required' }).max(120, { message: 'too_long' }),
  jobTitle: text(120),
  phone: leadPhone,
  email: leadEmail,
  isPrimary: z.boolean(),
});

export const activitySchema = z
  .object({
    activityId: z.uuid().optional(),
    leadId: optionalId,
    dealId: optionalId,
    type: z.enum(activityTypes),
    subject: z.string().trim().min(1, { message: 'required' }).max(200, { message: 'too_long' }),
    body: z.string().trim().max(4000, { message: 'too_long' }).default(''),
    dueAt: z.iso
      .datetime({ offset: true })
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    done: z.boolean(),
  })
  .refine((v) => v.leadId || v.dealId, { message: 'invalid', path: ['leadId'] });

export const completeActivitySchema = z.object({ activityId: z.uuid(), done: z.boolean() });

export const quoteSchema = z.object({
  quoteId: z.uuid().optional(),
  dealId: z.uuid(),
  title: z.string().trim().min(1, { message: 'required' }).max(160, { message: 'too_long' }),
  locale: z.enum(['ar', 'en']),
  validUntil: z.iso.date().nullable(),
  discountSar: z.coerce.number().min(0).max(100_000_000),
  notes: z.string().trim().max(4000, { message: 'too_long' }).default(''),
  items: z
    .array(
      z.object({
        packageId: optionalId,
        description: z.string().trim().min(1, { message: 'required' }).max(300, { message: 'too_long' }),
        quantity: z.coerce.number().positive({ message: 'positive_number' }).max(10_000),
        unitPriceSar: z.coerce.number().min(0, { message: 'positive_number' }).max(100_000_000),
      }),
    )
    .min(1, { message: 'min_one' })
    .max(50),
});
export const quoteStatusSchema = z.object({ quoteId: z.uuid(), status: z.enum(quoteStatuses) });

export const convertDealSchema = z.object({
  dealId: z.uuid(),
  clientName: z.object({ ar: z.string().trim().max(120), en: z.string().trim().max(120) }).refine((v) => v.ar || v.en, {
    message: 'required_one_language',
    path: ['ar'],
  }),
  city: z.enum(cities).nullable(),
  accountManagerId: z.uuid(),
  teamIds: z.array(z.uuid()).max(20),
  packageId: optionalId,
  inviteContactId: optionalId,
  inviteLocale: z.enum(['ar', 'en']),
  onboarding: z.boolean(),
});

/* Settings */

export const pipelineSchema = z.object({
  pipelineId: z.uuid().optional(),
  name: z.object({ ar: z.string().trim().max(80), en: z.string().trim().max(80) }).refine((v) => v.ar || v.en, {
    message: 'required_one_language',
    path: ['ar'],
  }),
  isDefault: z.boolean(),
  stages: z
    .array(
      z.object({
        id: z.uuid().optional(),
        name: z.object({ ar: z.string().trim().max(60), en: z.string().trim().max(60) }).refine((v) => v.ar || v.en, {
          message: 'required_one_language',
          path: ['ar'],
        }),
        kind: z.enum(['open', 'won', 'lost']),
        probability: z.coerce.number().int().min(0).max(100),
      }),
    )
    .min(3, { message: 'min_one' })
    .max(15)
    .refine((s) => s.filter((x) => x.kind === 'won').length === 1 && s.filter((x) => x.kind === 'lost').length === 1, {
      message: 'stages_won_lost',
    })
    .refine((s) => s.some((x) => x.kind === 'open'), { message: 'stages_won_lost' }),
});

export const leadFormSchema = z.object({
  formId: z.uuid().optional(),
  name: z.string().trim().min(1, { message: 'required' }).max(120, { message: 'too_long' }),
  isActive: z.boolean(),
  services: z.array(z.enum(crmServices)).max(crmServices.length),
  thankYou: z.object({ ar: z.string().trim().max(300), en: z.string().trim().max(300) }),
});

export const ruleSchema = z.object({
  ruleId: z.uuid().optional(),
  name: z.string().trim().min(1, { message: 'required' }).max(80, { message: 'too_long' }),
  matchServices: z.array(z.enum(crmServices)),
  matchCities: z.array(z.enum(cities)),
  matchSources: z.array(z.enum(leadSources)),
  memberIds: z.array(z.uuid()).min(1, { message: 'min_one' }).max(50),
  isActive: z.boolean(),
});

export const targetSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, { message: 'invalid_date' }),
  ownerId: optionalId,
  amountSar: z.coerce.number().min(0).max(1_000_000_000),
});

export const crmSettingsSchema = z.object({
  staleDays: z.coerce.number().int().min(1).max(90),
  onboardingRequestTypeId: optionalId,
  onboardingTemplateId: optionalId,
});

export const webhookTokenSchema = z.object({ name: z.string().trim().min(1, { message: 'required' }).max(80, { message: 'too_long' }) });

export const idSchema = z.object({ id: z.uuid() });

/* Public intake */

export const publicLeadSchema = z
  .object({
    fullName: z.string().trim().min(2, { message: 'required' }).max(120, { message: 'too_long' }),
    company: text(120),
    phone: leadPhone,
    email: leadEmail,
    city: z
      .enum(cities)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    services: z.array(z.enum(crmServices)).max(crmServices.length).default([]),
    budgetRange: z.enum(budgetRanges).default('unknown'),
    message: z.string().trim().max(2000, { message: 'too_long' }).default(''),
  })
  .refine((v) => v.phone || v.email, { message: 'contact_required', path: ['phone'] });

/** The webhook contract (docs/ARCHITECTURE §21): tolerant field names, strict values. */
export const webhookLeadSchema = z
  .object({
    external_ref: z.string().trim().min(1).max(200),
    source: z.enum(leadSources).default('lead_ad'),
    source_detail: text(200),
    full_name: z.string().trim().min(1).max(120),
    company: text(120),
    phone: leadPhone,
    email: leadEmail,
    city: z
      .enum(cities)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    services: z.array(z.enum(crmServices)).max(crmServices.length).default([]),
    budget_range: z.enum(budgetRanges).default('unknown'),
    message: z.string().trim().max(2000).default(''),
  })
  .refine((v) => v.phone || v.email, { message: 'contact_required', path: ['phone'] });
