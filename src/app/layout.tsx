import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic, Inter, JetBrains_Mono } from 'next/font/google';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { Providers } from '@/components/providers';
import { getSession } from '@/lib/auth/session';
import { withRls } from '@/lib/db/rls';
import { resolveLocale } from '@/i18n/request';
import { directionOf } from '@/lib/i18n/localized';

import './globals.css';

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-arabic',
  display: 'swap',
});
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return {
    title: { default: t('appName'), template: `%s · ${t('appName')}` },
    description: t('appTagline'),
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8f9fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1016' },
  ],
};

async function loadPreferences() {
  const session = await getSession();
  if (!session) return null;
  const profile = await withRls(
    (tx) =>
      tx.query.profiles.findFirst({
        where: (p, { eq }) => eq(p.id, session.userId),
        columns: { theme: true, timezone: true, calendar: true },
      }),
    session,
  );
  return profile ?? null;
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await resolveLocale();
  const prefs = await loadPreferences();
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html
      lang={locale}
      dir={directionOf(locale)}
      suppressHydrationWarning
      className={`${plexArabic.variable} ${inter.variable} ${jetbrains.variable}`}
    >
      <body className="min-h-dvh">
        <NextIntlClientProvider>
          <Providers
            locale={locale}
            nonce={nonce}
            timeZone={prefs?.timezone ?? 'Asia/Riyadh'}
            calendar={prefs?.calendar === 'islamic-umalqura' ? 'islamic-umalqura' : 'gregory'}
            theme={(prefs?.theme as 'system' | 'light' | 'dark' | undefined) ?? 'system'}
          >
            {children}
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
