import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { organizationMembers, organizations, profiles } from '@/lib/db/schema';
import { emailTranslator, sendActionEmail } from '@/lib/email/send';
import { isLocale, localized, type Locale } from '@/lib/i18n/localized';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { emailChangeFailure } from '@/modules/identity/server/email-change';

/**
 * Auth emails go through our own sender (FR2.1 / ADR-088): GoTrue's Admin API generates the one-time link without
 * sending anything, and the email is queued like every other one (Settings → Mail, retries, log). The links land on
 * /auth/confirm with a `token_hash`, as GoTrue's own templates did (ADR-017).
 */

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

function confirmLink(tokenHash: string, type: string, next?: string): string {
  const params = new URLSearchParams({ token_hash: tokenHash, type });
  if (next) params.set('next', next);
  return `${appUrl()}/auth/confirm?${params.toString()}`;
}

type Account = {
  userId: string;
  email: string;
  locale: Locale;
  organizationId: string;
  brand: { name: Record<string, string>; primaryColor?: string | null };
};

/**
 * Service path (CLAUDE.md §6): who owns this address. Generating a link for an unknown address would create a user in
 * GoTrue, so nothing is sent (and nothing is revealed) unless an active member has this email.
 */
async function accountByEmail(email: string): Promise<Account | null> {
  const [row] = await dbAdmin
    .select({
      userId: profiles.id,
      email: profiles.email,
      locale: profiles.locale,
      organizationId: organizationMembers.organizationId,
      orgName: organizations.name,
      brand: organizations.brand,
    })
    .from(profiles)
    .innerJoin(organizationMembers, and(eq(organizationMembers.userId, profiles.id), eq(organizationMembers.status, 'active')))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(sql`lower(${profiles.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  if (!row) return null;
  return {
    userId: row.userId,
    email: row.email,
    locale: isLocale(row.locale) ? row.locale : 'ar',
    organizationId: row.organizationId,
    brand: { name: row.orgName, primaryColor: row.brand.primaryColor },
  };
}

/** Magic link (sign-in) or password reset. Silent when the address has no active account (no enumeration). */
export async function sendAuthLinkEmail(kind: 'magic_link' | 'recovery', email: string): Promise<{ queued: boolean }> {
  const account = await accountByEmail(email);
  if (!account) return { queued: false };
  const type = kind === 'magic_link' ? 'magiclink' : 'recovery';
  const { data, error } = await supabaseAdmin().auth.admin.generateLink({ type, email: account.email });
  if (error || !data.properties?.hashed_token) {
    console.warn('[auth] generateLink failed', kind, error?.code ?? error?.message);
    return { queued: false };
  }
  const t = await emailTranslator(account.locale);
  const brand = localized(account.brand.name, account.locale);
  const href = confirmLink(data.properties.hashed_token, type, kind === 'recovery' ? '/reset-password' : undefined);
  const content =
    kind === 'magic_link'
      ? {
          heading: t('magicLinkHeading', { brand }),
          paragraphs: [t('magicLinkBody')],
          cta: { label: t('magicLinkCta'), href },
          note: t('magicLinkNote'),
        }
      : {
          heading: t('recoveryHeading'),
          paragraphs: [t('recoveryBody', { email: account.email })],
          cta: { label: t('recoveryCta'), href },
          note: t('recoveryNote'),
        };
  await sendActionEmail({
    organizationId: account.organizationId,
    kind,
    to: account.email,
    userId: account.userId,
    locale: account.locale,
    brand: account.brand,
    subject: kind === 'magic_link' ? t('magicLinkSubject', { brand }) : t('recoverySubject', { brand }),
    content,
    sensitive: true,
  });
  return { queued: true };
}

/**
 * Secure email change (ADR-087/088): one link to the current address and one to the new address; GoTrue completes the
 * change once both are opened. Throws the same specific errors as before (in use, invalid, rate limited…).
 */
export async function sendEmailChangeEmails(args: {
  userId: string;
  currentEmail: string;
  newEmail: string;
  locale: Locale;
  organizationId: string;
  brand: Account['brand'];
}): Promise<void> {
  const admin = supabaseAdmin().auth.admin;
  const current = await admin.generateLink({ type: 'email_change_current', email: args.currentEmail, newEmail: args.newEmail });
  if (current.error || !current.data.properties?.hashed_token) throw emailChangeFailure(current.error ?? { message: 'no_link' });
  const next = await admin.generateLink({ type: 'email_change_new', email: args.currentEmail, newEmail: args.newEmail });
  if (next.error || !next.data.properties?.email_otp) throw emailChangeFailure(next.error ?? { message: 'no_link' });
  // GoTrue stores the new address's token as sha224(new email + OTP) but returns a hash built from the current
  // address for `email_change_new`; build the link from what it verifies against.
  const newHash = createHash('sha224')
    .update(args.newEmail.toLowerCase() + next.data.properties.email_otp)
    .digest('hex');

  const t = await emailTranslator(args.locale);
  const brand = localized(args.brand.name, args.locale);
  const common = { heading: t('emailChangeHeading'), cta: { label: t('emailChangeCta'), href: '' }, note: t('emailChangeNote') };
  const subject = t('emailChangeSubject', { brand });
  await sendActionEmail({
    organizationId: args.organizationId,
    kind: 'email_change',
    to: args.currentEmail,
    userId: args.userId,
    locale: args.locale,
    brand: args.brand,
    subject,
    content: {
      ...common,
      paragraphs: [t('emailChangeBodyCurrent', { from: args.currentEmail, to: args.newEmail }), t('emailChangeBoth')],
      cta: { ...common.cta, href: confirmLink(current.data.properties.hashed_token, 'email_change') },
    },
    sensitive: true,
    createdBy: args.userId,
  });
  await sendActionEmail({
    organizationId: args.organizationId,
    kind: 'email_change',
    to: args.newEmail,
    userId: args.userId,
    locale: args.locale,
    brand: args.brand,
    subject,
    content: {
      ...common,
      paragraphs: [t('emailChangeBodyNew', { to: args.newEmail, brand }), t('emailChangeBoth')],
      cta: { ...common.cta, href: confirmLink(newHash, 'email_change') },
    },
    sensitive: true,
    createdBy: args.userId,
  });
}

/** The pieces `sendEmailChangeEmails` needs for a signed-in user. */
export async function emailChangeContext(userId: string): Promise<Pick<Account, 'organizationId' | 'brand'> | null> {
  const [row] = await dbAdmin
    .select({ organizationId: organizationMembers.organizationId, name: organizations.name, brand: organizations.brand })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.status, 'active')))
    .limit(1);
  return row ? { organizationId: row.organizationId, brand: { name: row.name, primaryColor: row.brand.primaryColor } } : null;
}
