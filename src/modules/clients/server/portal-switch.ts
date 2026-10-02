import 'server-only';

import { sql } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { getSession } from '@/lib/auth/session';
import { ACTIVE_CLIENT_COOKIE, getPortalScope, runAs } from '@/lib/db/rls';

/**
 * Makes `clientId` the portal user's active client (FR4.3, ADR-091): checks the membership, sets the httpOnly cookie
 * every later request is scoped by, and remembers the client for the next sign-in. Returns false for a client the user
 * doesn't belong to (nothing changes).
 */
export async function activatePortalClient(clientId: string): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  const scope = await getPortalScope(session);
  if (!scope.clients.some((c) => c.id === clientId)) return false;
  (await cookies()).set(ACTIVE_CLIENT_COOKIE, clientId, {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 31_536_000,
  });
  // The function re-checks the membership as the user (security definer, `auth.uid()`).
  await runAs(session.claims, (tx) => tx.execute(sql`select app.touch_portal_client(${clientId}::uuid)`), clientId);
  return true;
}
