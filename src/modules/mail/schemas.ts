import { z } from 'zod';

import { mailPresets, mailSecurities, presetDefaults } from '@/modules/mail/constants';

const optionalEmail = z
  .union([z.literal(''), z.email({ message: 'invalid_email' }).trim().toLowerCase().max(254)])
  .optional()
  .transform((v) => v || null);

/** Settings → Mail form (FR2.1). The secret is optional on update: blank keeps the stored one. */
export const mailSettingsSchema = z
  .object({
    preset: z.enum(mailPresets),
    host: z
      .string()
      .trim()
      .max(253)
      .optional()
      .transform((v) => v || null),
    port: z.coerce.number().int().min(1).max(65535).nullable().optional(),
    security: z.enum(mailSecurities),
    username: z
      .string()
      .trim()
      .max(254)
      .optional()
      .transform((v) => v || null),
    secret: z
      .string()
      .max(500)
      .optional()
      .transform((v) => v?.trim() || null),
    fromNameAr: z.string().trim().max(120).optional().default(''),
    fromNameEn: z.string().trim().max(120).optional().default(''),
    fromEmail: z.email({ message: 'invalid_email' }).trim().toLowerCase().max(254),
    replyTo: optionalEmail,
    dailyLimit: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    const api = presetDefaults[v.preset].api;
    if (!api && !(v.host || presetDefaults[v.preset].host)) ctx.addIssue({ code: 'custom', path: ['host'], message: 'required' });
    if (!api && !v.username && v.preset !== 'smtp') ctx.addIssue({ code: 'custom', path: ['username'], message: 'required' });
  });

export type MailSettingsInput = z.input<typeof mailSettingsSchema>;

/**
 * Gmail / Workspace / Outlook / Zoho rewrite or reject a From address other than the signed-in account (or a verified
 * alias): warn before saving.
 */
export function fromMismatch(v: { preset: string; username?: string | null; fromEmail: string }): boolean {
  const d = presetDefaults[v.preset as keyof typeof presetDefaults];
  if (!d?.fromMustMatchUser || !v.username) return false;
  return v.username.trim().toLowerCase() !== v.fromEmail.trim().toLowerCase();
}
