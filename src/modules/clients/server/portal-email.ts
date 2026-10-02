import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { ActionFailure } from '@/lib/actions/errors';
import type { AppContext } from '@/lib/auth/context';
import { dbAdmin } from '@/lib/db/client';
import { activityLog, portalEmailChanges } from '@/lib/db/schema';
import { emailTranslator, sendActionEmail } from '@/lib/email/send';
import { emitEvent } from '@/lib/events/emit';
import { localized, type Locale } from '@/lib/i18n/localized';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { lookupPortalEmail } from '@/modules/clients/server/portal-users';
import { emailChangeFailure } from '@/modules/identity/server/email-change';

/** How long an admin's "ask the user to confirm" link stays valid. */
export const CONFIRM_TTL_HOURS = 48;

export const newEmailToken = () => {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex') };
};

/** Rejects addresses that belong to someone else, with a reason the dialog can act on. */
export async function assertAddressFree(organizationId: string, address: string, userId: string | null) {
  const found = await lookupPortalEmail(organizationId, address, null);
  if (found.kind === 'agency_member') throw new ActionFailure('email_used_by_team_member');
  if (found.kind === 'portal_user' && found.userId !== userId) throw new ActionFailure('email_used_by_portal_user');
  if (found.kind === 'new') {
    // An account outside this organization (another tenant) can't be reused either.
    const [other] = await dbAdmin.execute<{ id: string }>(sql`select id from public.profiles where lower(email) = ${address} limit 1`);
    if (other && other.id !== userId) throw new ActionFailure('email_in_use');
  }
}

/**
 * Applies a portal user's new email (direct change, or a confirmed link). Service path (CLAUDE.md §6, ADR-087/092): only
 * GoTrue's admin API changes another user's login; the caller's right was checked before. Ends the user's sessions,
 * writes the audit entry with who did it and emits `user.email_set_by_admin` (the notice to the old address names them).
 */
export async function applyPortalEmailChange(change: {
  organizationId: string;
  userId: string;
  from: string;
  to: string;
  actorId: string | null;
}) {
  const { error } = await supabaseAdmin().auth.admin.updateUserById(change.userId, { email: change.to, email_confirm: true });
  if (error) throw emailChangeFailure(error);
  // Other sessions end: refresh tokens go with their session (GoTrue cascades), so no device stays signed in.
  await dbAdmin.execute(sql`delete from auth.sessions where user_id = ${change.userId}::uuid`);
  await dbAdmin.insert(activityLog).values({
    organizationId: change.organizationId,
    actorId: change.actorId,
    action: 'update',
    tableName: 'profiles',
    recordId: change.userId,
    before: { email: change.from },
    after: { email: change.to },
    changedFields: ['email'],
  });
  await dbAdmin.transaction(async (tx) => {
    await emitEvent(tx, {
      type: 'user.email_set_by_admin',
      organizationId: change.organizationId,
      actorId: change.actorId,
      aggregate: { type: 'user', id: change.userId },
      payload: { userId: change.userId, from: change.from, to: change.to },
    });
  });
}

export async function sendConfirmEmail(ctx: AppContext, userId: string, to: string, token: string) {
  const [person] = await dbAdmin.execute<{ locale: string | null }>(sql`select locale from public.profiles where id = ${userId}::uuid`);
  const locale: Locale = person?.locale === 'en' ? 'en' : 'ar';
  const t = await emailTranslator(locale);
  const admin = ctx.profile.fullName || ctx.profile.email;
  await sendActionEmail({
    organizationId: ctx.organization.id,
    kind: 'email_change',
    // The link changes a sign-in address: keep it out of the log once delivered.
    sensitive: true,
    userId,
    createdBy: ctx.session.userId,
    to,
    locale,
    brand: { name: ctx.organization.name, primaryColor: ctx.organization.brand.primaryColor },
    subject: t('portalEmailConfirmSubject'),
    content: {
      heading: t('portalEmailConfirmHeading'),
      paragraphs: [t('portalEmailConfirmBody', { admin, org: localized(ctx.organization.name, locale), email: to })],
      cta: { label: t('portalEmailConfirmCta'), href: `${process.env.NEXT_PUBLIC_APP_URL}/email-change/confirm?token=${token}` },
      note: t('portalEmailConfirmNote', { hours: CONFIRM_TTL_HOURS }),
    },
    tags: { type: 'portal_email_change' },
  });
}

/** The token-gated confirmation (public page): exported for the confirm action, which has no session. */
export async function confirmPortalEmailChangeToken(token: string): Promise<'done' | 'invalid' | 'expired' | 'in_use'> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return 'invalid';
  const [row] = await dbAdmin
    .select()
    .from(portalEmailChanges)
    .where(eq(portalEmailChanges.tokenHash, createHash('sha256').update(token).digest('hex')));
  if (!row || row.status !== 'pending') return 'invalid';
  if (row.expiresAt.getTime() < Date.now()) {
    await dbAdmin.update(portalEmailChanges).set({ status: 'expired' }).where(eq(portalEmailChanges.id, row.id));
    return 'expired';
  }
  try {
    await assertAddressFree(row.organizationId, row.toEmail, row.userId);
  } catch {
    return 'in_use';
  }
  // Single use: claim the row before touching the account.
  const [claimed] = await dbAdmin
    .update(portalEmailChanges)
    .set({ status: 'completed', completedAt: new Date() })
    .where(and(eq(portalEmailChanges.id, row.id), eq(portalEmailChanges.status, 'pending')))
    .returning({ id: portalEmailChanges.id });
  if (!claimed) return 'invalid';
  await applyPortalEmailChange({
    organizationId: row.organizationId,
    userId: row.userId,
    from: row.fromEmail,
    to: row.toEmail,
    actorId: row.requestedBy,
  });
  return 'done';
}
