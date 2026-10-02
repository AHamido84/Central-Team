'use server';

import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { AppContext } from '@/lib/auth/context';
import { dbAdmin } from '@/lib/db/client';
import { withRls } from '@/lib/db/rls';
import { clientUsers, invitations, portalEmailChanges, roles } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { can } from '@/lib/permissions/can';
import { checkRateLimit } from '@/lib/rate-limit';
import { clientRoleKeys } from '@/modules/clients/constants';
import {
  applyPortalEmailChange,
  assertAddressFree,
  CONFIRM_TTL_HOURS,
  confirmPortalEmailChangeToken,
  newEmailToken,
  sendConfirmEmail,
} from '@/modules/clients/server/portal-email';
import { lookupPortalEmail, searchPortalUsers, type EmailLookup, type PortalUserSummary } from '@/modules/clients/server/portal-users';
import { createClientInvitation, sendInvitationEmail } from '@/modules/invitations/server/services';

const email = z.email({ message: 'invalid_email' }).trim().toLowerCase().max(254);

/** Agency staff with `client_users:manage`, or a Client Owner (`portal_users:manage`) for their own client. */
function assertManagesClient(ctx: AppContext, clientId: string) {
  if (ctx.side === 'agency' && can(ctx.permissions, 'client_users:manage')) return;
  if (ctx.side === 'client' && ctx.client.id === clientId && can(ctx.permissions, 'portal_users:manage')) return;
  throw new ActionFailure('forbidden');
}

// ---------------------------------------------------------------------------
// Find and add existing portal users (FR4.2, ADR-093)
// ---------------------------------------------------------------------------

/** "Add portal user" autocomplete: existing portal users by name or email, with the clients the caller can see. */
export const searchPortalUsersAction = defineAction({
  input: z.object({ query: z.string().trim().min(2).max(120) }),
  side: 'agency',
  permission: 'client_users:manage',
  async handler() {
    return null;
  },
  async complete({ input }): Promise<PortalUserSummary[]> {
    return searchPortalUsers(input.query);
  },
});

/**
 * What a typed address is before inviting (FR4.2): new → invite; an existing portal user → offer to add them; an agency
 * team member → refuse. A Client Owner learns only that the person exists, never their other clients (RLS).
 */
export const lookupPortalEmailAction = defineAction({
  input: z.object({ clientId: z.uuid(), email }),
  side: 'any',
  rateLimit: { key: 'portal_email_lookup', max: 120, windowSeconds: 600 },
  async handler({ input, ctx }) {
    assertManagesClient(ctx, input.clientId);
    return { organizationId: ctx.organization.id };
  },
  async complete({ input, prepared }): Promise<EmailLookup> {
    return lookupPortalEmail(prepared.organizationId, input.email, input.clientId);
  },
});

/**
 * Adds an existing portal user to another client with a role and approval right for that client (FR4.2). No invitation:
 * they already have an account; they get a notification and an email ("You now have access to <Client>").
 */
