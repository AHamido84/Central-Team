'use server';

import { and, eq, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/errors';
import { dbAdmin } from '@/lib/db/client';
import {
  clientUsers,
  clients,
  departmentMembers,
  domainEvents,
  invitations,
  organizationMembers,
  organizations,
  profiles,
  userRoles,
} from '@/lib/db/schema';
import { LOCALE_COOKIE } from '@/i18n/request';
import type { LocalizedText } from '@/lib/i18n/localized';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { password as passwordSchema, requiredText } from '@/lib/validation';
import { hashInvitationToken } from '@/modules/invitations/server/tokens';
import { notify } from '@/modules/notifications/server/notify';

export type InvitationPreview =
  | {
      status: 'valid';
      email: string;
      fullName: string | null;
      userType: 'agency' | 'client';
      organizationName: LocalizedText;
      clientName: LocalizedText | null;
      inviterName: string | null;
      existingAccount: boolean;
    }
  | { status: 'expired' | 'invalid' };

async function findPending(token: string) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const [row] = await dbAdmin
    .select()
    .from(invitations)
    .where(eq(invitations.tokenHash, hashInvitationToken(token)))
    .limit(1);
  return row ?? null;
}

async function findAuthUserId(address: string): Promise<string | null> {
  const [row] = await dbAdmin
    .select({ id: profiles.id })
    .from(profiles)
    .where(sql`lower(${profiles.email}) = ${address.toLowerCase()}`)
    .limit(1);
  return row?.id ?? null;
}

/**
 * Public, token-gated preview. Service-role read (listed path, CLAUDE.md §6): the token itself is the
 * credential, and only non-sensitive display fields are returned.
 */
export async function getInvitationPreview(token: string): Promise<InvitationPreview> {
  const invitation = await findPending(token);
  if (!invitation || invitation.status !== 'pending') return { status: 'invalid' };
  if (invitation.expiresAt.getTime() < Date.now()) return { status: 'expired' };
  const [org] = await dbAdmin.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, invitation.organizationId));
  const [client] = invitation.clientId
    ? await dbAdmin.select({ name: clients.name }).from(clients).where(eq(clients.id, invitation.clientId))
    : [];
  const [inviter] = invitation.invitedBy
    ? await dbAdmin.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, invitation.invitedBy))
    : [];
  return {
    status: 'valid',
    email: invitation.email,
    fullName: invitation.fullName,
    userType: invitation.userType as 'agency' | 'client',
    organizationName: org?.name ?? {},
    clientName: client?.name ?? null,
    inviterName: inviter?.name || null,
    existingAccount: (await findAuthUserId(invitation.email)) !== null,
  };
}

const acceptSchema = z
  .object({
    token: z.string().min(40).max(60),
    fullName: requiredText(120),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'passwords_mismatch', path: ['confirm'] });

/**
 * Accepts an invitation: creates (or re-activates) the account, memberships and roles, then signs in.
 * Runs with the service role because the invitee has no membership yet; the hashed, single-use,
 * expiring token is the authorization (ADR-005).
 */
export async function acceptInvitationAction(
  input: z.input<typeof acceptSchema>,
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: 'validation', fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> } };
  }
  const { token, fullName, password } = parsed.data;
  if (!(await checkRateLimit(`invite-accept:${hashInvitationToken(token)}`, 10, 900))) {
    return { ok: false, error: { code: 'rate_limited' } };
  }
  const invitation = await findPending(token);
  if (!invitation || invitation.status !== 'pending') return { ok: false, error: { code: 'invitation_invalid' } };
  if (invitation.expiresAt.getTime() < Date.now()) return { ok: false, error: { code: 'invitation_expired' } };

  const admin = supabaseAdmin();
  let userId = await findAuthUserId(invitation.email);
  const metadata = { full_name: fullName, locale: invitation.locale };
  if (userId) {
    // Clicking the emailed link proves ownership of the address, so the invitee may (re)set the password.
    const { error } = await admin.auth.admin.updateUserById(userId, { password, user_metadata: metadata, email_confirm: true });
    if (error) return { ok: false, error: { code: error.code === 'weak_password' ? 'weak_password' : 'unknown' } };
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: invitation.email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    });
    if (error || !data.user) return { ok: false, error: { code: error?.code === 'weak_password' ? 'weak_password' : 'unknown' } };
    userId = data.user.id;
  }

  const acceptedUserId = userId;
  await dbAdmin.transaction(async (tx) => {
    // Re-check inside the transaction so a token can only be consumed once.
    const [locked] = await tx
      .select({ status: invitations.status })
      .from(invitations)
      .where(eq(invitations.id, invitation.id))
      .for('update');
    if (locked?.status !== 'pending') throw new Error('invitation_invalid');

    await tx
      .update(profiles)
      .set({ fullName, locale: invitation.locale })
      .where(eq(profiles.id, acceptedUserId));
    await tx
      .insert(organizationMembers)
      .values({
        organizationId: invitation.organizationId,
        userId: acceptedUserId,
        userType: invitation.userType,
        status: 'active',
        invitedBy: invitation.invitedBy,
      })
      .onConflictDoUpdate({
        target: [organizationMembers.organizationId, organizationMembers.userId],
        set: { status: 'active', userType: invitation.userType },
      });

    if (invitation.userType === 'agency') {
      for (const roleId of invitation.roleIds) {
        await tx
          .insert(userRoles)
          .values({ organizationId: invitation.organizationId, userId: acceptedUserId, roleId, assignedBy: invitation.invitedBy })
          .onConflictDoNothing();
      }
      if (invitation.departmentId) {
        await tx
          .insert(departmentMembers)
          .values({ departmentId: invitation.departmentId, userId: acceptedUserId, organizationId: invitation.organizationId })
          .onConflictDoNothing();
      }
    } else if (invitation.clientId && invitation.clientRoleId) {
      await tx
        .insert(clientUsers)
        .values({
          organizationId: invitation.organizationId,
          clientId: invitation.clientId,
          userId: acceptedUserId,
          roleId: invitation.clientRoleId,
          canApprove: invitation.canApprove,
          invitedBy: invitation.invitedBy,
        })
        .onConflictDoUpdate({
          target: [clientUsers.clientId, clientUsers.userId],
          set: { roleId: invitation.clientRoleId, canApprove: invitation.canApprove, status: 'active' },
        });
    }

    await tx
      .update(invitations)
      .set({ status: 'accepted', acceptedBy: acceptedUserId, acceptedAt: new Date() })
      .where(and(eq(invitations.id, invitation.id), eq(invitations.status, 'pending')));
    await tx.insert(domainEvents).values({
      organizationId: invitation.organizationId,
      type: 'invitation.accepted',
      aggregateType: 'invitation',
      aggregateId: invitation.id,
      clientId: invitation.clientId,
      actorId: acceptedUserId,
      payload: { email: invitation.email, userId: acceptedUserId, userType: invitation.userType },
    });
  });

  if (invitation.invitedBy) {
    await notify({
      organizationId: invitation.organizationId,
      userIds: [invitation.invitedBy],
      type: 'invitation_accepted',
      params: { name: fullName },
      link: invitation.userType === 'client' && invitation.clientId ? `/clients/${invitation.clientId}?tab=users` : '/admin/users',
      actorId: acceptedUserId,
    }).catch((error) => console.error('[invitation.accept] notify failed', error));
  }

  const supabase = await createSupabaseServerClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: invitation.email, password });
  if (signInError) return { ok: true, data: { redirectTo: '/login' } };
  (await cookies()).set(LOCALE_COOKIE, invitation.locale, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  return { ok: true, data: { redirectTo: '/onboarding' } };
}
