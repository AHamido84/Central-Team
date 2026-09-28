'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

export function getSupabaseBrowserClient(): SupabaseClient {
  client ??= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
  return client;
}

/**
 * Realtime validates `postgres_changes` subscriptions with the token present at join time. Make sure the
 * user's access token (not the anon key) is set before subscribing, or RLS-protected tables are rejected.
 */
export async function ensureRealtimeAuth(): Promise<SupabaseClient> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  if (data.session) await supabase.realtime.setAuth(data.session.access_token);
  return supabase;
}
