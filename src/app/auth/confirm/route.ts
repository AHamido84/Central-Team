import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { scheduleEventDispatch } from '@/lib/events/schedule';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const allowedTypes: EmailOtpType[] = ['magiclink', 'recovery', 'email_change', 'email', 'signup'];

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

/**
 * Verifies email links (magic link, recovery, email change). Our templates send `token_hash` (no PKCE state needed);
 * `code` covers links built from Supabase's default templates (PKCE). Email changes land on /email-change, which says
 * whether the change is complete or still waits for the other address (ADR-087).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  if (tokenHash && type && allowedTypes.includes(type)) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (type === 'email_change') {
      // GoTrue answers `otp_expired` for used, replaced, cancelled and expired links alike.
      if (error) return to('/email-change?status=invalid');
      // With double confirmation the first link only records one side: GoTrue returns no user until both are opened.
      if (!data.user) return to('/email-change?status=pending');
      // The auth.users trigger recorded `user.email_changed` on GoTrue's connection: deliver its notices now.
      scheduleEventDispatch();
      return to('/email-change?status=done');
    }
    if (!error) return to(next);
  } else if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (type === 'email_change') scheduleEventDispatch();
      return to(type === 'email_change' ? '/email-change?status=done' : next);
    }
  } else if (url.searchParams.get('error_code') && type === 'email_change') {
    return to('/email-change?status=invalid');
  }
  return to('/login?error=link_invalid');
}
