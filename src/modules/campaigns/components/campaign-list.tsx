'use client';

import { Megaphone, Search, TriangleAlert, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { useFormat } from '@/components/providers';
import { EmptyState, StatCard } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, Card, NativeSelect } from '@/components/ui/primitives';
import { localized } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { CampaignStatusBadge, HealthBadge, PlatformList } from '@/modules/campaigns/components/badges';
import { PacingMeter } from '@/modules/campaigns/components/charts';
import { useMetricFormat } from '@/modules/campaigns/components/format';
import { campaignStatuses, platforms, type CampaignStatus, type Platform } from '@/modules/campaigns/constants';
import type { CampaignSummary } from '@/modules/campaigns/server/queries';

const toneOf = { on_track: 'success', at_risk: 'warning', off_track: 'danger', no_data: 'neutral' } as const;

export function CampaignFlight({ start, end }: { start: string; end: string }) {
  const f = useFormat();
  return (
    <span className="whitespace-nowrap">
      {f.dayMonth(`${start}T12:00:00Z`)} – {f.date(`${end}T12:00:00Z`)}
    </span>
  );
}

function SpendCell({ c }: { c: CampaignSummary }) {
  const t = useTranslations('campaigns');
  const { value } = useMetricFormat(c.currency);
  const budget = c.budgetMinor;
  const spent = c.analysis.totals.spend;
  return (
    <div className="flex min-w-36 flex-col gap-1.5">
      <span className="tabular text-sm">
        {value('spend', spent, { compact: true })}
        <span className="text-subtle-foreground"> / {value('spend', budget, { compact: true })}</span>
      </span>
      {budget > 0 ? (
        <PacingMeter
          value={spent / budget}
          expected={c.analysis.elapsed}
          tone={c.analysis.budget ? toneOf[c.analysis.budget.status] : 'neutral'}
          label={t('overview.budgetUsed')}
        />
      ) : null}
    </div>
  );
}

function HeadlineCell({ c }: { c: CampaignSummary }) {
  const t = useTranslations('campaigns');
  const { value } = useMetricFormat(c.currency);
  const k = c.headline;
  if (!k) return <span className="text-subtle-foreground">—</span>;
  return (
    <div className="flex flex-col">
      <span className="text-xs text-subtle-foreground">{t(`metric.${k.metric}`)}</span>
      <span className="tabular text-sm">
        {value(k.metric, k.actual, { compact: true })}
        <span className="text-subtle-foreground"> / {value(k.metric, k.target, { compact: true })}</span>
      </span>
    </div>
  );
}

