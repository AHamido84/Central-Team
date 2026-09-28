'use server';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import { organizationFeatures, organizations } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { PUBLIC_ASSETS_BUCKET, storagePaths } from '@/lib/storage';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { localizedText, optionalPhone } from '@/lib/validation';

export const toggleFeatureAction = defineAction({
  input: z.object({ flagKey: z.string().min(3).max(64), enabled: z.boolean() }),
  side: 'agency',
  permission: 'feature_flags:manage',
  async handler({ input, tx, ctx }) {
    await tx
      .insert(organizationFeatures)
      .values({ organizationId: ctx.organization.id, flagKey: input.flagKey, enabled: input.enabled, updatedBy: ctx.session.userId })
      .onConflictDoUpdate({
        target: [organizationFeatures.organizationId, organizationFeatures.flagKey],
        set: { enabled: input.enabled, updatedBy: ctx.session.userId },
      });
    await emitEvent(tx, {
      type: 'feature_flag.toggled',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'feature_flag' },
      payload: { flagKey: input.flagKey, enabled: input.enabled },
    });
    return null;
  },
  revalidate: ['/'],
});

const logoPathSchema = z
  .string()
  .regex(/^org\/[0-9a-f-]{36}\/(clients\/[0-9a-f-]{36}\/)?logo\/[0-9a-f-]{36}\.(png|jpg|webp)$/)
  .nullable();

export const updateOrganizationAction = defineAction({
  input: z.object({
    name: localizedText(100),
    supportEmail: z.union([z.literal(''), z.email({ message: 'invalid_email' })]).transform((v) => v || null),
    supportWhatsapp: optionalPhone,
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: 'required' }),
    logoPath: logoPathSchema,
    defaultLocale: z.enum(['ar', 'en']),
    defaultTimezone: z.string().refine((tz) => Intl.supportedValuesOf('timeZone').includes(tz)),
  }),
  side: 'agency',
  permission: 'organization:update',
  async handler({ input, tx, ctx }) {
    if (input.logoPath && !input.logoPath.startsWith(`org/${ctx.organization.id}/logo/`)) throw new ActionFailure('forbidden');
    const [row] = await tx
      .update(organizations)
      .set({
        name: input.name,
        supportEmail: input.supportEmail,
        supportWhatsapp: input.supportWhatsapp,
        brand: { ...ctx.organization.brand, primaryColor: input.brandColor },
        logoPath: input.logoPath,
        defaultLocale: input.defaultLocale,
        defaultTimezone: input.defaultTimezone,
      })
      .where(and(eq(organizations.id, ctx.organization.id)))
      .returning({ id: organizations.id });
    if (!row) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'organization.updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'organization', id: ctx.organization.id },
      payload: { fields: Object.keys(input) },
    });
    return null;
  },
  revalidate: ['/'],
});

/**
 * Signed upload URL for a logo (organization or client). The caller must be allowed to edit the target;
 * the path is fixed server-side so the URL cannot be used for anything else.
 */
export const requestLogoUploadAction = defineAction({
  input: z.object({
    target: z.enum(['organization', 'client']),
    clientId: z.uuid().nullable(),
    contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    size: z
      .number()
      .int()
      .positive()
      .max(2 * 1024 * 1024),
  }),
  side: 'any',
  async handler({ input, ctx }) {
    const ext = input.contentType.split('/')[1]!.replace('jpeg', 'jpg');
    let path: string;
    if (input.target === 'organization') {
      if (ctx.side !== 'agency' || !ctx.permissions.has('organization:update')) throw new ActionFailure('forbidden');
      path = storagePaths.orgLogo(ctx.organization.id, crypto.randomUUID(), ext);
    } else {
      if (!input.clientId) throw new ActionFailure('validation');
      const allowed =
        (ctx.side === 'agency' && (ctx.permissions.has('clients:update') || ctx.permissions.has('clients:create'))) ||
        (ctx.side === 'client' && ctx.client.id === input.clientId && ctx.permissions.has('portal_company:update'));
      if (!allowed) throw new ActionFailure('forbidden');
      path = storagePaths.clientLogo(ctx.organization.id, input.clientId, crypto.randomUUID(), ext);
    }
    const { data, error } = await supabaseAdmin().storage.from(PUBLIC_ASSETS_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new ActionFailure('upload_failed');
    return { path, token: data.token };
  },
});
