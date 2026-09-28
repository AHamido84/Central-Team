export const locales = ['ar', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'ar';

export type LocalizedText = Partial<Record<Locale, string>>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

export function directionOf(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** Picks the text for `locale`, falling back to the other language so org-defined names never render empty. */
export function localized(value: LocalizedText | null | undefined, locale: Locale): string {
  if (!value) return '';
  const primary = value[locale]?.trim();
  if (primary) return primary;
  const fallback = locales.find((l) => l !== locale && value[l]?.trim());
  return fallback ? (value[fallback] ?? '') : '';
}
