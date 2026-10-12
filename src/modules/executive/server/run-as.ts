import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { loadAppContext, type AgencyContext } from '@/lib/auth/context';
import type { Session } from '@/lib/auth/session';
import { dbAdmin } from '@/lib/db/client';
import { runAs } from '@/lib/db/rls';
import { organizationMembers, profiles } from '@/lib/db/schema';
import type { Permission } from '@/lib/permissions/catalog';

/**
 * The context of an agency member for background work done on their behalf (ADR-097): the scheduled board report
 * runs as the schedule's owner, the daily KPI snapshot as an executive of the organization. Service path: the member
 * is looked up and must still be active and hold `permission` (checked by `app.has_permission` as that member).
 * Null when they no longer qualify — the job then skips instead of reading with someone else's rights.
 */
export async function agencyContextFor(userId: string, organizationId: string, permission: Permission): Promise<AgencyContext | null> {
  const [member] = await dbAdmin
    .select({ email: profiles.email })
    .from(organizationMembers)
    .innerJoin(profiles, eq(profiles.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userType, 'agency'),
        eq(organizationMembers.status, 'active'),
        isNull(organizationMembers.deletedAt),
      ),
    );
  if (!member) return null;
  const app = { org_id: organizationId, user_type: 'agency' as const, onboarded: true };
  const claims = { sub: userId, role: 'authenticated', email: member.email, app_metadata: { app }, app };
  const allowed = await runAs(claims, async (tx) => {
    const [row] = await tx.execute<{ ok: boolean }>(sql`select app.has_permission(${organizationId}::uuid, ${permission}) as ok`);
    return Boolean(row?.ok);
  });
  if (!allowed) return null;
  const session: Session = { userId, email: member.email, claims, app };
  const ctx = await loadAppContext(session);
  return ctx && ctx.side === 'agency' ? ctx : null;
}
