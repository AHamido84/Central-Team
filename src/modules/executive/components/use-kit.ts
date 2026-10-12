'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { useFormat } from '@/components/providers';
import type { Locale } from '@/lib/i18n/localized';
import type { ExecKit, ExecT } from '@/modules/executive/text';

/** The executive kit inside React: the same formatting as the exports, with the other modules' labels. */
export function useExecKit(): ExecKit {
  const t = useTranslations('executive');
  const tc = useTranslations('campaigns');
  const tcrm = useTranslations('crm');
  const tops = useTranslations('operations');
  const f = useFormat();
  const locale = useLocale() as Locale;
  return useMemo(() => {
    const label: ExecKit['label'] = (group, key) => {
      const table = {
        platform: 'platform',
        campaignHealth: 'health',
        leadSource: 'sources',
        lostReason: 'lostReasons',
        clientHealth: 'health.levels',
      }[group];
      const full = `${table}.${key}`;
      const tr = group === 'clientHealth' ? tops : group === 'leadSource' || group === 'lostReason' ? tcrm : tc;
      return tr.has(full as never) ? tr(full as never) : key;
    };
    return { t: ((key, values) => t(key as never, values as never)) as ExecT, f, locale, label };
  }, [t, tc, tcrm, tops, f, locale]);
}
