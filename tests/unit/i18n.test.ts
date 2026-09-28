import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { namespaces } from '@/i18n/messages';
import { createFormatters, intlLocale } from '@/lib/i18n/format';
import { directionOf, localized } from '@/lib/i18n/localized';

const dir = path.resolve(__dirname, '../../messages');

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = String(v);
  }
  return out;
}

const load = (locale: string, ns: string) => flatten(JSON.parse(readFileSync(path.join(dir, locale, `${ns}.json`), 'utf8')));

/** Top-level ICU arguments, e.g. {name}, {count, plural, ...} → name, count. Rich-text tags <b> too. */
function args(message: string): string[] {
  const found = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    if (message[i] === '{') {
      if (depth === 0) {
        const m = /^\{\s*([a-zA-Z0-9_]+)/.exec(message.slice(i));
        if (m) found.add(m[1]!);
      }
      depth++;
    } else if (message[i] === '}') depth--;
  }
  for (const m of message.matchAll(/<([a-z]+)>/g)) found.add(`<${m[1]}>`);
  return [...found].sort();
}

describe('messages', () => {
  it('has exactly the declared namespaces for both locales', () => {
    for (const locale of ['ar', 'en']) {
      const files = readdirSync(path.join(dir, locale))
        .map((f) => f.replace(/\.json$/, ''))
        .sort();
      expect(files).toEqual([...namespaces].sort());
    }
  });

  for (const ns of namespaces) {
    it(`"${ns}" has identical keys and placeholders in ar and en`, () => {
      const ar = load('ar', ns);
      const en = load('en', ns);
      expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
      for (const key of Object.keys(ar)) {
        expect({ key, args: args(ar[key]!) }).toEqual({ key, args: args(en[key]!) });
        expect(ar[key]!.trim().length, `${ns}.${key} is empty`).toBeGreaterThan(0);
      }
    });
  }
});

describe('formatting (ADR-010)', () => {
  it('uses Latin digits and the Gregorian calendar for Arabic by default', () => {
    expect(intlLocale('ar')).toBe('ar-SA-u-nu-latn-ca-gregory');
    const f = createFormatters({ locale: 'ar', timeZone: 'Asia/Riyadh' });
    const d = f.date(new Date('2026-09-28T09:00:00Z'), 'long');
    expect(d).toMatch(/28/);
    expect(d).toMatch(/2026/);
    expect(d).not.toMatch(/[٠-٩]/);
    expect(f.number(1234.5)).toBe('1,234.5');
  });

  it('formats SAR amounts stored in halalas', () => {
    const en = createFormatters({ locale: 'en' });
    expect(en.currency(1_450_000)).toMatch(/14,500\.00/);
    expect(en.currency(1_450_000)).toMatch(/SAR/);
  });

  it('supports the Hijri (Umm al-Qura) calendar as an opt-in', () => {
    const f = createFormatters({ locale: 'ar', calendar: 'islamic-umalqura', timeZone: 'Asia/Riyadh' });
    expect(f.date(new Date('2026-09-28T09:00:00Z'), 'long')).toMatch(/1448/);
  });

  it('formats byte sizes', () => {
    const f = createFormatters({ locale: 'en' });
    expect(f.bytes(512)).toMatch(/512/);
    expect(f.bytes(2.5 * 1024 * 1024)).toMatch(/2\.5/);
  });
});

describe('localized()', () => {
  it('falls back to the other language when a translation is missing', () => {
    expect(localized({ ar: 'عميل' }, 'en')).toBe('عميل');
    expect(localized({ ar: '', en: 'Client' }, 'ar')).toBe('Client');
    expect(localized(null, 'ar')).toBe('');
  });
  it('maps locales to text direction', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });
});