export const addExistingPortalUserAction = defineAction({
  input: z.object({
    clientId: z.uuid(),
    email,
    roleKey: z.enum(clientRoleKeys),
    canApprove: z.boolean(),
    jobTitle: z.string().trim().max(80).nullable().optional(),
  }),
  side: 'any',
  rateLimit: { key: 'portal_user_add', max: 60, windowSeconds: 3600 },
  async handler({ input, tx, ctx }) {
    assertManagesClient(ctx, input.clientId);
    const found = await lookupPortalEmail(ctx.organization.id, input.email, input.clientId);
    if (found.kind === 'agency_member') throw new ActionFailure('email_used_by_team_member');
    if (found.kind === 'new') throw new ActionFailure('not_found');
    if (found.inClient) throw new ActionFailure('already_member');
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, ctx.organization.id), eq(roles.key, input.roleKey)));
    if (!role) throw new ActionFailure('not_found');
    const canApprove = input.roleKey === 'client_viewer' ? false : input.canApprove;
    // A membership removed earlier (deactivated) comes back with the new role; one in the Trash must be restored there.
    const [previous] = await tx
      .select({ id: clientUsers.id })
      .from(clientUsers)
      .where(and(eq(clientUsers.clientId, input.clientId), eq(clientUsers.userId, found.userId)));
    let clientUserId: string;
    if (previous) {
      const [row] = await tx
        .update(clientUsers)
        .set({ roleId: role.id, canApprove, status: 'active', jobTitle: input.jobTitle ?? null })
        .where(eq(clientUsers.id, previous.id))
        .returning({ id: clientUsers.id });
      if (!row) throw new ActionFailure('conflict');
      clientUserId = row.id;
    } else {
      // The insert policy decides: `client_users:manage` + access to the client, or the client's own Owner.
      clientUserId = crypto.randomUUID();
      await tx.insert(clientUsers).values({
        id: clientUserId,
        organizationId: ctx.organization.id,
        clientId: input.clientId,
        userId: found.userId,
        roleId: role.id,
        canApprove,
        jobTitle: input.jobTitle ?? null,
        invitedBy: ctx.session.userId,
      });
    }
    await emitEvent(tx, {
      type: 'client_user.added',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'client_user', id: clientUserId },
      clientId: input.clientId,
      payload: { clientId: input.clientId, userId: found.userId, roleKey: input.roleKey },
    });
    return { clientUserId, userId: found.userId };
  },
  revalidate: (input) => [`/clients/${input.clientId}`, '/portal/company', '/admin/users'],
});

// ---------------------------------------------------------------------------
// Change a portal user's email (FR4.1, ADR-092)
// ---------------------------------------------------------------------------

/**
 * A pending invitation goes to another address: the old link stops working (revoked) and a new invitation with the
 * same client, role and approval right is sent to the new address.
 */
export const changeInvitationEmailAction = defineAction({
  input: z.object({ invitationId: z.uuid(), email }),
  side: 'agency',
  permission: 'client_users:update_email',
  rateLimit: { key: 'portal_email_change', max: 30, windowSeconds: 600 },
  async handler({ input, tx, ctx }) {
    const [inv] = await tx
      .select({ i: invitations, roleKey: roles.key })
      .from(invitations)
      .leftJoin(roles, eq(roles.id, invitations.clientRoleId))
      .where(and(eq(invitations.id, input.invitationId), eq(invitations.status, 'pending')));
    if (!inv || inv.i.userType !== 'client' || !inv.i.clientId) throw new ActionFailure('not_found');
    if (inv.i.email.toLowerCase() === input.email) throw new ActionFailure('email_same');
    await assertAddressFree(ctx.organization.id, input.email, null);
    const [revoked] = await tx
      .update(invitations)
      .set({ status: 'revoked' })
      .where(eq(invitations.id, inv.i.id))
      .returning({ id: invitations.id });
    if (!revoked) throw new ActionFailure('forbidden');
    const created = await createClientInvitation(tx, ctx, {
      clientId: inv.i.clientId,
      email: input.email,
      fullName: inv.i.fullName,
      clientRoleKey: (inv.roleKey ?? 'client_member') as (typeof clientRoleKeys)[number],
      canApprove: inv.i.canApprove,
      locale: inv.i.locale === 'en' ? 'en' : 'ar',
    });
    await emitEvent(tx, {
      type: 'invitation.email_changed',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'invitation', id: created.invitation.id },
      clientId: inv.i.clientId,
      payload: { from: inv.i.email, to: input.email, previousInvitationId: inv.i.id },
    });
    return { ...created, clientId: inv.i.clientId };
  },
  async after({ result, ctx }) {
    await sendInvitationEmail(result.invitation, result.token, ctx);
  },
  revalidate: (_input, r) => [`/clients/${r.clientId}`, '/admin/users'],
});

/**
 * An active portal user's sign-in email (FR4.1). `direct`: GoTrue's admin API sets it now, other sessions end, the old
 * address gets a notice naming the admin and the new one an info email (the `user.email_changed` consumer).
 * `confirm`: a single-use link goes to the new address and nothing changes until it is opened.
 */
