import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase/server';

const allowedTypes: EmailOtpType[] = ['magiclink', 'recovery', 'email_change', 'email', 'signup'];

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

/** Verifies email links (magic link, recovery, email change) using token_hash — no PKCE state needed. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const next = safeNext(url.searchParams.get('next'));

  if (tokenHash && type && allowedTypes.includes(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      const target = type === 'email_change' ? `${next === '/' ? '/' : next}?email_changed=1` : next;
      return NextResponse.redirect(new URL(target, url.origin));
    }
  }
  return NextResponse.redirect(new URL('/login?error=link_invalid', url.origin));
}
