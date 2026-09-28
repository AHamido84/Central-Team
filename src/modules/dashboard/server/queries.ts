import 'server-only';

import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';

import type { AgencyContext } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import {
  activityLog,
  clients,
  comments,
  departmentMembers,
  departments,
  invitations,
  organizationMembers,
  profiles,
  roles,
  threads,
  userRoles,
} from '@/lib/db/schema';
import { can } from '@/lib/permissions/can';

export async function getAgencyDashboard(ctx: AgencyContext) {
  const orgId = ctx.organization.id;
  const userId = ctx.session.userId;
  return withRls(async (tx) => {
    const myRoles = await tx
      .select({ name: roles.name, key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(userRoles.organizationId, orgId)))
      .orderBy(asc(roles.sortOrder));

    const myDepartments = await tx
      .select({ name: departments.name, isLead: departmentMembers.isLead })
      .from(departmentMembers)
      .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
      .where(eq(departmentMembers.userId, userId));

    const deptRows = await tx
      .select({ id: departments.id, key: departments.key, name: departments.name, color: departments.color, icon: departments.icon })
      .from(departments)
      .where(and(eq(departments.organizationId, orgId), eq(departments.isArchived, false)))
      .orderBy(asc(departments.sortOrder));
    const deptMembers = await tx
      .select({
        departmentId: departmentMembers.departmentId,
        userId: profiles.id,
        name: profiles.fullName,
        avatarPath: profiles.avatarPath,
      })
      .from(departmentMembers)
      .innerJoin(profiles, eq(profiles.id, departmentMembers.userId))
      .innerJoin(
        organizationMembers,
        and(eq(organizationMembers.userId, profiles.id), eq(organizationMembers.organizationId, orgId), eq(organizationMembers.status, 'active')),
      );
    const team = deptRows.map((d) => ({ ...d, members: deptMembers.filter((m) => m.departmentId === d.id) }));

    const [teamCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userType, 'agency'), eq(organizationMembers.status, 'active')));

    // RLS already limits clients to the ones this user can access.
    const clientRows = await tx
      .select({ id: clients.id, name: clients.name, status: clients.status, logoPath: clients.logoPath, accountManagerId: clients.accountManagerId })
      .from(clients)
      .where(eq(clients.organizationId, orgId))
      .orderBy(asc(sql`${clients.name}->>'en'`));

    const pendingInvitations = can(ctx.permissions, 'invitations:read')
      ? await tx
          .select({ id: invitations.id, email: invitations.email, fullName: invitations.fullName, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
          .from(invitations)
          .where(and(eq(invitations.organizationId, orgId), eq(invitations.userType, 'agency'), eq(invitations.status, 'pending'), gt(invitations.expiresAt, new Date())))
          .orderBy(desc(invitations.createdAt))
          .limit(5)
      : null;

    const clientIds = clientRows.map((c) => c.id);
    const recentThreads = clientIds.length
      ? await tx
          .select({
            id: threads.id,
            title: threads.title,
            clientId: threads.clientId,
            lastCommentAt: threads.lastCommentAt,
            visibility: threads.visibility,
            preview: sql<string | null>`(select c.body from public.comments c where c.thread_id = threads.id order by c.created_at desc limit 1)`,
            lastAuthor: sql<string | null>`(select p.full_name from public.comments c join public.profiles p on p.id = c.author_id where c.thread_id = threads.id order by c.created_at desc limit 1)`,
            lastAuthorSide: sql<string | null>`(select c.author_side from public.comments c where c.thread_id = threads.id order by c.created_at desc limit 1)`,
          })
          .from(threads)
          .where(inArray(threads.clientId, clientIds))
          .orderBy(desc(threads.lastCommentAt))
          .limit(6)
      : [];

    const [waitingOnUs] = clientIds.length
      ? await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(threads)
          .where(
            and(
              inArray(threads.clientId, clientIds),
              sql`(select c.author_side from ${comments} c where c.thread_id = threads.id order by c.created_at desc limit 1) = 'client'`,
            ),
          )
      : [{ n: 0 }];

    const recentActivity = can(ctx.permissions, 'audit_log:read')
      ? await tx
          .select({
            id: activityLog.id,
            action: activityLog.action,
            tableName: activityLog.tableName,
            createdAt: activityLog.createdAt,
            actorName: profiles.fullName,
            actorAvatar: profiles.avatarPath,
          })
          .from(activityLog)
          .leftJoin(profiles, eq(profiles.id, activityLog.actorId))
          .where(and(eq(activityLog.organizationId, orgId), sql`${activityLog.actorId} is not null`))
          .orderBy(desc(activityLog.createdAt))
          .limit(6)
      : null;

    return {
      myRoles,
      myDepartments,
      team,
      teamCount: teamCount?.n ?? 0,
      clients: clientRows,
      myClients: clientRows.filter((c) => c.accountManagerId === userId),
      pendingInvitations,
      recentThreads,
      waitingOnUs: waitingOnUs?.n ?? 0,
      recentActivity,
    };
  });
}
