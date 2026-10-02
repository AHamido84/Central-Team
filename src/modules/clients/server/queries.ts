import 'server-only';

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { AgencyContext } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import {
  clientAssignments,
  clientNotes,
  clientPackages,
  clientUsers,
  clients,
  invitations,
  packageItems,
  packages,
  portalEmailChanges,
  profiles,
  roles,
} from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import { getCurrentPackageUsage, type PackageUsage } from '@/modules/clients/server/package-usage';

export type ClientListItem = {
  id: string;
  name: LocalizedText;
  slug: string;
  status: string;
  industry: string | null;
  city: string | null;
  logoPath: string | null;
  accountManager: { id: string; name: string; avatarPath: string | null } | null;
  portalUsers: number;
  packageName: LocalizedText | null;
  startDate: string | null;
  lastMessageAt: string | null;
};

export async function listClients(ctx: AgencyContext): Promise<ClientListItem[]> {
  return withRls(async (tx) => {
    const rows = await tx
      .select({
        c: clients,
        amName: profiles.fullName,
        amAvatar: profiles.avatarPath,
        portalUsers: sql<number>`(select count(*)::int from public.client_users cu where cu.client_id = clients.id and cu.status = 'active')`,
        packageName: sql<LocalizedText | null>`(select p.name from public.client_packages cp join public.packages p on p.id = cp.package_id where cp.client_id = clients.id and current_date between cp.period_start and cp.period_end order by cp.period_start desc limit 1)`,
        lastMessageAt: sql<string | null>`(select max(t.last_comment_at) from public.threads t where t.client_id = clients.id)`,
      })
      .from(clients)
      .leftJoin(profiles, eq(profiles.id, clients.accountManagerId))
      .where(eq(clients.organizationId, ctx.organization.id))
      .orderBy(asc(sql`${clients.name}->>'ar'`));
    return rows.map(({ c, amName, amAvatar, portalUsers, packageName, lastMessageAt }) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      status: c.status,
      industry: c.industry,
      city: c.city,
      logoPath: c.logoPath,
      accountManager: c.accountManagerId ? { id: c.accountManagerId, name: amName ?? '', avatarPath: amAvatar } : null,
      portalUsers,
      packageName,
      startDate: c.startDate,
      lastMessageAt: lastMessageAt ? new Date(lastMessageAt).toISOString() : null,
    }));
  });
}

export type ClientPortalUser = {
  clientUserId: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  avatarPath: string | null;
  jobTitle: string | null;
  roleId: string;
  roleKey: string;
  canApprove: boolean;
  status: 'active' | 'deactivated';
  joinedAt: string;
  /** An admin's "ask to confirm" email change waiting on the new address (FR4.1); only visible with the permission. */
  pendingEmail: string | null;
};

export type ClientInvitation = {
  id: string;
  email: string;
  fullName: string | null;
  roleId: string | null;
  canApprove: boolean;
  status: 'pending' | 'expired' | 'accepted' | 'revoked';
  expiresAt: string;
  lastSentAt: string;
};

export async function listClientUsers(clientId: string) {
  return withRls(async (tx) => {
    const users = await tx
      .select({ cu: clientUsers, p: profiles, roleKey: roles.key })
      .from(clientUsers)
      .innerJoin(profiles, eq(profiles.id, clientUsers.userId))
      .innerJoin(roles, eq(roles.id, clientUsers.roleId))
      .where(eq(clientUsers.clientId, clientId))
      .orderBy(asc(roles.sortOrder), asc(profiles.fullName));
    const invites = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.clientId, clientId), eq(invitations.userType, 'client'), inArray(invitations.status, ['pending'])))
      .orderBy(desc(invitations.createdAt));
    const clientRoles = await tx
      .select({ id: roles.id, key: roles.key, name: roles.name, description: roles.description })
      .from(roles)
      .where(eq(roles.side, 'client'))
      .orderBy(asc(roles.sortOrder));
    // RLS returns these rows only to callers with `client_users:update_email`.
    const pending = users.length
      ? await tx
          .select({ userId: portalEmailChanges.userId, to: portalEmailChanges.toEmail })
          .from(portalEmailChanges)
          .where(
            and(
              inArray(
                portalEmailChanges.userId,
                users.map((u) => u.p.id),
              ),
              eq(portalEmailChanges.status, 'pending'),
              sql`${portalEmailChanges.expiresAt} > now()`,
            ),
          )
      : [];
    return {
      users: users.map(({ cu, p, roleKey }) => ({
        clientUserId: cu.id,
        userId: p.id,
        name: p.fullName || p.email,
        email: p.email,
        phone: p.phone,
        avatarPath: p.avatarPath,
        jobTitle: cu.jobTitle,
        roleId: cu.roleId,
        roleKey,
        canApprove: cu.canApprove,
        status: cu.status as 'active' | 'deactivated',
        joinedAt: cu.createdAt.toISOString(),
        pendingEmail: pending.find((x) => x.userId === p.id)?.to ?? null,
      })) satisfies ClientPortalUser[],
      invitations: invites.map((i) => ({
        id: i.id,
        email: i.email,
        fullName: i.fullName,
        roleId: i.clientRoleId,
        canApprove: i.canApprove,
        status: i.expiresAt.getTime() < Date.now() ? 'expired' : 'pending',
        expiresAt: i.expiresAt.toISOString(),
        lastSentAt: i.lastSentAt.toISOString(),
      })) satisfies ClientInvitation[],
      roles: clientRoles,
    };
  });
}

