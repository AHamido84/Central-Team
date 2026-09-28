import { NextResponse, type NextRequest } from 'next/server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ACTIVE_CLIENT_COOKIE } from '@/lib/auth/context';

async function signOut(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const reason = request.nextUrl.searchParams.get('reason');
  const target = new URL('/login', request.nextUrl.origin);
  if (reason === 'no_access') target.searchParams.set('error', 'no_access');
  const response = NextResponse.redirect(target, { status: 303 });
  response.cookies.delete(ACTIVE_CLIENT_COOKIE);
  return response;
}

export const GET = signOut;
export const POST = signOut;
