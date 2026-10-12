'use client';

import { Filter, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Label, NativeSelect, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/primitives';
import { activeFilterCount, viewSearch } from '@/modules/executive/config';
import { nameText, type ExecKit } from '@/modules/executive/text';
import { comparisons, periodPresets, type ExecutiveFilters, type ExecutiveViewConfig } from '@/modules/executive/types';

export type ExecutiveOptions = {
  clients: { id: string; name: unknown }[];
  departments: { id: string; name: unknown }[];
  accountManagers: { id: string; name: string }[];
  platforms: string[];
};

export function useViewNavigation(config: ExecutiveViewConfig) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (overrides: Partial<ExecutiveViewConfig>) =>
    start(() => router.push(`/executive${viewSearch(config, overrides)}`, { scroll: false }));
  return { go, pending };
}

export function ExecutiveControls({ kit, config, options }: { kit: ExecKit; config: ExecutiveViewConfig; options: ExecutiveOptions }) {
  const { t } = kit;
  const id = useId();
  const { go, pending } = useViewNavigation(config);
  const [from, setFrom] = useState(config.from ?? '');
  const [to, setTo] = useState(config.to ?? '');
  const filterCount = activeFilterCount(config);
  const setFilter = (key: keyof ExecutiveFilters, value: string) => go({ filters: { ...config.filters, [key]: value || null } });

  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden" data-testid="executive-controls" aria-busy={pending}>
      <div className="flex min-w-40 flex-col gap-1.5">
        <Label htmlFor={`${id}-period`}>{t('controls.period')}</Label>
        <NativeSelect
          id={`${id}-period`}
          value={config.preset}
          onChange={(e) => go({ preset: e.target.value as ExecutiveViewConfig['preset'] })}
          data-testid="executive-period"
        >
          {periodPresets.map((p) => (
            <option key={p} value={p}>
              {t(`controls.presets.${p}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {config.preset === 'custom' ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ from: from || null, to: to || null });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-from`}>{t('controls.from')}</Label>
            <Input
              id={`${id}-from`}
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="executive-from"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-to`}>{t('controls.to')}</Label>
            <Input
              id={`${id}-to`}
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              data-testid="executive-to"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {t('controls.apply')}
          </Button>
        </form>
      ) : null}
      <div className="flex min-w-44 flex-col gap-1.5">
        <Label htmlFor={`${id}-compare`}>{t('controls.compare')}</Label>
        <NativeSelect
          id={`${id}-compare`}
          value={config.compare}
          onChange={(e) => go({ compare: e.target.value as ExecutiveViewConfig['compare'] })}
          data-testid="executive-compare"
        >
          {comparisons.map((c) => (
            <option key={c} value={c}>
              {t(`controls.comparisons.${c}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" data-testid="executive-filters">
            <Filter />
            {t('controls.filters')}
            {filterCount ? <Badge tone="brand">{kit.f.number(filterCount)}</Badge> : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-3">
          <FilterSelect
            id={`${id}-client`}
            label={t('controls.client')}
            all={t('controls.all')}
            value={config.filters.clientId ?? ''}
            onChange={(v) => setFilter('clientId', v)}
            options={options.clients.map((c) => ({ value: c.id, label: nameText(kit, c.name) }))}
            testId="filter-client"
          />
          <FilterSelect
            id={`${id}-department`}
            label={t('controls.department')}
            all={t('controls.all')}
            value={config.filters.departmentId ?? ''}
            onChange={(v) => setFilter('departmentId', v)}
            options={options.departments.map((d) => ({ value: d.id, label: nameText(kit, d.name) }))}
            testId="filter-department"
          />
          <FilterSelect
            id={`${id}-manager`}
            label={t('controls.accountManager')}
            all={t('controls.all')}
            value={config.filters.accountManagerId ?? ''}
            onChange={(v) => setFilter('accountManagerId', v)}
            options={options.accountManagers.map((m) => ({ value: m.id, label: m.name }))}
            testId="filter-manager"
          />
          <FilterSelect
            id={`${id}-platform`}
            label={t('controls.platform')}
            all={t('controls.all')}
            value={config.filters.platform ?? ''}
            onChange={(v) => setFilter('platform', v)}
            options={options.platforms.map((p) => ({ value: p, label: kit.label('platform', p) }))}
            testId="filter-platform"
          />
          {filterCount ? (
            <Button variant="ghost" size="sm" onClick={() => go({ filters: {} })}>
              <X />
              {t('controls.reset')}
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function FilterSelect({
  id,
  label,
  all,
  value,
  onChange,
  options,
  testId,
}: {
  id: string;
  label: string;
  all: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
