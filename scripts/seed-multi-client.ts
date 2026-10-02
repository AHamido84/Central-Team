/**
 * FR4 demo persona: one portal user in three clients with a different role in each, so switching accounts, per-client
 * roles and per-client approvals are easy to try. Used by the main seed and by `seed-multi-client-standalone.ts`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../src/lib/db/schema';

export const MULTI_CLIENT_EMAIL = 'hala@group.test';

/** Owner of Darb Coffee, approving Member of Future Smile, Viewer of Najd Heritage. */
const memberships = [
  { slug: 'darb-coffee', role: 'client_owner', canApprove: true, title: 'مديرة التسويق للمجموعة' },
  { slug: 'future-smile', role: 'client_member', canApprove: true, title: 'مديرة التسويق للمجموعة' },
  { slug: 'najd-heritage', role: 'client_viewer', canApprove: false, title: 'مستشارة تسويق' },
] as const;

export async function seedMultiClientUser(
  db: PostgresJsDatabase<typeof schema>,
  supabase: SupabaseClient,
  organizationId: string,
  password: string,
): Promise<string | null> {
  const [existing] = await db.select({ id: schema.profiles.id }).from(schema.profiles).where(eq(schema.profiles.email, MULTI_CLIENT_EMAIL));
  if (existing) return null;
  const clients = await db
    .select({ id: schema.clients.id, slug: schema.clients.slug, am: schema.clients.accountManagerId })
    .from(schema.clients)
    .where(
      and(
        eq(schema.clients.organizationId, organizationId),
        inArray(
          schema.clients.slug,
          memberships.map((m) => m.slug),
        ),
      ),
    );
  if (clients.length < memberships.length) return null;
  const roles = await db.select().from(schema.roles).where(eq(schema.roles.organizationId, organizationId));

  const { data, error } = await supabase.auth.admin.createUser({
    email: MULTI_CLIENT_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'هالة القحطاني', locale: 'ar' },
  });
  if (error || !data.user) throw new Error(`createUser ${MULTI_CLIENT_EMAIL}: ${error?.message}`);
  const userId = data.user.id;
  await db
    .update(schema.profiles)
    .set({ fullName: 'هالة القحطاني', phone: '+966551239001', locale: 'ar', onboardedAt: new Date() })
    .where(eq(schema.profiles.id, userId));
  const first = clients.find((c) => c.slug === memberships[0].slug)!;
  await db.insert(schema.organizationMembers).values({ organizationId, userId, userType: 'client', invitedBy: first.am });
  for (const m of memberships) {
    const c = clients.find((x) => x.slug === m.slug)!;
    await db.insert(schema.clientUsers).values({
      organizationId,
      clientId: c.id,
      userId,
      roleId: roles.find((r) => r.key === m.role)!.id,
      canApprove: m.canApprove,
      jobTitle: m.title,
      invitedBy: c.am,
    });
  }
  return userId;
}
