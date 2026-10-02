import { z } from 'zod';

import type { LocalizedText } from '@/lib/i18n/localized';
import { aspectRatios, platforms, type AspectRatio } from '@/modules/requests/constants';

/**
 * Request-type brief forms (`request_types.form_schema`) and the single validator (`validateBrief`) used by the
 * portal wizard, the server actions and the builder preview — client and server always agree.
 */
export const fieldTypes = [
  'short_text',
  'long_text',
  'number',
  'single_select',
  'multi_select',
  'date',
  'file',
  'links',
  'platforms',
  'dimensions',
  'color',
  'checkbox',
] as const;
export type FieldType = (typeof fieldTypes)[number];

export const optionFieldTypes: readonly FieldType[] = ['single_select', 'multi_select'];
/** Fields another field's visibility can depend on. */
export const conditionSourceTypes: readonly FieldType[] = ['single_select', 'multi_select', 'platforms', 'checkbox'];

export type FieldOption = { value: string; label: LocalizedText };
export type ShowIf = { field: string; equals: string | boolean };

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
  /** files / links / colors: how many values at most. */
  maxItems?: number | null;
  showIf?: ShowIf | null;
};

export type FormSchema = { fields: RequestFormField[] };

export type Dimensions = { ratio: AspectRatio; width?: number | null; height?: number | null };
export type BriefValue = string | number | boolean | string[] | Dimensions | null;
export type Brief = Record<string, BriefValue>;

export const MAX_FIELDS = 40;
export const MAX_OPTIONS = 30;
export const DEFAULT_MAX_ITEMS = { file: 10, links: 10, color: 6 } as const;
const TEXT_MAX = { short_text: 200, long_text: 5000 } as const;

// ---------------------------------------------------------------------------
// Definition (builder) schema
// ---------------------------------------------------------------------------

const bilingual = (max: number) =>
  z.object({ ar: z.string().trim().max(max, { message: 'too_long' }), en: z.string().trim().max(max, { message: 'too_long' }) });
const label = (max: number) =>
  bilingual(max).refine((v) => v.ar.length > 0 || v.en.length > 0, { message: 'required_one_language', path: ['ar'] });

const fieldId = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, { message: 'invalid_field_id' });

export const requestFormFieldSchema = z
  .object({
    id: fieldId,
    type: z.enum(fieldTypes),
    label: label(120),
    help: bilingual(300).optional(),
    required: z.boolean(),
    options: z
      .array(z.object({ value: z.string().regex(/^[a-z0-9_]{1,40}$/, { message: 'invalid_field_id' }), label: label(80) }))
      .max(MAX_OPTIONS)
      .optional(),
    min: z.number().finite().nullable().optional(),
    max: z.number().finite().nullable().optional(),
    maxLength: z.number().int().min(1).max(5000).nullable().optional(),
    maxItems: z.number().int().min(1).max(20).nullable().optional(),
    showIf: z
      .object({ field: fieldId, equals: z.union([z.string().min(1), z.boolean()]) })
      .nullable()
      .optional(),
  })
  .superRefine((f, ctx) => {
    if (optionFieldTypes.includes(f.type)) {
      if (!f.options || f.options.length < 2) ctx.addIssue({ code: 'custom', message: 'options_min', path: ['options'] });
      const values = (f.options ?? []).map((o) => o.value);
      if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', message: 'options_unique', path: ['options'] });
    }
    if (f.min != null && f.max != null && f.min > f.max) ctx.addIssue({ code: 'custom', message: 'min_gt_max', path: ['max'] });
  });

/** A form definition: unique ids, and every condition points at an earlier field with a valid value. */
export const formSchemaSchema = z.object({ fields: z.array(requestFormFieldSchema).max(MAX_FIELDS) }).superRefine(({ fields }, ctx) => {
  const seen = new Map<string, z.infer<typeof requestFormFieldSchema>>();
  fields.forEach((f, i) => {
    if (seen.has(f.id)) ctx.addIssue({ code: 'custom', message: 'field_ids_unique', path: ['fields', i, 'id'] });
    if (f.showIf) {
      const source = seen.get(f.showIf.field);
      const valid =
        source &&
        conditionSourceTypes.includes(source.type) &&
        (source.type === 'checkbox'
          ? typeof f.showIf.equals === 'boolean'
          : source.type === 'platforms'
            ? (platforms as readonly string[]).includes(String(f.showIf.equals))
            : (source.options ?? []).some((o) => o.value === f.showIf!.equals));
      if (!valid) ctx.addIssue({ code: 'custom', message: 'invalid_condition', path: ['fields', i, 'showIf'] });
    }
    seen.set(f.id, f);
  });
});

// ---------------------------------------------------------------------------
// Answers (brief) validation
// ---------------------------------------------------------------------------

/** Whether `field` is shown given the other answers. Conditions only look at earlier fields (no cycles). */
export function isFieldVisible(field: RequestFormField, values: Record<string, unknown>): boolean {
  if (!field.showIf) return true;
  const v = values[field.showIf.field];
  if (Array.isArray(v)) return v.includes(field.showIf.equals as string);
  return v === field.showIf.equals;
}

const empty = (v: unknown) =>
  v === undefined ||
  v === null ||
  v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && v !== null && !Array.isArray(v) && !('ratio' in v));

export function isEmptyAnswer(value: unknown): boolean {
  return empty(value);
}

const hex = /^#[0-9a-f]{6}$/i;
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeUrl(v: string) {
  const t = v.trim();
  return t && !/^https?:\/\//i.test(t) ? `https://${t}` : t;
}

