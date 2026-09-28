import 'server-only';

import { getLocale, getTimeZone } from 'next-intl/server';

import { getAppContext } from '@/lib/auth/context';
import { createFormatters, type Formatters } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/localized';

/** Formatters for Server Components, honoring the user's locale, time zone and calendar preference. */
export async function getFormatters(): Promise<Formatters & { locale: Locale }> {
  const locale = (await getLocale()) as Locale;
  const ctx = await getAppContext();
  const timeZone = ctx?.profile.timezone ?? (await getTimeZone());
  const calendar = ctx?.profile.calendar === 'islamic-umalqura' ? 'islamic-umalqura' : 'gregory';
  return { ...createFormatters({ locale, timeZone, calendar }), locale };
}
