import 'server-only';

import { and, asc, desc, eq, sql } from 'drizzle-orm';

import type { AgencyContext } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import {
  departmentMembers,
  departments,
  invitations,
  organizationMembers,
  permissions,
  profiles,
  rolePermissions,
  roles,
  userPermissionOverrides,
  userRoles,
} from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';

export type TeamMember = {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  avatarPath: string | null;
  jobTitle: string | null;
  status: 'active' | 'deactivated';
  joinedAt: string;
  onboarded: boolean;
  roleIds: string[];
  departmentIds: string[];
  leadOf: string[];
  overrides: { permissionKey: string; effect: 'grant' | 'deny'; reason: string | null }[];
};

export type RoleSummary = {
  id: string;
  key: string;
  name: LocalizedText;
  description: LocalizedText;
  side: 'agency' | 'client';
  isSystem: boolean;
  isLocked: boolean;
  permissionKeys: string[];
  memberCount: number;
};

export type PermissionRow = {
  key: string;
  resource: string;
  action: string;
  side: 'agency' | 'client';
  module: string;
  label: LocalizedText;
};

export async function listPermissions(): Promise<PermissionRow[]> {
  return withRls(async (tx) => {
    const rows = await tx.select().from(permissions).orderBy(asc(permissions.sortOrder));
    return rows.map((p) => ({ key: p.key, resource: p.resource, action: p.action, side: p.side as 'agency' | 'client', module: p.module, label: p.label }));
  });
}

export async function listRoles(ctx: AgencyContext): Promise<RoleSummary[]> {
  return withRls(async (tx) => {
    const roleRows = await tx.select().from(roles).where(eq(roles.organizationId, ctx.organization.id)).orderBy(asc(roles.sortOrder), asc(roles.createdAt));
    const grants = await tx.select().from(rolePermissions).where(eq(rolePermissions.organizationId, ctx.organization.id));
    const counts = await tx
      .select({ roleId: userRoles.roleId, n: sql<number>`count(*)::int` })
      .from(userRoles)
      .where(eq(userRoles.organizationId, ctx.organization.id))
      .groupBy(userRoles.roleId);
    const clientCounts = await tx.execute<{ role_id: string; n: number }>(
      sql`select role_id, count(*)::int as n from public.client_users where organization_id = ${ctx.organization.id} and status = 'active' group by role_id`,
    );
    return roleRows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      side: r.side as 'agency' | 'client',
      isSystem: r.isSystem,
      isLocked: r.isLocked,
      permissionKeys: grants.filter((g) => g.roleId === r.id).map((g) => g.permissionKey),
      memberCount: (counts.find((c) => c.roleId === r.id)?.n ?? 0) + (clientCounts.find((c) => c.role_id === r.id)?.n ?? 0),
    }));
  });
}

export async function listTeam(ctx: AgencyContext): Promise<TeamMember[]> {
  return withRls(async (tx) => {
    const rows = await tx
      .select({
        userId: profiles.id,
        name: profiles.fullName,
        email: profiles.email,
        phone: profiles.phone,
        avatarPath: profiles.avatarPath,
        onboardedAt: profiles.onboardedAt,
        jobTitle: organizationMembers.jobTitle,
        status: organizationMembers.status,
        joinedAt: organizationMembers.joinedAt,
      })
      .from(organizationMembers)
      .innerJoin(profiles, eq(profiles.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.organizationId, ctx.organization.id), eq(organizationMembers.userType, 'agency')))
      .orderBy(asc(profiles.fullName));
    const ur = await tx.select({ userId: userRoles.userId, roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.organizationId, ctx.organization.id));
    const dm = await tx
      .select({ userId: departmentMembers.userId, departmentId: departmentMembers.departmentId, isLead: departmentMembers.isLead })
      .from(departmentMembers)
      .where(eq(departmentMembers.organizationId, ctx.organization.id));
    const ov = await tx.select().from(userPermissionOverrides).where(eq(userPermissionOverrides.organizationId, ctx.organization.id));
    return rows.map((r) => ({
      userId: r.userId,
      name: r.name || r.email,
      email: r.email,
      phone: r.phone,
      avatarPath: r.avatarPath,
      jobTitle: r.jobTitle,
      status: r.status as 'active' | 'deactivated',
      joinedAt: r.joinedAt.toISOString(),
      onboarded: Boolean(r.onboardedAt),
      roleIds: ur.filter((x) => x.userId === r.userId).map((x) => x.roleId),
      departmentIds: dm.filter((x) => x.userId === r.userId).map((x) => x.departmentId),
      leadOf: dm.filter((x) => x.userId === r.userId && x.isLead).map((x) => x.departmentId),
      overrides: ov
        .filter((o) => o.userId === r.userId)
        .map((o) => ({ permissionKey: o.permissionKey, effect: o.effect as 'grant' | 'deny', reason: o.reason })),
    }));
  });
}

export type InvitationRow = {
  id: string;
  email: string;
  fullName: string | null;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  roleIds: string[];
  departmentId: string | null;
  invitedByName: string | null;
  sendCount: number;
  lastSentAt: string;
  expiresAt: string;
  createdAt: string;
};

export async function listTeamInvitations(ctx: AgencyContext): Promise<InvitationRow[]> {
  return withRls(async (tx) => {
    const rows = await tx
      .select({ inv: invitations, inviter: profiles.fullName })
      .from(invitations)
      .leftJoin(profiles, eq(profiles.id, invitations.invitedBy))
      .where(and(eq(invitations.organizationId, ctx.organization.id), eq(invitations.userType, 'agency')))
      .orderBy(desc(invitations.createdAt))
      .limit(200);
    return rows.map(({ inv, inviter }) => ({
      id: inv.id,
      email: inv.email,
      fullName: inv.fullName,
      status: inv.status === 'pending' && inv.expiresAt.getTime() < Date.now() ? 'expired' : (inv.status as InvitationRow['status']),
      roleIds: inv.roleIds,
      departmentId: inv.departmentId,
      invitedByName: inviter,
      sendCount: inv.sendCount,
      lastSentAt: inv.lastSentAt.toISOString(),
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
    }));
  });
}

export async function listDepartments(ctx: AgencyContext) {
  return withRls((tx) =>
    tx.select().from(departments).where(eq(departments.organizationId, ctx.organization.id)).orderBy(asc(departments.sortOrder), asc(departments.createdAt)),
  );
}
