'use server';

import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { AppContext } from '@/lib/auth/context';
import { dbAdmin } from '@/lib/db/client';
import { clients, invitations, organizationMembers, profiles, roles } from '@/lib/db/schema';
import { sendActionEmail, emailTranslator } from '@/lib/email/send';
import { emitEvent } from '@/lib/events/emit';
import { can } from '@/lib/permissions/can';
import { localized, type Locale } from '@/lib/i18n/localized';
import { email, localeSchema, optionalText } from '@/lib/validation';
import { generateInvitationToken, invitationExpiry } from '@/modules/invitations/server/tokens';

type InvitationRow = typeof invitations.$inferSelect;

/**
 * Read-only existence check across the organization (a client owner cannot see agency profiles via RLS,
 * but must still be told the address is taken). Returns a boolean only.
 */
async function isExistingActiveMember(organizationId: string, address: string): Promise<boolean> {
  const rows = await dbAdmin
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .innerJoin(profiles, eq(profiles.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.status, 'active'),
        sql`lower(${profiles.email}) = ${address.toLowerCase()}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function sendInvitationEmail(invitation: InvitationRow, token: string, ctx: AppContext) {
  const locale = (invitation.locale === 'en' ? 'en' : 'ar') as Locale;
  const t = await emailTranslator(locale);
  const orgName = localized(ctx.organization.name, locale);
  let clientName: string | null = null;
  if (invitation.clientId) {
    const [client] = await dbAdmin.select({ name: clients.name }).from(clients).where(eq(clients.id, invitation.clientId));
    clientName = client ? localized(client.name, locale) : null;
  }
  const inviter = ctx.profile.fullName || ctx.profile.email;
  const heading = clientName ? t('invitePortalHeading', { client: clientName }) : t('inviteTeamHeading', { org: orgName });
  await sendActionEmail({
    to: invitation.email,
    locale,
    brand: { name: ctx.organization.name, primaryColor: ctx.organization.brand.primaryColor },
    subject: heading,
    content: {
      heading,
      paragraphs: [clientName ? t('invitePortalBody', { inviter, org: orgName }) : t('inviteTeamBody', { inviter })],
      cta: { label: t('inviteCta'), href: `${process.env.NEXT_PUBLIC_APP_URL}/invite/${token}` },
      note: t('inviteNote', { days: 7 }),
    },
    tags: { type: 'invitation' },
  });
}

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
    if (await isExistingActiveMember(ctx.organization.id, input.email)) throw new ActionFailure('already_member');
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.organizationId, ctx.organization.id), eq(roles.key, input.clientRoleKey)));
    if (!role) throw new ActionFailure('not_found');
    const { token, hash } = generateInvitationToken();
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
        userType: 'client',
        clientId: input.clientId,
        clientRoleId: role.id,
        canApprove: input.canApprove,
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
      clientId: input.clientId,
      payload: { email: input.email, userType: 'client', clientId: input.clientId },
    });
    return { invitation, token };
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
