'use server';

import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { ActionFailure, type ActionResult } from '@/lib/actions/errors';
import { defineAction } from '@/lib/actions/define-action';
import { getSession } from '@/lib/auth/session';
import { withRls } from '@/lib/db/rls';
import { profiles } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { LOCALE_COOKIE, TIMEZONE_COOKIE } from '@/i18n/request';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PUBLIC_ASSETS_BUCKET, storagePaths } from '@/lib/storage';
import { localeSchema, optionalPhone, requiredText } from '@/lib/validation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const cookieOptions = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' as const };

/** Works signed in or out (login page switcher). Signed-in users also get the profile updated. */
export async function setLocaleAction(locale: 'ar' | 'en'): Promise<ActionResult<null>> {
  const parsed = localeSchema.safeParse(locale);
  if (!parsed.success) return { ok: false, error: { code: 'validation' } };
  (await cookies()).set(LOCALE_COOKIE, parsed.data, cookieOptions);
  const session = await getSession();
  if (session) {
    await withRls((tx) => tx.update(profiles).set({ locale: parsed.data }).where(eq(profiles.id, session.userId)), session);
    // Keep auth emails (magic link, reset) in the same language.
    const supabase = await createSupabaseServerClient();
    await supabase.auth.updateUser({ data: { locale: parsed.data } });
  }
  return { ok: true, data: null };
}

export async function setThemeAction(theme: 'system' | 'light' | 'dark'): Promise<ActionResult<null>> {
  const parsed = z.enum(['system', 'light', 'dark']).safeParse(theme);
  if (!parsed.success) return { ok: false, error: { code: 'validation' } };
  const session = await getSession();
  if (session) {
    await withRls((tx) => tx.update(profiles).set({ theme: parsed.data }).where(eq(profiles.id, session.userId)), session);
  }
  return { ok: true, data: null };
}

const avatarUploadSchema = z.object({
  contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  size: z
    .number()
    .int()
    .positive()
    .max(2 * 1024 * 1024),
});

/** Issues a one-time signed upload URL for the caller's own avatar (public-assets bucket). */
export async function requestAvatarUploadAction(
  input: z.input<typeof avatarUploadSchema>,
): Promise<ActionResult<{ path: string; token: string; signedUrl: string }>> {
  const parsed = avatarUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: 'file_too_large' } };
  const session = await getSession();
  if (!session) return { ok: false, error: { code: 'unauthenticated' } };
  const ext = parsed.data.contentType.split('/')[1]!.replace('jpeg', 'jpg');
  const path = storagePaths.avatar(session.userId, crypto.randomUUID(), ext);
  // Service role only mints a URL scoped to the caller's own avatar path.
  const { data, error } = await supabaseAdmin().storage.from(PUBLIC_ASSETS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: { code: 'upload_failed' } };
  return { ok: true, data: { path, token: data.token, signedUrl: data.signedUrl } };
}

const avatarPath = z
  .string()
  .regex(/^avatars\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp)$/)
  .nullable();

const onboardingSchema = z.object({
  fullName: requiredText(120),
  phone: optionalPhone,
  whatsapp: optionalPhone,
  avatarPath,
  locale: localeSchema,
  theme: z.enum(['system', 'light', 'dark']),
});

