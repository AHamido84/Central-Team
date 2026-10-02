import 'server-only';

import { sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { cache } from 'react';

import { getSession, type Session } from '@/lib/auth/session';
import { dbAdmin, type Tx } from '@/lib/db/client';
import type { LocalizedText } from '@/lib/i18n/localized';

export class UnauthenticatedError extends Error {
  constructor() {
    super('unauthenticated');
  }
}

/** The portal user's chosen client (ADR-091). Server-set, httpOnly; the database re-checks membership. */
export const ACTIVE_CLIENT_COOKIE = 'active_client';

export type PortalMembership = {
  id: string;
  name: LocalizedText;
  logoPath: string | null;
  roleKey: string;
  roleName: LocalizedText;
  canApprove: boolean;
  lastUsedAt: string | null;
  pendingApprovals: number;
};

export type PortalScope = {
  /** Every client the user belongs to (switcher, "choose an account", badges). */
  clients: PortalMembership[];
  /** The client every query of this request is scoped to; null for agency users and users without a client. */
  activeClientId: string | null;
  /** Several clients, none chosen yet and none used before: the portal asks first ("choose an account"). */
  needsChoice: boolean;
};

async function readActiveClientCookie(): Promise<string | null> {
  try {
    return (await cookies()).get(ACTIVE_CLIENT_COOKIE)?.value ?? null;
  } catch {
    // Outside a request (scripts, tests): no cookie, the last used or first client applies.
    return null;
  }
}

/**
 * Resolves the portal user's active client once per request (FR4.3, ADR-091): the cookie when it names one of their
 * clients, otherwise the client they used last, otherwise their first. Reads the full list unscoped (through
 * `app.my_portal_clients()`, display fields only) — everything else then runs scoped to the chosen client.
 */
export const getPortalScope = cache(async (session: Session): Promise<PortalScope> => {
  if (session.app.user_type === 'agency') return { clients: [], activeClientId: null, needsChoice: false };
  const rows = await runAs(session.claims, (tx) =>
    tx.execute<{
      client_id: string;
      name: LocalizedText;
      logo_path: string | null;
      role_key: string;
      role_name: LocalizedText;
      can_approve: boolean;
      last_used_at: string | null;
      pending_approvals: number;
    }>(sql`select * from app.my_portal_clients()`),
  );
  const clients: PortalMembership[] = rows.map((r) => ({
    id: r.client_id,
    name: r.name,
    logoPath: r.logo_path,
    roleKey: r.role_key,
    roleName: r.role_name,
    canApprove: r.can_approve,
    lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
    pendingApprovals: Number(r.pending_approvals ?? 0),
  }));
  if (clients.length === 0) return { clients, activeClientId: null, needsChoice: false };
  const cookie = await readActiveClientCookie();
  const chosen = clients.find((c) => c.id === cookie);
  const lastUsed = [...clients].filter((c) => c.lastUsedAt).sort((a, b) => (a.lastUsedAt! < b.lastUsedAt! ? 1 : -1))[0];
  const active = chosen ?? lastUsed ?? clients[0]!;
  return { clients, activeClientId: active.id, needsChoice: !chosen && !lastUsed && clients.length > 1 };
});

/**
 * Runs `fn` in a transaction as Postgres role `authenticated` with the user's verified JWT claims,
 * so every query is filtered by RLS and `auth.uid()` works in policies and triggers (ADR-003).
 * Portal users are also scoped to their active client (`app.active_client`, ADR-091).
 */
export async function withRls<T>(fn: (tx: Tx) => Promise<T>, session?: Session | null): Promise<T> {
  const current = session ?? (await getSession());
  if (!current) throw new UnauthenticatedError();
  const scope = await getPortalScope(current);
  return runAs(current.claims, fn, scope.activeClientId);
}

/**
 * Lower-level variant used by tests and scripts that build claims themselves. `activeClient` scopes a portal user to
 * one client; without it they see every client they belong to.
 */
export async function runAs<T>(claims: Record<string, unknown>, fn: (tx: Tx) => Promise<T>, activeClient?: string | null): Promise<T> {
  return dbAdmin.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true), set_config('role', 'authenticated', true),
        set_config('app.active_client', ${activeClient ?? ''}, true)`,
    );
    return fn(tx);
  });
}
