import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';
import { forbidden, redirect } from 'next/navigation';
import { cache } from 'react';

import { getSession, type Session, type UserType } from '@/lib/auth/session';
import { ACTIVE_CLIENT_COOKIE, getPortalScope, withRls } from '@/lib/db/rls';
import { featureFlags, organizationMembers, organizations, profiles } from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import { can, type PermissionSet } from '@/lib/permissions/can';
import type { Permission } from '@/lib/permissions/catalog';

export { ACTIVE_CLIENT_COOKIE };

export type Profile = typeof profiles.$inferSelect;
export type Organization = typeof organizations.$inferSelect;

export type PortalClient = {
  id: string;
  name: LocalizedText;
  logoPath: string | null;
  roleKey: string;
  roleName: LocalizedText;
  canApprove: boolean;
  /** Deliverables waiting for this client's approval (switcher badge). */
  pendingApprovals: number;
};

type BaseContext = {
  session: Session;
  profile: Profile;
  organization: Organization;
  permissions: PermissionSet;
  flags: Record<string, boolean>;
};

export type AgencyContext = BaseContext & { side: 'agency'; isSuperAdmin: boolean };
export type ClientContext = BaseContext & {
  side: 'client';
  client: PortalClient;
  clients: PortalClient[];
  /** Several clients and none chosen yet: the portal shows "choose an account" first (FR4.3). */
  needsChoice: boolean;
};
export type AppContext = AgencyContext | ClientContext;

/**
 * Loads everything the shells need in one RLS-scoped transaction. Re-validates membership against
 * the database, so a stale JWT (e.g. a just-deactivated user) cannot pass the layout guard.
 */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const session = await getSession();
  if (!session) return null;
  // The portal user's clients and the one this request is scoped to (ADR-091); empty for agency users.
  const scope = await getPortalScope(session);

  return withRls(async (tx) => {
    const [profile] = await tx.select().from(profiles).where(eq(profiles.id, session.userId));
    if (!profile) return null;

    const memberships = await tx
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.userId, session.userId), eq(organizationMembers.status, 'active')))
      .orderBy(sql`${organizationMembers.userType} = 'agency' desc`, asc(organizationMembers.createdAt));
    const membership = memberships[0];
    if (!membership) return null;

    const [organization] = await tx.select().from(organizations).where(eq(organizations.id, membership.organizationId));
    if (!organization) return null;

    const flagRows = await tx
      .select({
        key: featureFlags.key,
        enabled: sql<boolean>`app.feature_enabled(${organization.id}, ${featureFlags.key})`,
      })
      .from(featureFlags);
    const flags = Object.fromEntries(flagRows.map((f) => [f.key, f.enabled]));

    if (membership.userType === 'agency') {
      const perms = await tx.execute<{ key: string }>(sql`select app.effective_permissions(${organization.id}) as key`);
      const [superAdmin] = await tx.execute<{ is: boolean }>(sql`select app.is_super_admin(${organization.id}) as is`);
      return {
        side: 'agency',
        session,
        profile,
        organization,
        permissions: new Set(perms.map((p) => p.key)),
        flags,
        isSuperAdmin: Boolean(superAdmin?.is),
      } satisfies AgencyContext;
    }

    const clientRows: PortalClient[] = scope.clients.map((c) => ({
      id: c.id,
      name: c.name,
      logoPath: c.logoPath,
      roleKey: c.roleKey,
      roleName: c.roleName,
      canApprove: c.canApprove,
      pendingApprovals: c.pendingApprovals,
    }));
    const client = clientRows.find((c) => c.id === scope.activeClientId);
    if (!client) return null;
    const perms = await tx.execute<{ key: string }>(sql`select app.client_effective_permissions(${client.id}) as key`);
    return {
      side: 'client',
      session,
      profile,
      organization,
      permissions: new Set(perms.map((p) => p.key)),
      flags,
      client,
      clients: clientRows,
      needsChoice: scope.needsChoice,
    } satisfies ClientContext;
  }, session);
});

function homeFor(side: UserType) {
  return side === 'agency' ? '/dashboard' : '/portal';
}

async function requireContext(): Promise<AppContext> {
  const session = await getSession();
  if (!session) redirect('/login');
  const ctx = await getAppContext();
  if (!ctx) redirect('/auth/signout?reason=no_access');
  if (!ctx.profile.onboardedAt) redirect('/onboarding');
  return ctx;
}

export async function requireAgency(permission?: Permission): Promise<AgencyContext> {
  const ctx = await requireContext();
  if (ctx.side !== 'agency') redirect(homeFor(ctx.side));
  if (permission && !can(ctx.permissions, permission)) forbidden();
  return ctx;
}

export async function requireAgencyAny(permissions: readonly Permission[]): Promise<AgencyContext> {
  const ctx = await requireAgency();
  if (!permissions.some((p) => can(ctx.permissions, p))) forbidden();
  return ctx;
}

export async function requirePortal(permission?: Permission): Promise<ClientContext> {
  const ctx = await requireContext();
  if (ctx.side !== 'client') redirect(homeFor(ctx.side));
  // First visit with several clients: pick one before any client's data is shown.
  if (ctx.needsChoice) redirect('/portal/choose');
  if (!can(ctx.permissions, 'portal:access')) forbidden();
  if (permission && !can(ctx.permissions, permission)) forbidden();
  return ctx;
}

/** The "choose an account" screen: a signed-in portal user, before (or while) choosing a client. */
export async function requirePortalChooser(): Promise<ClientContext> {
  const ctx = await requireContext();
  if (ctx.side !== 'client') redirect(homeFor(ctx.side));
  if (!can(ctx.permissions, 'portal:access')) forbidden();
  return ctx;
}

export async function requireSignedIn(): Promise<AppContext> {
  return requireContext();
}

export function sideHome(side: UserType) {
  return homeFor(side);
}
