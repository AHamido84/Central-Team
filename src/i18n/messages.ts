import type { Locale } from '@/lib/i18n/localized';

/** One JSON file per namespace in messages/<locale>/. Keep in sync with scripts/check-i18n.ts. */
export const namespaces = [
  'common',
  'nav',
  'auth',
  'onboarding',
  'errors',
  'validation',
  'emails',
  'notifications',
  'dashboard',
  'admin',
  'settings',
  'designSystem',
  'clients',
  'files',
  'messaging',
  'portal',
] as const;

export type Namespace = (typeof namespaces)[number];
export type Messages = import('@/i18n/types').AppMessages;

export async function loadMessages(locale: Locale): Promise<Messages> {
  const entries = await Promise.all(
    namespaces.map(async (ns) => {
      const mod = (await import(`../../messages/${locale}/${ns}.json`)) as { default: Record<string, unknown> };
      return [ns, mod.default] as const;
    }),
  );
  return Object.fromEntries(entries) as unknown as Messages;
}
