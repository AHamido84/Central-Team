/**
 * A text kit (translator + formatters + labels) for a locale outside React — the indexer, prompts, tasks and the seed
 * render insights and records with it. Pure: messages are imported statically.
 */
import { createTranslator } from 'next-intl';

import { createFormatters } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/localized';
import arAi from '@messages/ar/ai.json';
import arCampaigns from '@messages/ar/campaigns.json';
import enAi from '@messages/en/ai.json';
import enCampaigns from '@messages/en/campaigns.json';
import type { TextKit, Translate } from '@/modules/ai/insight-text';

export function textKit(locale: Locale, timeZone = 'Asia/Riyadh'): TextKit {
  const messages = locale === 'ar' ? { ai: arAi, campaigns: arCampaigns } : { ai: enAi, campaigns: enCampaigns };
  const ai = createTranslator({ locale, messages, namespace: 'ai' });
  const lookup = (group: 'metric' | 'platform', key: string) => {
    const table = messages.campaigns[group] as Record<string, string>;
    return table[key] ?? key;
  };
  return {
    t: ((key, values) => ai(key as never, values as never)) as Translate,
    f: createFormatters({ locale, timeZone }),
    metric: (key) => lookup('metric', key),
    platform: (key) => lookup('platform', key),
  };
}
