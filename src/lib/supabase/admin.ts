import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

let admin: SupabaseClient | undefined;

/**
 * Service-role client. Bypasses RLS — allowed only for: invitation acceptance (creating auth users),
 * signed storage URLs issued after an RLS-checked lookup, and seeding. See CLAUDE.md §6.
 */
export function supabaseAdmin(): SupabaseClient {
  admin ??= createClient(env().NEXT_PUBLIC_SUPABASE_URL, env().SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
