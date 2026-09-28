import type { Locale } from '@/lib/i18n/localized';

export type CalendarPreference = 'gregory' | 'islamic-umalqura';

export type FormatOptions = {
  locale: Locale;
  timeZone?: string;
  calendar?: CalendarPreference;
};

/**
 * BCP-47 tag used for Intl. Arabic always uses Latin digits and, by default, the Gregorian calendar —
 * plain `ar-SA` would silently switch to Arabic-Indic digits and the Umm al-Qura calendar (ADR-010).
 */
export function intlLocale(locale: Locale, calendar: CalendarPreference = 'gregory'): string {
  return locale === 'ar' ? `ar-SA-u-nu-latn-ca-${calendar}` : `en-GB-u-ca-${calendar}`;
}

const toDate = (value: Date | string | number) => (value instanceof Date ? value : new Date(value));

export function createFormatters({ locale, timeZone = 'Asia/Riyadh', calendar = 'gregory' }: FormatOptions) {
  const tag = intlLocale(locale, calendar);
  const numberTag = intlLocale(locale);
  return {
    date(value: Date | string | number, style: 'short' | 'medium' | 'long' = 'medium') {
      return new Intl.DateTimeFormat(tag, { dateStyle: style, timeZone }).format(toDate(value));
    },
    dateTime(value: Date | string | number) {
      return new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
        toDate(value),
      );
    },
    time(value: Date | string | number) {
      return new Intl.DateTimeFormat(tag, { timeStyle: 'short', timeZone }).format(toDate(value));
    },
    monthYear(value: Date | string | number) {
      return new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric', timeZone }).format(toDate(value));
    },
    weekday(value: Date | string | number) {
      return new Intl.DateTimeFormat(tag, { weekday: 'long', timeZone }).format(toDate(value));
    },
    relative(value: Date | string | number, now: Date = new Date()) {
      const diffSeconds = Math.round((toDate(value).getTime() - now.getTime()) / 1000);
      const abs = Math.abs(diffSeconds);
      const rtf = new Intl.RelativeTimeFormat(numberTag, { numeric: 'auto' });
      if (abs < 45) return rtf.format(0, 'second');
      if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(diffSeconds / 3600), 'hour');
      if (abs < 86400 * 7) return rtf.format(Math.round(diffSeconds / 86400), 'day');
      return new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeZone }).format(toDate(value));
    },
    list(items: string[]) {
      return new Intl.ListFormat(numberTag, { style: 'short', type: 'unit' }).format(items.filter(Boolean));
    },
    number(value: number, options?: Intl.NumberFormatOptions) {
      return new Intl.NumberFormat(numberTag, options).format(value);
    },
    percent(value: number) {
      return new Intl.NumberFormat(numberTag, { style: 'percent', maximumFractionDigits: 0 }).format(value);
    },
    /** Amounts are stored in minor units (halalas). */
    currency(minor: number, currency = 'SAR') {
      return new Intl.NumberFormat(numberTag, { style: 'currency', currency }).format(minor / 100);
    },
    bytes(value: number) {
      const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;
      let size = value;
      let unit = 0;
      while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit++;
      }
      return new Intl.NumberFormat(numberTag, {
        style: 'unit',
        unit: units[unit],
        unitDisplay: 'short',
        maximumFractionDigits: unit === 0 ? 0 : 1,
      }).format(size);
    },
  };
}

export type Formatters = ReturnType<typeof createFormatters>;