export function CampaignList({
  campaigns,
  clients,
  hrefBase = '/campaigns',
  showClient = true,
  showSummary = true,
}: {
  campaigns: CampaignSummary[];
  clients?: { id: string; name: Parameters<typeof localized>[0] }[];
  hrefBase?: string;
  showClient?: boolean;
  showSummary?: boolean;
}) {
  const t = useTranslations('campaigns');
  const locale = useLocale() as 'ar' | 'en';
  const f = useFormat();
  const [clientId, setClientId] = useState('');
  const [status, setStatus] = useState<CampaignStatus | ''>('');
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [q, setQ] = useState('');

  const needle = q.trim().toLowerCase();
  const filtered = campaigns.filter(
    (c) =>
      (!clientId || c.clientId === clientId) &&
      (!status ? c.status !== 'archived' : c.status === status) &&
      (!platform || c.platforms.includes(platform)) &&
      (!needle ||
        c.name.toLowerCase().includes(needle) ||
        localized(c.clientName, locale).toLowerCase().includes(needle) ||
        `c-${c.number}`.includes(needle)),
  );
  const active = campaigns.filter((c) => c.status === 'active');
  const attention = active.filter((c) => c.health === 'at_risk' || c.health === 'off_track');
  const spend = active.reduce((s, c) => s + c.analysis.totals.spend, 0);
  const filteredOn = Boolean(clientId || status || platform || needle);

  if (campaigns.length === 0) {
    return (
      <Card>
        <EmptyState icon={Megaphone} title={t('list.emptyTitle')} description={t('list.emptyBody')} />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {showSummary ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label={t('list.summaryActive')} value={f.number(active.length)} icon={Megaphone} />
          <StatCard label={t('list.summarySpend')} value={f.currency(spend)} icon={Wallet} />
          <StatCard
            label={t('list.summaryAtRisk')}
            value={f.number(attention.length)}
            icon={TriangleAlert}
            footer={t('list.summaryAtRiskHint')}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2" role="search">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('list.search')}
            aria-label={t('list.search')}
            className="ps-8"
          />
        </div>
        {clients && showClient ? (
          <NativeSelect
            aria-label={t('fields.client')}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-auto"
            data-testid="filter-client"
          >
            <option value="">{t('list.allClients')}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {localized(c.name, locale)}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        <NativeSelect
          aria-label={t('fields.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as CampaignStatus | '')}
          className="w-auto"
          data-testid="filter-status"
        >
          <option value="">{t('list.allStatuses')}</option>
          {campaignStatuses.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t('fields.platform')}
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform | '')}
          className="w-auto"
        >
          <option value="">{t('list.allPlatforms')}</option>
          {platforms.map((p) => (
            <option key={p} value={p}>
              {t(`platform.${p}`)}
            </option>
          ))}
        </NativeSelect>
        {filteredOn ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setClientId('');
              setStatus('');
              setPlatform('');
              setQ('');
            }}
          >
            {t('list.clearFilters')}
          </Button>
        ) : null}
        <span className="ms-auto text-sm text-subtle-foreground" aria-live="polite">
          {t('list.count', { count: filtered.length })}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState compact icon={Search} title={t('list.emptyFiltered')} />
        </Card>
      ) : (
        <>
          {/* Desktop: table */}
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-sm" data-testid="campaign-table">
              <thead className="bg-surface-muted text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-start font-medium">{t('fields.name')}</th>
                  {showClient ? <th className="px-4 py-2.5 text-start font-medium">{t('fields.client')}</th> : null}
                  <th className="px-4 py-2.5 text-start font-medium">{t('fields.flight')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t('fields.spent')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t('fields.headline')}</th>
                  <th className="px-4 py-2.5 text-start font-medium">{t('fields.health')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-border hover:bg-surface-muted/50"
                    data-testid="campaign-row"
                    data-campaign-id={c.id}
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <Link href={`${hrefBase}/${c.id}`} className="font-medium hover:underline focus-visible:underline">
                          {c.name}
                        </Link>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-subtle-foreground" dir="ltr">
                            {`C-${c.number}`}
                          </span>
                          <CampaignStatusBadge status={c.status} />
                          <PlatformList platforms={c.platforms} />
                        </span>
                      </div>
                    </td>
                    {showClient ? (
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2">
                          <Avatar
                            size="xs"
                            name={localized(c.clientName, locale)}
                            src={c.clientLogo ? publicAssetUrl(c.clientLogo) : undefined}
                          />
                          {localized(c.clientName, locale)}
                        </span>
                      </td>
                    ) : null}
                    <td className="px-4 py-3 text-muted-foreground">
                      <CampaignFlight start={c.startDate} end={c.endDate} />
                    </td>
                    <td className="px-4 py-3">
                      <SpendCell c={c} />
                    </td>
                    <td className="px-4 py-3">
                      <HeadlineCell c={c} />
                    </td>
                    <td className="px-4 py-3">
                      <HealthBadge health={c.health} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {/* Mobile: cards */}
          <ul className="flex flex-col gap-2 md:hidden">
            {filtered.map((c) => (
              <li key={c.id}>
                <Link
                  href={`${hrefBase}/${c.id}`}
                  className="block rounded-lg border border-border bg-surface p-4 shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  data-testid="campaign-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{c.name}</p>
                      {showClient ? <p className="truncate text-xs text-muted-foreground">{localized(c.clientName, locale)}</p> : null}
                    </div>
                    <HealthBadge health={c.health} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <CampaignStatusBadge status={c.status} />
                    <CampaignFlight start={c.startDate} end={c.endDate} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <SpendCell c={c} />
                    <HeadlineCell c={c} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
