import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { mailSettings, organizations } from '@/lib/db/schema';
import { environmentEmailProvider, ResendEmailProvider, SmtpEmailProvider, type EmailProvider } from '@/lib/email/provider';
import { env } from '@/lib/env';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { presetDefaults, type MailPreset, type MailSecurity, type SenderKind } from '@/modules/mail/constants';

export type MailSettingsRow = typeof mailSettings.$inferSelect;

/** Development delivers to Mailpit unless real sending is switched on explicitly (FR2.1). */
export function devMailOnly(): boolean {
  return process.env.NODE_ENV !== 'production' && env().EMAIL_DEV_REAL_SEND !== '1';
}

/** `"Agency name" <from@…>` in the recipient's language. */
export function formatFrom(name: string, email: string): string {
  const clean = name.replace(/["<>\r\n]/g, '').trim();
  return clean ? `"${clean}" <${email}>` : email;
}

/**
 * Service path (CLAUDE.md §6, ADR-088): decrypts the sender's secret from Vault to build its provider. Callers are the
 * queue worker and the connection test, after an RLS-checked lookup where a user asked.
 */
export async function readMailSecret(settingsId: string): Promise<string | null> {
  const [row] = await dbAdmin.execute<{ secret: string | null }>(sql`select app.mail_get_secret(${settingsId}::uuid) as secret`);
  return row?.secret ?? null;
}

export type SenderInput = {
  preset: MailPreset;
  host: string | null;
  port: number | null;
  security: MailSecurity;
  username: string | null;
  fromEmail: string;
};

/** Builds a provider from settings (saved, or typed into the form for a test) and the plain secret. */
export function providerFromSettings(s: SenderInput, secret: string | null): EmailProvider {
  const d = presetDefaults[s.preset];
  if (d.api) return new ResendEmailProvider(secret ?? '', s.fromEmail);
  return new SmtpEmailProvider({
    host: s.host ?? d.host ?? '',
    port: s.port ?? d.port ?? 587,
    security: s.security,
    user: s.username,
    pass: secret,
    from: s.fromEmail,
  });
}

export type ResolvedSender = {
  kind: SenderKind;
  provider: EmailProvider;
  from: (locale: Locale) => string | undefined;
  replyTo: string | null;
  settings: MailSettingsRow | null;
};

/**
 * Who sends an organization's mail right now: development → Mailpit; an active configured sender → it, with the
 * environment provider as fallback (production only, and not the console); no configured sender → the environment.
 */
export async function resolveSenders(organizationId: string | null): Promise<{ primary: ResolvedSender; fallback: ResolvedSender | null }> {
  const environment = (kind: SenderKind, settings: MailSettingsRow | null, orgName: LocalizedText | null): ResolvedSender => ({
    kind,
    provider: environmentEmailProvider(),
    // Keep the environment's own From (its domain is the verified one), but show the agency's name.
    from: (locale) => {
      const address = env().EMAIL_FROM.match(/<([^>]+)>/)?.[1] ?? env().EMAIL_FROM;
      const name = settings ? localized(settings.fromName, locale) : orgName ? localized(orgName, locale) : '';
      return name ? formatFrom(name, address) : undefined;
    },
    replyTo: settings?.replyTo ?? null,
    settings,
  });

  const [org] = organizationId
    ? await dbAdmin.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId))
    : [];
  const [settings] = organizationId ? await dbAdmin.select().from(mailSettings).where(eq(mailSettings.organizationId, organizationId)) : [];
  const orgName = org?.name ?? null;

  if (devMailOnly()) return { primary: environment('dev', settings ?? null, orgName), fallback: null };
  if (!settings || !settings.isActive || !settings.secretId) return { primary: environment('environment', null, orgName), fallback: null };

  const secret = await readMailSecret(settings.id);
  const primary: ResolvedSender = {
    kind: 'configured',
    provider: providerFromSettings(
      {
        preset: settings.preset as MailPreset,
        host: settings.host,
        port: settings.port,
        security: settings.security as MailSecurity,
        username: settings.username,
        fromEmail: settings.fromEmail,
      },
      secret,
    ),
    from: (locale) => formatFrom(localized(settings.fromName, locale) || (orgName ? localized(orgName, locale) : ''), settings.fromEmail),
    replyTo: settings.replyTo,
    settings,
  };
  const envProvider = environmentEmailProvider();
  const fallback = envProvider.name === 'console' ? null : environment('fallback', settings, orgName);
  return { primary, fallback };
}
