import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';
import { cache } from 'react';

import { getSession, type Session, type UserType } from '@/lib/auth/session';
import { withRls } from '@/lib/db/rls';
import {
  clientUsers,
  clients,
  featureFlags,
  organizationMembers,
  organizations,
  profiles,
  roles,
} from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import { can, type PermissionSet } from '@/lib/permissions/can';
import type { Permission } from '@/lib/permissions/catalog';

export const ACTIVE_CLIENT_COOKIE = 'active_client';

export type Profile = typeof profiles.$inferSelect;
export type Organization = typeof organizations.$inferSelect;

export type PortalClient = {
  id: string;
  name: LocalizedText;
  logoPath: string | null;
  roleKey: string;
  roleName: LocalizedText;
  canApprove: boolean;
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
};
export type AppContext = AgencyContext | ClientContext;

/**
 * Loads everything the shells need in one RLS-scoped transaction. Re-validates membership against
 * the database, so a stale JWT (e.g. a just-deactivated user) cannot pass the layout guard.
 */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const session = await getSession();
  if (!session) return null;
  const cookieStore = await cookies();
  const preferredClient = cookieStore.get(ACTIVE_CLIENT_COOKIE)?.value;

  return withRls(async (tx) => {
    const [profile] = await tx.select().from(profiles).where(eq(profiles.id, session.userId));
    if (!profile) return null;

    const memberships = await tx
      .select()
      .from(organizationMembers)
      .where(
        and(eq(organizationMembers.userId, session.userId), eq(organizationMembers.status, 'active')),
      )
      .orderBy(sql`${organizationMembers.userType} = 'agency' desc`, asc(organizationMembers.createdAt));
    const membership = memberships[0];
    if (!membership) return null;

    const [organization] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, membership.organizationId));
    if (!organization) return null;

    const flagRows = await tx
      .select({
        key: featureFlags.key,
        enabled: sql<boolean>`app.feature_enabled(${organization.id}, ${featureFlags.key})`,
      })
      .from(featureFlags);
    const flags = Object.fromEntries(flagRows.map((f) => [f.key, f.enabled]));

    if (membership.userType === 'agency') {
      const perms = await tx.execute<{ key: string }>(
        sql`select app.effective_permissions(${organization.id}) as key`,
      );
      const [superAdmin] = await tx.execute<{ is: boolean }>(
        sql`select app.is_super_admin(${organization.id}) as is`,
      );
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

    const clientRows = await tx
      .select({
        id: clients.id,
        name: clients.name,
        logoPath: clients.logoPath,
        roleKey: roles.key,
        roleName: roles.name,
        canApprove: clientUsers.canApprove,
      })
      .from(clientUsers)
      .innerJoin(clients, eq(clients.id, clientUsers.clientId))
      .innerJoin(roles, eq(roles.id, clientUsers.roleId))
      .where(and(eq(clientUsers.userId, session.userId), eq(clientUsers.status, 'active')))
      .orderBy(asc(clientUsers.createdAt));
    if (clientRows.length === 0) return null;
    const client = clientRows.find((c) => c.id === preferredClient) ?? clientRows[0]!;
    const perms = await tx.execute<{ key: string }>(
      sql`select app.client_effective_permissions(${client.id}) as key`,
    );
    return {
      side: 'client',
      session,
      profile,
      organization,
      permissions: new Set(perms.map((p) => p.key)),
      flags,
      client,
      clients: clientRows,
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
  if (!can(ctx.permissions, 'portal:access')) forbidden();
  if (permission && !can(ctx.permissions, permission)) forbidden();
  return ctx;
}

export async function requireSignedIn(): Promise<AppContext> {
  return requireContext();
}

export function sideHome(side: UserType) {
  return homeFor(side);
}