export async function completeOnboardingAction(input: z.input<typeof onboardingSchema>): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'validation', fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> } };
  }
  const session = await getSession();
  if (!session) return { ok: false, error: { code: 'unauthenticated' } };
  const data = parsed.data;
  if (data.avatarPath && !data.avatarPath.startsWith(`avatars/${session.userId}/`)) {
    return { ok: false, error: { code: 'forbidden' } };
  }
  try {
    await withRls(async (tx) => {
      const [updated] = await tx
        .update(profiles)
        .set({
          fullName: data.fullName,
          phone: data.phone,
          whatsapp: data.whatsapp ?? data.phone,
          avatarPath: data.avatarPath,
          locale: data.locale,
          theme: data.theme,
          onboardedAt: new Date(),
        })
        .where(eq(profiles.id, session.userId))
        .returning({ id: profiles.id });
      if (!updated) throw new ActionFailure('not_found');
      if (session.app.org_id) {
        await emitEvent(tx, {
          type: 'user.onboarded',
          organizationId: session.app.org_id,
          actorId: session.userId,
          aggregate: { type: 'user', id: session.userId },
          payload: { userId: session.userId },
        });
      }
    }, session);
  } catch (error) {
    if (error instanceof ActionFailure) return { ok: false, error: { code: error.code } };
    throw error;
  }
  (await cookies()).set(LOCALE_COOKIE, data.locale, cookieOptions);
  const supabase = await createSupabaseServerClient();
  await supabase.auth.updateUser({ data: { locale: data.locale, full_name: data.fullName } });
  // Refresh the JWT so the `onboarded` claim used by proxy.ts is current.
  await supabase.auth.refreshSession();
  return { ok: true, data: { redirectTo: session.app.user_type === 'client' ? '/portal' : '/dashboard' } };
}

const profileSchema = z.object({
  fullName: requiredText(120),
  phone: optionalPhone,
  whatsapp: optionalPhone,
  avatarPath,
});

export const updateProfileAction = defineAction({
  input: profileSchema,
  side: 'any',
  async handler({ input, tx, ctx }) {
    if (input.avatarPath && !input.avatarPath.startsWith(`avatars/${ctx.session.userId}/`)) {
      throw new ActionFailure('forbidden');
    }
    await tx
      .update(profiles)
      .set({ fullName: input.fullName, phone: input.phone, whatsapp: input.whatsapp, avatarPath: input.avatarPath })
      .where(eq(profiles.id, ctx.session.userId));
    await emitEvent(tx, {
      type: 'user.profile_updated',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'user', id: ctx.session.userId },
      payload: { userId: ctx.session.userId, fields: ['fullName', 'phone', 'whatsapp', 'avatarPath'] },
    });
    return null;
  },
  revalidate: ['/'],
});

const preferencesSchema = z.object({
  locale: localeSchema,
  theme: z.enum(['system', 'light', 'dark']),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf('timeZone').includes(tz) || tz === 'UTC'),
  calendar: z.enum(['gregory', 'islamic-umalqura']),
});

export const updatePreferencesAction = defineAction({
  input: preferencesSchema,
  side: 'any',
  async handler({ input, tx, ctx }) {
    await tx.update(profiles).set(input).where(eq(profiles.id, ctx.session.userId));
    return input;
  },
  async after({ input }) {
    const store = await cookies();
    store.set(LOCALE_COOKIE, input.locale, cookieOptions);
    store.set(TIMEZONE_COOKIE, input.timezone, cookieOptions);
    const supabase = await createSupabaseServerClient();
    await supabase.auth.updateUser({ data: { locale: input.locale } });
  },
  revalidate: ['/'],
});

const emailChangeSchema = z.object({ email: z.email({ message: 'invalid_email' }).trim().toLowerCase() });

/** Starts Supabase's secure email change; the new address must be confirmed from the emailed link. */
export async function requestEmailChangeAction(input: z.input<typeof emailChangeSchema>): Promise<ActionResult<null>> {
  const parsed = emailChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: 'validation', fieldErrors: { email: ['invalid_email'] } } };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser(
    { email: parsed.data.email },
    { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm` },
  );
  if (error) return { ok: false, error: { code: error.status === 429 ? 'rate_limited' : 'conflict' } };
  return { ok: true, data: null };
}

const passwordSchema = z.object({
  password: z
    .string()
    .min(8, { message: 'password_min' })
    .regex(/[A-Za-z]/, { message: 'password_letters_digits' })
    .regex(/\d/, { message: 'password_letters_digits' }),
});

export async function changePasswordAction(input: z.input<typeof passwordSchema>): Promise<ActionResult<null>> {
  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'validation', fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> } };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: { code: error.code === 'weak_password' ? 'weak_password' : 'unknown' } };
  return { ok: true, data: null };
}
