import 'server-only';

import { and, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/patterns';
import { requireSignedIn } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import { notificationPreferences } from '@/lib/db/schema';
import { SettingsNav } from '@/modules/identity/components/settings-nav';
import { NotificationSettings, PreferencesSettings, ProfileSettings } from '@/modules/identity/components/settings-forms';
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
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('title')} description={t('description')} />
      <SettingsNav base={base} />
      <div className="mt-6">{children}</div>
    </div>
  );
}

export async function ProfileSettingsPage({ base }: { base: Base }) {
  const ctx = await requireSignedIn();
  return (
    <Shell base={base}>
      <ProfileSettings
        email={ctx.profile.email}
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
  const categories = ctx.side === 'client' ? notificationCategories.filter((c) => c !== 'account') : notificationCategories;
  return (
    <Shell base={base}>
      <NotificationSettings
        defaults={categories.map((category) => {
          const row = rows.find((r) => r.category === category);
          return { category, inApp: row?.inApp ?? true, email: row?.email ?? true };
        })}
      />
    </Shell>
  );
}
