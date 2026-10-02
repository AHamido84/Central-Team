import 'server-only';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { withRls } from '@/lib/db/rls';
import { clientUsers, clients, organizationMembers, portalEmailChanges, profiles, roles } from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';

export type PortalUserMembership = {
  clientUserId: string;
  clientId: string;
  clientName: LocalizedText;
  clientLogoPath: string | null;
  roleKey: string;
  canApprove: boolean;
  status: 'active' | 'deactivated';
  createdAt: string;
};

export type PortalUserSummary = {
  userId: string;
  name: string;
  email: string;
  avatarPath: string | null;
  /** The whole portal account (organization membership), separate from each client membership. */
  accountStatus: 'active' | 'deactivated';
  /** Only the memberships the caller may see: every client for agency admins, their own client for a Client Owner. */
  memberships: PortalUserMembership[];
  /** An admin's "ask the user to confirm" change waiting for the new address (FR4.1). */
  pendingEmail: { to: string; expiresAt: string } | null;
};

/**
 * Portal users with the memberships the caller can read — RLS decides (`client_users_select`): agency staff see the
 * clients they have access to, a Client Owner only their own client (FR4.2), so another client's membership never
 * shows up for them.
 */
async function load(filter: { userIds?: string[]; query?: string }): Promise<PortalUserSummary[]> {
  return withRls(async (tx) => {
    const term = filter.query?.trim().toLowerCase();
    const people = await tx
      .select({
        userId: profiles.id,
        name: profiles.fullName,
        email: profiles.email,
        avatarPath: profiles.avatarPath,
        accountStatus: organizationMembers.status,
      })
      .from(organizationMembers)
      .innerJoin(profiles, eq(profiles.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.userType, 'client'),
          filter.userIds ? inArray(organizationMembers.userId, filter.userIds) : undefined,
          term ? sql`(lower(${profiles.fullName}) like ${`%${term}%`} or lower(${profiles.email}) like ${`%${term}%`})` : undefined,
        ),
      )
      .orderBy(asc(profiles.fullName))
      .limit(term ? 12 : 500);
    if (people.length === 0) return [];
    const ids = people.map((p) => p.userId);
    const rows = await tx
      .select({
        clientUserId: clientUsers.id,
        userId: clientUsers.userId,
        clientId: clientUsers.clientId,
        clientName: clients.name,
        clientLogoPath: clients.logoPath,
        roleKey: roles.key,
        canApprove: clientUsers.canApprove,
        status: clientUsers.status,
        createdAt: clientUsers.createdAt,
      })
      .from(clientUsers)
      .innerJoin(clients, eq(clients.id, clientUsers.clientId))
      .innerJoin(roles, eq(roles.id, clientUsers.roleId))
      .where(inArray(clientUsers.userId, ids))
      .orderBy(asc(clientUsers.createdAt));
    const pending = await tx
      .select({ userId: portalEmailChanges.userId, to: portalEmailChanges.toEmail, expiresAt: portalEmailChanges.expiresAt })
      .from(portalEmailChanges)
      .where(and(inArray(portalEmailChanges.userId, ids), eq(portalEmailChanges.status, 'pending')))
      .orderBy(desc(portalEmailChanges.createdAt));
    return people.map((p) => {
      const pend = pending.find((x) => x.userId === p.userId && x.expiresAt.getTime() > Date.now());
      return {
        userId: p.userId,
        name: p.name || p.email,
        email: p.email,
        avatarPath: p.avatarPath,
        accountStatus: p.accountStatus as PortalUserSummary['accountStatus'],
        memberships: rows
          .filter((r) => r.userId === p.userId)
          .map((r) => ({
            clientUserId: r.clientUserId,
            clientId: r.clientId,
            clientName: r.clientName,
            clientLogoPath: r.clientLogoPath,
            roleKey: r.roleKey,
            canApprove: r.canApprove,
            status: r.status as PortalUserMembership['status'],
            createdAt: r.createdAt.toISOString(),
          })),
        pendingEmail: pend ? { to: pend.to, expiresAt: pend.expiresAt.toISOString() } : null,
      };
    });
  });
}

/** Admin → Users → Portal users: every portal user of the organization with the clients the admin can see. */
export function listPortalUsers(): Promise<PortalUserSummary[]> {
  return load({});
}

export async function getPortalUser(userId: string): Promise<PortalUserSummary | null> {
  const [u] = await load({ userIds: [userId] });
  return u ?? null;
}

/** "Add portal user" autocomplete (agency side): name or email, with the clients each person already has. */
export function searchPortalUsers(query: string): Promise<PortalUserSummary[]> {
  if (query.trim().length < 2) return Promise.resolve([]);
  return load({ query });
}

export type EmailLookup =
  | { kind: 'new' }
  | { kind: 'agency_member' }
  | { kind: 'portal_user'; userId: string; inClient: boolean; summary: PortalUserSummary | null };

/**
 * What an address is in this organization (FR4.1 / FR4.2): unknown, an agency team member, or an existing portal user
 * (already in `clientId` or not). Existence is a service-path read like `isExistingActiveMember` — a Client Owner can't
 * see other people's profiles, but must be told the address already has an account; the details (`summary`) come
 * through RLS, so an Owner never learns the person's other clients.
 */
export async function lookupPortalEmail(organizationId: string, email: string, clientId: string | null): Promise<EmailLookup> {
  const address = email.trim().toLowerCase();
  const [member] = await dbAdmin
    .select({ userId: organizationMembers.userId, userType: organizationMembers.userType })
    .from(organizationMembers)
    .innerJoin(profiles, eq(profiles.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        sql`${organizationMembers.deletedAt} is null`,
        sql`lower(${profiles.email}) = ${address}`,
      ),
    )
    .limit(1);
  if (!member) return { kind: 'new' };
  if (member.userType === 'agency') return { kind: 'agency_member' };
  const [inClient] = clientId
    ? await dbAdmin
        .select({ id: clientUsers.id })
        .from(clientUsers)
        .where(
          and(
            eq(clientUsers.clientId, clientId),
            eq(clientUsers.userId, member.userId),
            eq(clientUsers.status, 'active'),
            sql`${clientUsers.deletedAt} is null`,
          ),
        )
    : [];
  return { kind: 'portal_user', userId: member.userId, inClient: Boolean(inClient), summary: await getPortalUser(member.userId) };
}
