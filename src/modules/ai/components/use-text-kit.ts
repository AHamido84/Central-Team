'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { useFormat } from '@/components/providers';
import type { TextKit, Translate } from '@/modules/ai/insight-text';

/** The insight / recommendation text kit for client components (same sentences as the server renders). */
export function useTextKit(): TextKit {
  const t = useTranslations('ai');
  const tc = useTranslations('campaigns');
  const f = useFormat();
  return useMemo(
    () => ({
      t: ((key, values) => t(key as never, values as never)) as Translate,
      f,
      metric: (key: string) => (tc.has(`metric.${key}` as never) ? tc(`metric.${key}` as never) : key),
      platform: (key: string) => (tc.has(`platform.${key}` as never) ? tc(`platform.${key}` as never) : key),
    }),
    [t, tc, f],
  );
}
