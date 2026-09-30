'use client';

import { Search, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Input } from '@/components/ui/input';
import { Avatar, Badge, Card, NativeSelect, Progress } from '@/components/ui/primitives';
import { localized, type Locale } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { loadShare } from '@/modules/operations/health';
import type { TeamOverview } from '@/modules/operations/server/queries';

export function TeamTable({ data, department }: { data: TeamOverview; department: string | null }) {
  const t = useTranslations('operations.team');
  const f = useFormat();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const members = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (
      data.members
        .filter((m) => !department || m.departments.some((d) => d.id === department))
        .filter((m) => !q || m.name.toLowerCase().includes(q) || (m.jobTitle ?? '').toLowerCase().includes(q))
        // Code-point order, not localeCompare: Node's and the browser's ICU order mixed Arabic / Latin names differently,
        // which reordered rows on hydration.
        .sort((a, b) => b.openTasks - a.openTasks || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    );
  }, [data.members, department, query]);
  const busiest = Math.max(0, ...data.members.map((m) => m.openTasks));
  const hours = (m: number | null) => (m === null ? '—' : t('hoursValue', { hours: f.number(m / 60, { maximumFractionDigits: 1 }) }));
  const tone = (share: number) => (share >= 0.85 ? 'danger' : share >= 0.6 ? 'warning' : 'brand');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-56 flex-1 sm:max-w-xs">
          <span className="sr-only">{t('search')}</span>
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search')}
            className="ps-9"
            data-testid="team-search"
          />
        </label>
        <NativeSelect
          aria-label={t('departments')}
          value={department ?? ''}
          onChange={(e) => router.push(e.target.value ? `${pathname}?department=${e.target.value}` : pathname, { scroll: false })}
          className="min-w-48"
          data-testid="team-department"
        >
          <option value="">{t('allDepartments')}</option>
          {data.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {localized(d.name, locale)}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-subtle-foreground">{t('scopeNote')}</p>
      </div>

      <Card className="overflow-hidden">
        {members.length === 0 ? (
          <EmptyState icon={UsersRound} title={t('empty')} description={t('emptyBody')} />
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm" data-testid="team-table">
                <thead className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-start font-medium">
                      {t('member')}
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-start font-medium">
                      {t('load')}
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-end font-medium">
                      {t('openTasks')}
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-end font-medium">
                      {t('overdue')}
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-end font-medium">
                      {t('week')}
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-end font-medium">
                      {t('reviews')}
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-end font-medium">
                      {t('requests')}
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-end font-medium">
                      {t('clients')}
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-end font-medium" title={data.canSeeTime ? undefined : t('hoursHidden')}>
                      {t('hours')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {members.map((m) => {
                    const share = loadShare(m.openTasks, busiest);
                    return (
                      <tr key={m.id} className="hover:bg-surface-muted" data-testid="team-row">
                        <td className="px-4 py-3">
                          <Link href={`/team/${m.id}`} className="flex items-center gap-3 hover:underline">
                            <Avatar name={m.name} src={publicAssetUrl(m.avatarPath)} size="sm" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{m.name}</span>
                              <span className="block truncate text-xs text-subtle-foreground">
                                {(m.departments.length
                                  ? f.list(m.departments.map((d) => localized(d.name, locale) + (d.isLead ? ` · ${t('lead')}` : '')))
                                  : m.jobTitle) || '—'}
                              </span>
                            </span>
                          </Link>
                        </td>
                        <td className="w-40 px-3 py-3">
                          <Progress value={share * 100} tone={tone(share)} aria-label={t('load')} />
                        </td>
                        <td className="tabular px-3 py-3 text-end">{f.number(m.openTasks)}</td>
                        <td className={cn('tabular px-3 py-3 text-end', m.overdue ? 'font-semibold text-danger' : '')}>
                          {f.number(m.overdue)}
                        </td>
                        <td className="tabular px-3 py-3 text-end">{f.number(m.dueThisWeek)}</td>
                        <td className="tabular px-3 py-3 text-end">{f.number(m.reviews)}</td>
                        <td className="tabular px-3 py-3 text-end">{f.number(m.openRequests)}</td>
                        <td className="tabular px-3 py-3 text-end">{f.number(m.clients)}</td>
                        <td className="tabular px-4 py-3 text-end text-muted-foreground">{hours(m.minutes7d)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-border lg:hidden">
              {members.map((m) => {
                const share = loadShare(m.openTasks, busiest);
                return (
                  <li key={m.id}>
                    <Link href={`/team/${m.id}`} className="flex items-start gap-3 px-4 py-3" data-testid="team-card">
                      <Avatar name={m.name} src={publicAssetUrl(m.avatarPath)} size="sm" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-medium">{m.name}</p>
                          {m.overdue ? (
                            <Badge tone="danger">
                              {t('overdue')} {f.number(m.overdue)}
                            </Badge>
                          ) : null}
                        </div>
                        <Progress value={share * 100} tone={tone(share)} aria-label={t('load')} />
                        <p className="text-xs text-muted-foreground">
                          {t('openTasks')} {f.number(m.openTasks)} · {t('week')} {f.number(m.dueThisWeek)} · {t('reviews')}{' '}
                          {f.number(m.reviews)}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
      {!data.canSeeTime ? <p className="text-xs text-subtle-foreground">{t('hoursHidden')}</p> : null}
    </div>
  );
}
