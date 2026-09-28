import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { loadMessages } from '@/i18n/messages';
import { defaultLocale, isLocale, type Locale } from '@/lib/i18n/localized';

export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const TIMEZONE_COOKIE = 'tz';

/** Locale: cookie (kept in sync with the profile on sign-in and on change) → Accept-Language → Arabic. */
export async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const accept = (await headers()).get('accept-language') ?? '';
  const preferred = accept.split(',')[0]?.trim().slice(0, 2).toLowerCase();
  return isLocale(preferred) ? preferred : defaultLocale;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  const cookieStore = await cookies();
  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: cookieStore.get(TIMEZONE_COOKIE)?.value ?? 'Asia/Riyadh',
  };
});
