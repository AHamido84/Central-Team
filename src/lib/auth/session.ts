import 'server-only';

import { cache } from 'react';

import { readAppClaims, type AppClaims } from '@/lib/auth/claims';

import { createSupabaseServerClient } from '@/lib/supabase/server';

export type { AppClaims, UserType } from '@/lib/auth/claims';
export { readAppClaims };

export type Session = {
  userId: string;
  email: string;
  /** Verified JWT claims — forwarded to Postgres as `request.jwt.claims` by `withRls`. */
  claims: Record<string, unknown>;
  app: AppClaims;
};

/** Verified session for the current request (JWT signature checked by Supabase), or null. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const claims = data.claims as Record<string, unknown>;
  return {
    userId: String(claims.sub),
    email: String(claims.email ?? ''),
    claims,
    app: readAppClaims(claims),
  };
});
