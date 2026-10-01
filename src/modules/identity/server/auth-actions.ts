'use server';

import { eq } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/errors';
import { readAppClaims } from '@/lib/auth/claims';
import { withRls } from '@/lib/db/rls';
import { profiles } from '@/lib/db/schema';
import { LOCALE_COOKIE, TIMEZONE_COOKIE } from '@/i18n/request';
import { checkRateLimit } from '@/lib/rate-limit';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { password as passwordSchema } from '@/lib/validation';
import { sendAuthLinkEmail } from '@/modules/mail/server/auth-emails';

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'local';
}

async function limited(scope: string, email?: string): Promise<boolean> {
  const ip = await clientIp();
  const byIp = await checkRateLimit(`${scope}:ip:${ip}`, 100, 15 * 60);
  const byEmail = email ? await checkRateLimit(`${scope}:email:${email}`, 10, 15 * 60) : true;
  return !(byIp && byEmail);
}

function safeNext(next: string | undefined | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

const loginSchema = z.object({
  email: z.email({ message: 'invalid_email' }).trim().toLowerCase(),
  password: z.string().min(1, { message: 'required' }),
  next: z.string().optional(),
});

/** Password sign-in. On success syncs the locale/timezone cookies from the profile. */
export async function signInWithPasswordAction(input: z.input<typeof loginSchema>): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: { code: 'validation', fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> } };
  if (await limited('login', parsed.data.email)) return { ok: false, error: { code: 'rate_limited' } };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error || !data.session) return { ok: false, error: { code: 'invalid_credentials' } };

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = (claimsData?.claims ?? {}) as Record<string, unknown>;
  const app = readAppClaims(claims);
  if (!app.user_type) {
    await supabase.auth.signOut();
    return { ok: false, error: { code: 'forbidden' } };
  }
  const session = { userId: data.user.id, email: data.user.email ?? '', claims, app };
  const profile = await withRls((tx) => tx.query.profiles.findFirst({ where: eq(profiles.id, data.user.id) }), session);
  const store = await cookies();
  if (profile) {
    store.set(LOCALE_COOKIE, profile.locale, { path: '/', maxAge: 31536000, sameSite: 'lax' });
    store.set(TIMEZONE_COOKIE, profile.timezone, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  }
  const home = app.user_type === 'client' ? '/portal' : '/dashboard';
  const next = safeNext(parsed.data.next);
  const nextMatchesSide = next && (app.user_type === 'client') === next.startsWith('/portal');
  return { ok: true, data: { redirectTo: !app.onboarded ? '/onboarding' : nextMatchesSide ? next! : home } };
}

const emailOnly = z.object({ email: z.email({ message: 'invalid_email' }).trim().toLowerCase() });

/** Magic link for existing users only (sign-up is disabled). Always reports success to avoid account enumeration. */
export async function sendMagicLinkAction(input: z.input<typeof emailOnly>): Promise<ActionResult<null>> {
  const parsed = emailOnly.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: 'validation', fieldErrors: { email: ['invalid_email'] } } };
  if (await limited('magic', parsed.data.email)) return { ok: false, error: { code: 'rate_limited' } };
  // Our sender, not GoTrue's (ADR-088); silent for unknown addresses.
  await sendAuthLinkEmail('magic_link', parsed.data.email);
  return { ok: true, data: null };
}

export async function sendPasswordResetAction(input: z.input<typeof emailOnly>): Promise<ActionResult<null>> {
  const parsed = emailOnly.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: 'validation', fieldErrors: { email: ['invalid_email'] } } };
  if (await limited('reset', parsed.data.email)) return { ok: false, error: { code: 'rate_limited' } };
  await sendAuthLinkEmail('recovery', parsed.data.email);
  return { ok: true, data: null };
}

const resetSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'passwords_mismatch', path: ['confirm'] });

/** Completes a reset: the recovery link already established a session via /auth/confirm. */
export async function resetPasswordAction(input: z.input<typeof resetSchema>): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: { code: 'validation', fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> } };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error)
    return {
      ok: false,
      error: { code: error.code === 'weak_password' ? 'weak_password' : error.code === 'same_password' ? 'validation' : 'unauthenticated' },
    };
  const { data } = await supabase.auth.getClaims();
  const app = readAppClaims((data?.claims ?? {}) as Record<string, unknown>);
  return { ok: true, data: { redirectTo: app.user_type === 'client' ? '/portal' : '/dashboard' } };
}
