'use server';

import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { AppContext } from '@/lib/auth/context';
import { invitations } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { can } from '@/lib/permissions/can';
import { email, localeSchema, optionalText } from '@/lib/validation';
import { createClientInvitation, isExistingActiveMember, sendInvitationEmail } from '@/modules/invitations/server/services';
import { generateInvitationToken, invitationExpiry } from '@/modules/invitations/server/tokens';

/* -------------------------------------------------------------------------- */
/* Team (agency) invitations                                                  */
/* -------------------------------------------------------------------------- */

const teamInviteSchema = z.object({
  email,
  fullName: optionalText(120),
  roleIds: z.array(z.uuid()).min(1, { message: 'min_one' }),
  departmentId: z.uuid().nullable().optional(),
  locale: localeSchema,
});

export const inviteTeamMemberAction = defineAction({
  input: teamInviteSchema,
  side: 'agency',
  permission: 'invitations:create',
  rateLimit: { key: 'invite', max: 60, windowSeconds: 3600 },
  async handler({ input, tx, ctx }) {
    if (await isExistingActiveMember(ctx.organization.id, input.email)) throw new ActionFailure('already_member');
    const { token, hash } = generateInvitationToken();
    // Replace a previous pending invitation for the same address.
    await tx
      .update(invitations)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(invitations.organizationId, ctx.organization.id),
          eq(invitations.status, 'pending'),
          sql`lower(${invitations.email}) = ${input.email}`,
        ),
      );
    const [invitation] = await tx
      .insert(invitations)
      .values({
        organizationId: ctx.organization.id,
        email: input.email,
        fullName: input.fullName,
        userType: 'agency',
        roleIds: input.roleIds,
        departmentId: input.departmentId ?? null,
        locale: input.locale,
        tokenHash: hash,
        expiresAt: invitationExpiry(),
        invitedBy: ctx.session.userId,
      })
      .returning();
    if (!invitation) throw new ActionFailure('forbidden');
    await emitEvent(tx, {
      type: 'invitation.created',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'invitation', id: invitation.id },
      payload: { email: input.email, userType: 'agency' },
    });
    return { invitation, token };
  },
  async after({ result, ctx }) {
    await sendInvitationEmail(result.invitation, result.token, ctx);
  },
  revalidate: ['/admin/users'],
});

/* -------------------------------------------------------------------------- */
/* Client (portal) invitations — from the agency client page or by a Client Owner */
/* -------------------------------------------------------------------------- */

const clientInviteSchema = z.object({
  clientId: z.uuid(),
  email,
  fullName: optionalText(120),
  clientRoleKey: z.enum(['client_owner', 'client_member', 'client_viewer']),
  canApprove: z.boolean(),
  jobTitle: optionalText(80),
  locale: localeSchema,
});

function assertCanManageClientUsers(ctx: AppContext, clientId: string) {
  if (ctx.side === 'agency' && can(ctx.permissions, 'client_users:manage')) return;
  if (ctx.side === 'client' && ctx.client.id === clientId && can(ctx.permissions, 'portal_users:manage')) return;
  throw new ActionFailure('forbidden');
}

export const inviteClientUserAction = defineAction({
  input: clientInviteSchema,
  side: 'any',
  rateLimit: { key: 'invite', max: 60, windowSeconds: 3600 },
  async handler({ input, tx, ctx }) {
    assertCanManageClientUsers(ctx, input.clientId);
    return createClientInvitation(tx, ctx, input);
  },
  async after({ result, ctx }) {
    await sendInvitationEmail(result.invitation, result.token, ctx);
  },
  revalidate: (input) => [`/clients/${input.clientId}`, '/portal/company'],
});

/* -------------------------------------------------------------------------- */
/* Resend / revoke (RLS decides who may touch which invitation)               */
/* -------------------------------------------------------------------------- */

const idSchema = z.object({ invitationId: z.uuid() });

export const resendInvitationAction = defineAction({
  input: idSchema,
  side: 'any',
  rateLimit: { key: 'invite-resend', max: 30, windowSeconds: 3600 },
  async handler({ input, tx, ctx }) {
    const { token, hash } = generateInvitationToken();
    const [invitation] = await tx
      .update(invitations)
      .set({
        tokenHash: hash,
        expiresAt: invitationExpiry(),
        lastSentAt: new Date(),
        sendCount: sql`${invitations.sendCount} + 1`,
      })
      .where(and(eq(invitations.id, input.invitationId), eq(invitations.status, 'pending')))
      .returning();
    if (!invitation) throw new ActionFailure('not_found');
    if (invitation.userType === 'agency' && ctx.side === 'agency' && !can(ctx.permissions, 'invitations:resend')) {
      throw new ActionFailure('forbidden');
    }
    await emitEvent(tx, {
      type: 'invitation.resent',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'invitation', id: invitation.id },
      clientId: invitation.clientId,
      payload: { email: invitation.email },
    });
    return { invitation, token };
  },
  async after({ result, ctx }) {
    await sendInvitationEmail(result.invitation, result.token, ctx);
  },
  revalidate: ['/admin/users', '/clients', '/portal/company'],
});

export const revokeInvitationAction = defineAction({
  input: idSchema,
  side: 'any',
  async handler({ input, tx, ctx }) {
    const [invitation] = await tx
      .update(invitations)
      .set({ status: 'revoked' })
      .where(and(eq(invitations.id, input.invitationId), eq(invitations.status, 'pending')))
      .returning({ id: invitations.id, email: invitations.email, clientId: invitations.clientId, userType: invitations.userType });
    if (!invitation) throw new ActionFailure('not_found');
    if (invitation.userType === 'agency' && ctx.side === 'agency' && !can(ctx.permissions, 'invitations:revoke')) {
      throw new ActionFailure('forbidden');
    }
    await emitEvent(tx, {
      type: 'invitation.revoked',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'invitation', id: invitation.id },
      clientId: invitation.clientId,
      payload: { email: invitation.email },
    });
    return null;
  },
  revalidate: ['/admin/users', '/clients', '/portal/company'],
});
