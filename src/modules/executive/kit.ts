/**
 * An executive text kit outside React (the brief action, board report exports, the scheduled email): the `executive`
 * translator, formatters and the other modules' labels it borrows. Messages are imported statically.
 */
import { createTranslator } from 'next-intl';

import { createFormatters } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/localized';
import type { ExecKit, ExecT } from '@/modules/executive/text';
import arCampaigns from '@messages/ar/campaigns.json';
import arCrm from '@messages/ar/crm.json';
import arExecutive from '@messages/ar/executive.json';
import arOperations from '@messages/ar/operations.json';
import enCampaigns from '@messages/en/campaigns.json';
import enCrm from '@messages/en/crm.json';
import enExecutive from '@messages/en/executive.json';
import enOperations from '@messages/en/operations.json';

const labelSets = {
  ar: { campaigns: arCampaigns, crm: arCrm, operations: arOperations },
  en: { campaigns: enCampaigns, crm: enCrm, operations: enOperations },
};

/** The label lookups `ExecKit` needs, from the owning modules' message tables. */
export function labelLookup(locale: Locale): ExecKit['label'] {
  const m = labelSets[locale];
  const tables = {
    platform: m.campaigns.platform as Record<string, string>,
    campaignHealth: m.campaigns.health as Record<string, string>,
    leadSource: m.crm.sources as Record<string, string>,
    lostReason: m.crm.lostReasons as Record<string, string>,
    clientHealth: m.operations.health.levels as Record<string, string>,
  };
  return (group, key) => tables[group][key] ?? key;
}

export function executiveKit(locale: Locale, timeZone = 'Asia/Riyadh'): ExecKit {
  const t = createTranslator({ locale, messages: { executive: locale === 'ar' ? arExecutive : enExecutive }, namespace: 'executive' });
  return {
    t: ((key, values) => t(key as never, values as never)) as ExecT,
    f: createFormatters({ locale, timeZone }),
    locale,
    label: labelLookup(locale),
  };
}
