import { z } from 'zod';

import type { LocalizedText } from '@/lib/i18n/localized';

/**
 * Request form definitions (stored in `request_form_versions.fields`) and the one validator builder used by
 * the portal form, the server action and the builder preview — so client and server always agree.
 */
export const fieldTypes = ['short_text', 'long_text', 'number', 'date', 'single_select', 'multi_select', 'checkbox', 'url'] as const;
export type FieldType = (typeof fieldTypes)[number];

export const optionFieldTypes: readonly FieldType[] = ['single_select', 'multi_select'];

export type FieldOption = { value: string; label: LocalizedText };

export type RequestFormField = {
  id: string;
  type: FieldType;
  label: LocalizedText;
  help?: LocalizedText;
  required: boolean;
  options?: FieldOption[];
  min?: number | null;
  max?: number | null;
  maxLength?: number | null;
};

export type AnswerValue = string | number | boolean | string[] | null;
export type Answers = Record<string, AnswerValue>;

export const MAX_FIELDS = 30;
export const MAX_OPTIONS = 30;

const localizedLabel = (max: number) =>
  z
    .object({ ar: z.string().trim().max(max, { message: 'too_long' }), en: z.string().trim().max(max, { message: 'too_long' }) })
    .refine((v) => v.ar.length > 0 || v.en.length > 0, { message: 'required_one_language', path: ['ar'] });

const optionalLocalized = (max: number) =>
  z.object({ ar: z.string().trim().max(max, { message: 'too_long' }), en: z.string().trim().max(max, { message: 'too_long' }) }).optional();

const fieldId = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, { message: 'invalid_field_id' });

export const requestFormFieldSchema = z
  .object({
    id: fieldId,
    type: z.enum(fieldTypes),
    label: localizedLabel(120),
    help: optionalLocalized(300),
    required: z.boolean(),
    options: z
      .array(z.object({ value: z.string().regex(/^[a-z0-9_]{1,40}$/, { message: 'invalid_field_id' }), label: localizedLabel(80) }))
      .max(MAX_OPTIONS)
      .optional(),
    min: z.number().finite().nullable().optional(),
    max: z.number().finite().nullable().optional(),
    maxLength: z.number().int().min(1).max(5000).nullable().optional(),
  })
  .superRefine((f, ctx) => {
    if (optionFieldTypes.includes(f.type)) {
      if (!f.options || f.options.length < 2) ctx.addIssue({ code: 'custom', message: 'options_min', path: ['options'] });
      const values = (f.options ?? []).map((o) => o.value);
      if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', message: 'options_unique', path: ['options'] });
    }
    if (f.min != null && f.max != null && f.min > f.max) ctx.addIssue({ code: 'custom', message: 'min_gt_max', path: ['max'] });
  });

export const requestFormFieldsSchema = z
  .array(requestFormFieldSchema)
  .max(MAX_FIELDS)
  .superRefine((fields, ctx) => {
    const ids = fields.map((f) => f.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'field_ids_unique' });
  });

const DEFAULT_TEXT_MAX = { short_text: 200, long_text: 5000 } as const;

function fieldValidator(field: RequestFormField): z.ZodType<AnswerValue | undefined> {
  const required = field.required;
  switch (field.type) {
    case 'short_text':
    case 'long_text': {
      const max = field.maxLength ?? DEFAULT_TEXT_MAX[field.type];
      const base = z.string().trim().max(max, { message: 'too_long' });
      return required ? base.min(1, { message: 'required' }) : base.optional().transform((v) => (v ? v : null));
    }
    case 'url': {
      const base = z
        .string()
        .trim()
        .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
        .pipe(z.union([z.literal(''), z.url({ message: 'invalid_url' }).max(500, { message: 'too_long' })]));
      return required ? base.refine((v) => v.length > 0, { message: 'required' }) : base.optional().transform((v) => (v ? v : null));
    }
    case 'number': {
      let num = z.number({ message: 'invalid_number' }).finite({ message: 'invalid_number' });
      if (field.min != null) num = num.min(field.min, { message: 'number_min' });
      if (field.max != null) num = num.max(field.max, { message: 'number_max' });
      // Inputs deliver strings; accept both and normalize empty to null.
      const coerced = z.preprocess(
        (v) => (v === '' || v === undefined || v === null ? null : typeof v === 'string' ? Number(v) : v),
        num.nullable(),
      );
      return required ? coerced.refine((v) => v !== null, { message: 'required' }) : coerced;
    }
    case 'date': {
      const base = z.union([z.literal(''), z.iso.date({ message: 'invalid_date' })]);
      return required ? base.refine((v) => v.length > 0, { message: 'required' }) : base.optional().transform((v) => (v ? v : null));
    }
    case 'single_select': {
      const values = (field.options ?? []).map((o) => o.value);
      const base = z.string().refine((v) => v === '' || values.includes(v), { message: 'invalid_option' });
      return required ? base.refine((v) => v.length > 0, { message: 'required' }) : base.optional().transform((v) => (v ? v : null));
    }
    case 'multi_select': {
      const values = (field.options ?? []).map((o) => o.value);
      const base = z.array(z.string().refine((v) => values.includes(v), { message: 'invalid_option' })).max(values.length);
      return required ? base.min(1, { message: 'required' }) : base.optional().transform((v) => v ?? []);
    }
    case 'checkbox':
      return required
        ? z.boolean().refine((v) => v, { message: 'required' })
        : z
            .boolean()
            .optional()
            .transform((v) => Boolean(v));
  }
}

/** Zod validator for a form version's answers. Unknown keys are stripped. */
export function buildAnswersSchema(fields: readonly RequestFormField[]) {
  return z.object(Object.fromEntries(fields.map((f) => [f.id, fieldValidator(f)]))) as unknown as z.ZodType<
    Answers,
    Record<string, unknown>
  >;
}

/** Empty initial values for a form (what the inputs start with). */
export function defaultAnswers(fields: readonly RequestFormField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((f) => [f.id, f.type === 'multi_select' ? [] : f.type === 'checkbox' ? false : f.type === 'number' ? '' : '']),
  );
}

/** Whether a stored answer counts as "not answered" (for read views). */
export function isEmptyAnswer(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

type Bilingual = { ar: string; en: string };
const both = (v: LocalizedText | undefined): Bilingual => ({ ar: v?.ar ?? '', en: v?.en ?? '' });

/** Fills in missing languages so a definition matches the strict (both-keys) save schema. */
export function normalizeFields(fields: readonly RequestFormField[]) {
  return fields.map((f) => ({
    ...f,
    label: both(f.label),
    help: both(f.help),
    options: f.options?.map((o) => ({ ...o, label: both(o.label) })),
  }));
}

/** A readable, stable id for a new field (`field_ab12`). */
export function newFieldId(existing: readonly string[]): string {
  for (;;) {
    const id = `field_${Math.random().toString(36).slice(2, 6)}`;
    if (!existing.includes(id)) return id;
  }
}