export const changePortalUserEmailAction = defineAction({
  input: z.object({ userId: z.uuid(), email, mode: z.enum(['direct', 'confirm']), clientId: z.uuid().nullable().optional() }),
  side: 'agency',
  permission: 'client_users:update_email',
  rateLimit: { key: 'portal_email_change', max: 30, windowSeconds: 600 },
  async handler({ input, tx, ctx }) {
    // RLS-checked lookup: the permission, the person is a portal user, and (Account Managers) one of their clients.
    const [row] = await tx.execute<{ email: string; user_type: string; allowed: boolean }>(sql`
      select p.email, m.user_type, app.can_update_portal_email(m.user_id) as allowed
      from public.organization_members m join public.profiles p on p.id = m.user_id
      where m.organization_id = ${ctx.organization.id}::uuid and m.user_id = ${input.userId}::uuid`);
    if (!row) throw new ActionFailure('not_found');
    if (row.user_type !== 'client') throw new ActionFailure('not_portal_user');
    if (!row.allowed) throw new ActionFailure('forbidden');
    if (row.email.toLowerCase() === input.email) throw new ActionFailure('email_same');
    await assertAddressFree(ctx.organization.id, input.email, input.userId);
    return { from: row.email };
  },
  async complete({ input, prepared, ctx }) {
    if (input.mode === 'confirm') {
      const { token, hash } = newEmailToken();
      // Service path after the RLS-checked lookup above: the token table has no user write access (ADR-092).
      await dbAdmin
        .update(portalEmailChanges)
        .set({ status: 'cancelled' })
        .where(and(eq(portalEmailChanges.userId, input.userId), eq(portalEmailChanges.status, 'pending')));
      await dbAdmin.insert(portalEmailChanges).values({
        organizationId: ctx.organization.id,
        userId: input.userId,
        clientId: input.clientId ?? null,
        fromEmail: prepared.from,
        toEmail: input.email,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + CONFIRM_TTL_HOURS * 3600_000),
        requestedBy: ctx.session.userId,
      });
      await sendConfirmEmail(ctx, input.userId, input.email, token);
      await withRls((tx) =>
        emitEvent(tx, {
          type: 'client_user.email_change_requested',
          organizationId: ctx.organization.id,
          actorId: ctx.session.userId,
          aggregate: { type: 'user', id: input.userId },
          clientId: input.clientId ?? null,
          payload: { userId: input.userId, from: prepared.from, to: input.email },
        }),
      );
      return { mode: 'confirm' as const, email: input.email };
    }
    await applyPortalEmailChange({
      organizationId: ctx.organization.id,
      userId: input.userId,
      from: prepared.from,
      to: input.email,
      actorId: ctx.session.userId,
    });
    return { mode: 'direct' as const, email: input.email };
  },
  revalidate: (input) => ['/admin/users', ...(input.clientId ? [`/clients/${input.clientId}`] : [])],
});

/** Cancels an admin's pending "ask to confirm" change (the link stops working). */
export const cancelPortalEmailChangeAction = defineAction({
  input: z.object({ userId: z.uuid() }),
  side: 'agency',
  permission: 'client_users:update_email',
  async handler({ input, tx }) {
    const [row] = await tx.execute<{ allowed: boolean }>(sql`select app.can_update_portal_email(${input.userId}::uuid) as allowed`);
    if (!row?.allowed) throw new ActionFailure('forbidden');
    return null;
  },
  async complete({ input }) {
    // Service path after the RLS check above (the table has no user write access).
    await dbAdmin
      .update(portalEmailChanges)
      .set({ status: 'cancelled' })
      .where(and(eq(portalEmailChanges.userId, input.userId), eq(portalEmailChanges.status, 'pending')));
    return null;
  },
  revalidate: ['/admin/users'],
});

/**
 * Opens an admin's "ask the user to confirm" link (public page, no session): the single-use, hashed, expiring token is
 * the credential (ADR-092). Rate-limited per token.
 */
export async function confirmPortalEmailChangeAction(input: {
  token: string;
}): Promise<{ status: 'done' | 'invalid' | 'expired' | 'in_use' | 'rate_limited' }> {
  const token = String(input?.token ?? '');
  if (!(await checkRateLimit(`portal-email-confirm:${token.slice(0, 16)}`, 10, 900))) return { status: 'rate_limited' };
  return { status: await confirmPortalEmailChangeToken(token) };
}
