import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { readAppClaims } from '@/lib/auth/claims';

/** Routes reachable without a session. */
const PUBLIC_PREFIXES = [
  '/login',
  '/forgot-password',
  '/auth/',
  '/invite/',
  '/api/health',
  '/api/cron/',
  '/f/',
  '/api/public/',
  '/api/webhooks/',
  // Platform webhooks (Phase 7): every request is signature-checked in the route.
  '/api/hooks/',
];
/** Routes a signed-in user should not see (they bounce to their home). */
const GUEST_ONLY = ['/login', '/forgot-password'];
/** Routes available to any signed-in user regardless of side / onboarding state. */
const SHARED_SIGNED_IN = ['/onboarding', '/reset-password', '/auth/', '/invite/', '/api/', '/f/'];
/** The public lead form is meant to be embedded on the agency's website (iframe). */
const EMBEDDABLE = ['/f/'];

const startsWithAny = (path: string, prefixes: string[]) =>
  prefixes.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)));

function contentSecurityPolicy(nonce: string, embeddable = false) {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseWs = supabase.replace(/^http/, 'ws');
  const dev = process.env.NODE_ENV !== 'production';
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${supabase}`,
    `media-src 'self' blob: ${supabase}`,
    `font-src 'self' data:`,
    `connect-src 'self' ${supabase} ${supabaseWs}${dev ? ' ws:' : ''}`,
    `frame-src 'self' ${supabase}`,
    embeddable ? `frame-ancestors *` : `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
  ].join('; ');
}

function withSecurityHeaders(response: NextResponse, csp: string, embeddable = false) {
  response.headers.set('Content-Security-Policy', csp);
  if (!embeddable) response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  return response;
}

/**
 * Layer 1 of side separation (ARCHITECTURE §3): refreshes the Supabase session cookie and routes by
 * JWT claims only — no database calls. Layouts re-validate against the database.
 */
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const embeddable = startsWithAny(request.nextUrl.pathname, EMBEDDABLE);
  const csp = contentSecurityPolicy(nonce, embeddable);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | undefined;
  const path = request.nextUrl.pathname;

  const redirectTo = (target: string, keepNext = false) => {
    const url = request.nextUrl.clone();
    url.pathname = target;
    url.search = '';
    if (keepNext && path !== '/') url.searchParams.set('next', path + request.nextUrl.search);
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return withSecurityHeaders(redirect, csp, embeddable);
  };

  if (!claims) {
    if (path === '/' || !startsWithAny(path, PUBLIC_PREFIXES)) return redirectTo('/login', true);
    return withSecurityHeaders(response, csp, embeddable);
  }

  const app = readAppClaims(claims);
  const home = app.user_type === 'client' ? '/portal' : '/dashboard';

  if (!app.user_type) {
    if (path.startsWith('/auth/') || path.startsWith('/invite/')) return withSecurityHeaders(response, csp, embeddable);
    return redirectTo('/auth/signout');
  }
  if (startsWithAny(path, GUEST_ONLY)) return redirectTo(home);
  if (!app.onboarded && !startsWithAny(path, SHARED_SIGNED_IN)) return redirectTo('/onboarding');
  if (app.onboarded && path === '/onboarding') return redirectTo(home);
  if (path === '/') return redirectTo(home);

  if (!startsWithAny(path, SHARED_SIGNED_IN)) {
    const onPortal = path === '/portal' || path.startsWith('/portal/');
    if (app.user_type === 'client' && !onPortal) return redirectTo('/portal');
    if (app.user_type === 'agency' && onPortal) return redirectTo('/dashboard');
  }
  return withSecurityHeaders(response, csp, embeddable);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)'],
};
