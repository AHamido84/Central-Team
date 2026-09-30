'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';

import { NativeSelect } from '@/components/ui/primitives';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { salesPeriods } from '@/modules/crm/constants';

export function SalesFilters({
  period,
  ownerId,
  pipelineId,
  owners,
  pipelines,
}: {
  period: string;
  ownerId: string | null;
  pipelineId: string;
  owners: { id: string; name: string }[] | null;
  pipelines: { id: string; name: LocalizedText }[];
}) {
  const t = useTranslations('crm.dashboard');
  const tp = useTranslations('crm.pipeline');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const q = next.toString();
    router.push(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect
        aria-label={t('period')}
        value={period}
        onChange={(e) => set('period', e.target.value === 'month' ? null : e.target.value)}
        className="w-auto"
        data-testid="sales-period"
      >
        {salesPeriods.map((p) => (
          <option key={p} value={p}>
            {t(`periods.${p}`)}
          </option>
        ))}
      </NativeSelect>
      {owners ? (
        <NativeSelect
          aria-label={t('owner')}
          value={ownerId ?? ''}
          onChange={(e) => set('owner', e.target.value || null)}
          className="w-auto"
          data-testid="sales-owner"
        >
          <option value="">{t('everyone')}</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </NativeSelect>
      ) : null}
      {pipelines.length > 1 ? (
        <NativeSelect aria-label={tp('title')} value={pipelineId} onChange={(e) => set('pipeline', e.target.value)} className="w-auto">
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {localized(p.name, locale)}
            </option>
          ))}
        </NativeSelect>
      ) : null}
    </div>
  );
}
