import { z } from 'zod';

/**
 * Shared Zod building blocks. Error messages are translation keys under the `validation`
 * namespace, rendered by <Field>.
 */
export const requiredText = (max = 200) =>
  z.string().trim().min(1, { message: 'required' }).max(max, { message: 'too_long' });

export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, { message: 'too_long' })
    .optional()
    .transform((v) => (v ? v : null));

export const email = z.email({ message: 'invalid_email' }).trim().toLowerCase();

export const password = z
  .string()
  .min(8, { message: 'password_min' })
  .max(72, { message: 'too_long' })
  .regex(/[A-Za-z]/, { message: 'password_letters_digits' })
  .regex(/\d/, { message: 'password_letters_digits' });

/** Saudi-friendly phone: accepts 05XXXXXXXX, 5XXXXXXXX, +9665XXXXXXXX or any E.164; normalizes to E.164. */
export const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .transform((v) => {
    if (/^05\d{8}$/.test(v)) return `+966${v.slice(1)}`;
    if (/^5\d{8}$/.test(v)) return `+966${v}`;
    if (/^00\d{8,15}$/.test(v)) return `+${v.slice(2)}`;
    return v;
  })
  .refine((v) => /^\+[1-9]\d{7,14}$/.test(v), { message: 'invalid_phone' });

export const optionalPhone = z
  .string()
  .trim()
  .optional()
  .transform((v) => v ?? '')
  .pipe(z.union([z.literal('').transform(() => null), phone]));

export const url = z
  .string()
  .trim()
  .transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v))
  .pipe(z.union([z.literal(''), z.url({ message: 'invalid_url' })]))
  .transform((v) => (v ? v : null));

export const localizedText = (max = 120) =>
  z
    .object({ ar: z.string().trim().max(max, { message: 'too_long' }), en: z.string().trim().max(max, { message: 'too_long' }) })
    .refine((v) => v.ar.length > 0 || v.en.length > 0, { message: 'required_one_language', path: ['ar'] });

export const uuid = z.uuid();

export const localeSchema = z.enum(['ar', 'en']);