export type ClientDetail = {
  client: typeof clients.$inferSelect;
  notes: string;
  accountManager: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    whatsapp: string | null;
    avatarPath: string | null;
  } | null;
  team: { userId: string; name: string; avatarPath: string | null; jobTitle: string | null }[];
  usage: PackageUsage | null;
  packageHistory: { id: string; packageName: LocalizedText; periodStart: string; periodEnd: string }[];
};

export async function getClientDetail(clientId: string): Promise<ClientDetail | null> {
  return withRls(async (tx) => {
    const [client] = await tx.select().from(clients).where(eq(clients.id, clientId));
    if (!client) return null;
    const [notes] = await tx.select({ body: clientNotes.body }).from(clientNotes).where(eq(clientNotes.clientId, clientId));
    const [am] = client.accountManagerId ? await tx.select().from(profiles).where(eq(profiles.id, client.accountManagerId)) : [];
    const team = await tx
      .select({
        userId: profiles.id,
        name: profiles.fullName,
        avatarPath: profiles.avatarPath,
        jobTitle: sql<string | null>`(select m.job_title from public.organization_members m where m.user_id = profiles.id limit 1)`,
      })
      .from(clientAssignments)
      .innerJoin(profiles, eq(profiles.id, clientAssignments.userId))
      .where(eq(clientAssignments.clientId, clientId));
    const usage = await getCurrentPackageUsage(tx, clientId);
    const history = await tx
      .select({
        id: clientPackages.id,
        packageName: packages.name,
        periodStart: clientPackages.periodStart,
        periodEnd: clientPackages.periodEnd,
      })
      .from(clientPackages)
      .innerJoin(packages, eq(packages.id, clientPackages.packageId))
      .where(eq(clientPackages.clientId, clientId))
      .orderBy(desc(clientPackages.periodStart))
      .limit(12);
    return {
      client,
      notes: notes?.body ?? '',
      accountManager: am
        ? { id: am.id, name: am.fullName, email: am.email, phone: am.phone, whatsapp: am.whatsapp, avatarPath: am.avatarPath }
        : null,
      team,
      usage,
      packageHistory: history,
    };
  });
}

export type PackageWithItems = {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  priceMinor: number | null;
  currency: string;
  isActive: boolean;
  items: { itemType: string; quantity: number }[];
  clientCount: number;
};

export async function listPackages(ctx: AgencyContext): Promise<PackageWithItems[]> {
  return withRls(async (tx) => {
    const rows = await tx
      .select({
        p: packages,
        clientCount: sql<number>`(select count(distinct cp.client_id)::int from public.client_packages cp where cp.package_id = packages.id and current_date between cp.period_start and cp.period_end)`,
      })
      .from(packages)
      .where(eq(packages.organizationId, ctx.organization.id))
      .orderBy(asc(packages.priceMinor));
    const items = await tx
      .select()
      .from(packageItems)
      .where(eq(packageItems.organizationId, ctx.organization.id))
      .orderBy(asc(packageItems.sortOrder));
    return rows.map(({ p, clientCount }) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      priceMinor: p.priceMinor,
      currency: p.currency,
      isActive: p.isActive,
      items: items.filter((i) => i.packageId === p.id).map((i) => ({ itemType: i.itemType, quantity: i.quantity })),
      clientCount,
    }));
  });
}

/** Agency members for pickers (account manager, team assignment). */
export async function listAgencyPeople(ctx: AgencyContext) {
  return withRls((tx) =>
    tx.execute<{ id: string; name: string; avatar_path: string | null; job_title: string | null }>(sql`
      select p.id, p.full_name as name, p.avatar_path, m.job_title
      from public.organization_members m join public.profiles p on p.id = m.user_id
      where m.organization_id = ${ctx.organization.id} and m.user_type = 'agency' and m.status = 'active'
      order by p.full_name`),
  );
}
