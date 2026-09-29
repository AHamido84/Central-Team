'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { NativeSelect } from '@/components/ui/primitives';

/** Ops dashboard scope: every accessible client, the viewer's own, or one account manager's. */
export function ScopeSelect({ value, managers }: { value: string; managers: { id: string; name: string }[] }) {
  const t = useTranslations('operations.scope');
  const router = useRouter();
  const pathname = usePathname();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t('label')}</span>
      <NativeSelect
        value={value}
        onChange={(e) => router.push(e.target.value === 'all' ? pathname : `${pathname}?scope=${e.target.value}`, { scroll: false })}
        className="min-w-52"
        data-testid="ops-scope"
      >
        <option value="all">{t('all')}</option>
        <option value="mine">{t('mine')}</option>
        {managers.map((m) => (
          <option key={m.id} value={m.id}>
            {t('manager', { name: m.name })}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