/** Validates one visible field. Returns the normalized value or an error key (translated under `validation`). */
function checkField(field: RequestFormField, raw: unknown, required: boolean): { value: BriefValue } | { error: string } {
  if (empty(raw) && !(field.type === 'checkbox' && raw === false)) {
    if (required && field.type !== 'checkbox') return { error: 'required' };
    return {
      value: ['multi_select', 'file', 'links', 'platforms', 'color'].includes(field.type) ? [] : field.type === 'checkbox' ? false : null,
    };
  }
  switch (field.type) {
    case 'short_text':
    case 'long_text': {
      if (typeof raw !== 'string') return { error: 'invalid' };
      const v = raw.trim();
      if (required && !v) return { error: 'required' };
      if (v.length > (field.maxLength ?? TEXT_MAX[field.type])) return { error: 'too_long' };
      return { value: v || null };
    }
    case 'number': {
      const n = typeof raw === 'string' ? Number(raw) : raw;
      if (typeof n !== 'number' || !Number.isFinite(n)) return { error: 'invalid_number' };
      if (field.min != null && n < field.min) return { error: 'number_min' };
      if (field.max != null && n > field.max) return { error: 'number_max' };
      return { value: n };
    }
    case 'date':
      return typeof raw === 'string' && z.iso.date().safeParse(raw).success ? { value: raw } : { error: 'invalid_date' };
    case 'single_select':
      return typeof raw === 'string' && (field.options ?? []).some((o) => o.value === raw) ? { value: raw } : { error: 'invalid_option' };
    case 'multi_select':
    case 'platforms': {
      const allowed = field.type === 'platforms' ? (platforms as readonly string[]) : (field.options ?? []).map((o) => o.value);
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string' || !allowed.includes(x))) return { error: 'invalid_option' };
      return { value: [...new Set(raw as string[])] };
    }
    case 'file': {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string' || !uuidRe.test(x))) return { error: 'invalid' };
      if (raw.length > (field.maxItems ?? DEFAULT_MAX_ITEMS.file)) return { error: 'too_many' };
      return { value: [...new Set(raw as string[])] };
    }
    case 'links': {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) return { error: 'invalid_url' };
      const urls = (raw as string[]).map(normalizeUrl).filter(Boolean);
      if (urls.length > (field.maxItems ?? DEFAULT_MAX_ITEMS.links)) return { error: 'too_many' };
      if (urls.some((u) => u.length > 500 || !z.url().safeParse(u).success)) return { error: 'invalid_url' };
      if (required && urls.length === 0) return { error: 'required' };
      return { value: urls };
    }
    case 'color': {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string' || !hex.test(x))) return { error: 'invalid_color' };
      if (raw.length > (field.maxItems ?? DEFAULT_MAX_ITEMS.color)) return { error: 'too_many' };
      return { value: [...new Set((raw as string[]).map((c) => c.toLowerCase()))] };
    }
    case 'dimensions': {
      const d = raw as Partial<Dimensions>;
      if (typeof d !== 'object' || !d || !(aspectRatios as readonly string[]).includes(String(d.ratio))) return { error: 'invalid_option' };
      if (d.ratio !== 'custom') return { value: { ratio: d.ratio as AspectRatio } };
      const w = Number(d.width);
      const h = Number(d.height);
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 16 || h < 16 || w > 20000 || h > 20000)
        return { error: 'invalid_dimensions' };
      return { value: { ratio: 'custom', width: w, height: h } };
    }
    case 'checkbox':
      if (typeof raw !== 'boolean') return { error: 'invalid' };
      if (required && !raw) return { error: 'required' };
      return { value: raw };
  }
}

export type BriefResult = { ok: true; data: Brief } | { ok: false; errors: Record<string, string>; data: Brief };

/**
 * Validates a brief against a form. Hidden fields (conditions not met) are dropped and never required;
 * unknown keys are stripped. `mode: 'draft'` checks types/limits but not "required".
 */
export function validateBrief(
  fields: readonly RequestFormField[],
  raw: Record<string, unknown>,
  mode: 'submit' | 'draft' = 'submit',
): BriefResult {
  const data: Brief = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (!isFieldVisible(field, data)) continue;
    const r = checkField(field, raw[field.id], mode === 'submit' && field.required);
    if ('error' in r) {
      errors[field.id] = r.error;
      continue;
    }
    data[field.id] = r.value;
  }
  return Object.keys(errors).length ? { ok: false, errors, data } : { ok: true, data };
}

/** File ids referenced by a brief's file fields. */
export function briefFileIds(fields: readonly RequestFormField[], brief: Brief): { fieldId: string; fileId: string }[] {
  return fields
    .filter((f) => f.type === 'file')
    .flatMap((f) => (Array.isArray(brief[f.id]) ? (brief[f.id] as string[]) : []).map((fileId) => ({ fieldId: f.id, fileId })));
}

/** Empty initial values for a form (what the inputs start with). */
export function defaultBrief(fields: readonly RequestFormField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((f) => [
      f.id,
      ['multi_select', 'file', 'links', 'platforms', 'color'].includes(f.type)
        ? []
        : f.type === 'checkbox'
          ? false
          : f.type === 'dimensions'
            ? null
            : '',
    ]),
  );
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
    showIf: f.showIf ?? null,
  }));
}

/** A readable, stable id for a new field (`field_ab12`). */
export function newFieldId(existing: readonly string[]): string {
  for (;;) {
    const id = `field_${Math.random().toString(36).slice(2, 6)}`;
    if (!existing.includes(id)) return id;
  }
}
