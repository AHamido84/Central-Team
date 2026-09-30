import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { ActionFailure } from '@/lib/actions/errors';
import type { AppContext } from '@/lib/auth/context';
import { dbAdmin, type Tx } from '@/lib/db/client';
import { clients, invitations, organizationMembers, profiles, roles } from '@/lib/db/schema';
import { emailTranslator, sendActionEmail } from '@/lib/email/send';
import { emitEvent } from '@/lib/events/emit';
import { localized, type Locale } from '@/lib/i18n/localized';
import { generateInvitationToken, invitationExpiry } from '@/modules/invitations/server/tokens';

type InvitationRow = typeof invitations.$inferSelect;

/**
 * Read-only existence check across the organization (a client owner cannot see agency profiles via RLS,
 * but must still be told the address is taken). Returns a boolean only.
 */
export async function isExistingActiveMember(organizationId: string, address: string): Promise<boolean> {
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

export async function sendInvitationEmail(invitation: InvitationRow, token: string, ctx: AppContext) {
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

export type ClientInvitationInput = {
  clientId: string;
  email: string;
  fullName: string | null;
  clientRoleKey: 'client_owner' | 'client_member' | 'client_viewer';
  canApprove: boolean;
  jobTitle?: string | null;
  locale: 'ar' | 'en';
};

/**
 * Creates a portal invitation in the caller's RLS transaction (the agency client page, a Client Owner, and the
 * won-deal conversion). The email goes out after commit with `sendInvitationEmail`.
 */
export async function createClientInvitation(tx: Tx, ctx: AppContext, input: ClientInvitationInput) {
  if (await isExistingActiveMember(ctx.organization.id, input.email)) throw new ActionFailure('already_member');
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
}
