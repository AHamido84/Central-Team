import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import { forbidden } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/patterns';
import { requireSignedIn } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import { notificationClientPreferences, notificationPreferences } from '@/lib/db/schema';
import { localized, type Locale } from '@/lib/i18n/localized';
import { can } from '@/lib/permissions/can';
import { SettingsNav } from '@/modules/identity/components/settings-nav';
import type { EmailChangeState } from '@/modules/identity/server/actions';
import {
  ClientNotificationSettings,
  NotificationSettings,
  PreferencesSettings,
  ProfileSettings,
} from '@/modules/identity/components/settings-forms';
import { WhatsAppOptIn } from '@/modules/integrations/components/whatsapp-opt-in';
import { MyConnections } from '@/modules/integrations/components/my-connections';
import { sandboxEnabled } from '@/modules/integrations/providers';
import { getWhatsAppChannel, listPersonalConnections } from '@/modules/integrations/server/queries';
import { listClients } from '@/modules/clients/server/queries';
import { notificationCategories } from '@/modules/notifications/types';

const TIMEZONES = [
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Asia/Bahrain',
  'Asia/Muscat',
  'Africa/Cairo',
  'Europe/London',
  'Europe/Istanbul',
  'UTC',
];

/** Settings pages are shared by both sides; only the base path differs. */
type Base = '/settings' | '/portal/settings';

async function Shell({ base, children }: { base: Base; children: ReactNode }) {
  const t = await getTranslations('settings');
  const ctx = await requireSignedIn();
  const showConnections = base === '/settings' && ctx.side === 'agency' && can(ctx.permissions, 'integrations:connect');
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('title')} description={t('description')} />
      <SettingsNav base={base} showConnections={showConnections} />
      <div className="mt-6">{children}</div>
    </div>
  );
}

/** The caller's pending email change (GoTrue keeps it in auth.users; `app.my_email_change` exposes only their own). */
async function pendingEmailChange(): Promise<EmailChangeState> {
  const [row] = await withRls((tx) =>
    tx.execute<{ new_email: string; sent_at: string | null; confirmed_one: boolean }>(
      sql`select new_email, sent_at, confirmed_one from app.my_email_change()`,
    ),
  );
  return row
    ? { newEmail: row.new_email, sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null, confirmedOne: row.confirmed_one }
    : null;
}

/** Local development only: auth emails land in Mailpit, not in real inboxes. */
function devMailbox(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  const api = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(api) ? 'http://localhost:54324' : null;
}

export async function ProfileSettingsPage({ base }: { base: Base }) {
  const ctx = await requireSignedIn();
  const pending = await pendingEmailChange();
  return (
    <Shell base={base}>
      <ProfileSettings
        email={ctx.profile.email}
        pendingEmail={pending}
        devMailbox={devMailbox()}
        defaults={{
          fullName: ctx.profile.fullName,
          phone: ctx.profile.phone ?? '',
          whatsapp: ctx.profile.whatsapp ?? '',
          avatarPath: ctx.profile.avatarPath,
        }}
      />
    </Shell>
  );
}

export async function PreferencesSettingsPage({ base }: { base: Base }) {
  const ctx = await requireSignedIn();
  const tz = ctx.profile.timezone;
  return (
    <Shell base={base}>
      <PreferencesSettings
        timezones={TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES]}
        defaults={{
          locale: ctx.profile.locale === 'en' ? 'en' : 'ar',
          theme: (ctx.profile.theme as 'system' | 'light' | 'dark') ?? 'system',
          timezone: tz,
          calendar: ctx.profile.calendar === 'islamic-umalqura' ? 'islamic-umalqura' : 'gregory',
        }}
      />
    </Shell>
  );
}

export async function NotificationSettingsPage({ base }: { base: Base }) {
  const ctx = await requireSignedIn();
  const rows = await withRls((tx) =>
    tx
      .select()
      .from(notificationPreferences)
      .where(and(eq(notificationPreferences.userId, ctx.session.userId), eq(notificationPreferences.organizationId, ctx.organization.id))),
  );
  const agencyOnly = ['account', 'tasks', 'sla', 'sales', 'integrations', 'automations', 'ai'];
  const categories =
    ctx.side === 'client'
      ? notificationCategories.filter((c) => !agencyOnly.includes(c))
      : notificationCategories.filter((c) => c !== 'approvals');
  // WhatsApp is an agency channel (Phase 7): shown when the agency has a notification template to send through.
  const whatsapp = ctx.side === 'agency' ? await getWhatsAppChannel(ctx.session.userId, ctx.organization.id) : null;
  const defaults = categories.map((category) => {
    const row = rows.find((r) => r.category === category);
    return { category, inApp: row?.inApp ?? true, email: row?.email ?? true, whatsapp: row?.whatsapp ?? false };
  });
  // A portal user in several clients gets per-client overrides on top of the default (FR4.3, ADR-093).
  if (ctx.side === 'client' && ctx.clients.length > 1) {
    const overrides = await withRls((tx) =>
      tx.select().from(notificationClientPreferences).where(eq(notificationClientPreferences.userId, ctx.session.userId)),
    );
    const locale = (await getLocale()) as Locale;
    return (
      <Shell base={base}>
        <ClientNotificationSettings
          defaults={defaults}
          clients={ctx.clients.map((c) => ({
            id: c.id,
            name: localized(c.name, locale),
            overrides: overrides.some((o) => o.clientId === c.id)
              ? defaults.map((d) => {
                  const o = overrides.find((x) => x.clientId === c.id && x.category === d.category);
                  return { ...d, inApp: o?.inApp ?? d.inApp, email: o?.email ?? d.email };
                })
              : null,
          }))}
          initialScope={ctx.client.id}
        />
      </Shell>
    );
  }
  return (
    <Shell base={base}>
      {whatsapp ? <WhatsAppOptIn channel={whatsapp} /> : null}
      <NotificationSettings whatsapp={whatsapp ? { available: whatsapp.available, optedIn: whatsapp.optedIn } : null} defaults={defaults} />
    </Shell>
  );
}

/** "My connected accounts" (FR1.6): the signed-in person's own platform connections. */
export async function ConnectionsSettingsPage() {
  const ctx = await requireSignedIn();
  if (ctx.side !== 'agency' || !can(ctx.permissions, 'integrations:connect')) forbidden();
  const [connections, clients, locale] = await Promise.all([
    listPersonalConnections('mine', ctx.session.userId),
    listClients(ctx),
    getLocale() as Promise<Locale>,
  ]);
  return (
    <Shell base="/settings">
      <MyConnections
        connections={connections}
        clients={clients.map((c) => ({ id: c.id, name: localized(c.name, locale) }))}
        sandbox={sandboxEnabled()}
      />
    </Shell>
  );
}
