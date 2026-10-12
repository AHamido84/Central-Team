'use client';

import { ArrowDownRight, ArrowUpRight, Info, MessageSquarePlus, Minus } from 'lucide-react';
import Link from 'next/link';

import { DirIcon } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Badge, Card, Popover, PopoverContent, PopoverTrigger, Progress, Tooltip } from '@/components/ui/primitives';
import { cn } from '@/lib/utils/cn';
import { kpis, type KpiKey } from '@/modules/executive/catalog';
import type { KpiValue } from '@/modules/executive/compute';
import { Sparkline } from '@/modules/executive/components/sparkline';
import { formatDelta, formatKpi, type ExecKit } from '@/modules/executive/text';
import type { ExecutiveFilters } from '@/modules/executive/types';

/** Where a tile drills down to: the owning screen, narrowed to the selected client when it has a page for one. */
export function drillHref(key: KpiKey, filters: ExecutiveFilters): string | null {
  const def = kpis[key];
  if (!('href' in def) || !def.href) return null;
  if (filters.clientId && (def.href === '/clients' || def.href === '/dashboard')) return `/clients/${filters.clientId}`;
  return def.href;
}

/** The ⓘ panel: definition, formula and source of a KPI (the same text as docs/KPIS.md). */
export function KpiInfo({ kit, kpi }: { kit: ExecKit; kpi: KpiKey }) {
  const { t } = kit;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-subtle-foreground hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={t('tile.about', { name: t(`kpi.${kpi}.name`) })}
          data-testid={`kpi-info-${kpi}`}
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm" align="start">
        <p className="font-semibold">{t(`kpi.${kpi}.name`)}</p>
        <dl className="mt-2 space-y-2">
          <div>
            <dt className="text-xs font-medium text-subtle-foreground">{t('tile.definition')}</dt>
            <dd>{t(`kpi.${kpi}.definition`)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-subtle-foreground">{t('tile.formula')}</dt>
            <dd className="font-mono text-xs" dir="auto">
              {t(`kpi.${kpi}.formula`)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-subtle-foreground">{t('tile.source')}</dt>
            <dd>{t(`kpi.${kpi}.source`)}</dd>
          </div>
        </dl>
      </PopoverContent>
    </Popover>
  );
}

export function KpiTile({
  kit,
  value: v,
  filters,
  incomplete,
  onNote,
  className,
}: {
  kit: ExecKit;
  value: KpiValue;
  filters: ExecutiveFilters;
  incomplete: boolean;
  onNote?: (kpi: KpiKey) => void;
  className?: string;
}) {
  const { t, f } = kit;
  const name = t(`kpi.${v.key}.name`);
  const deltaText = formatDelta(kit, v.key, v.delta);
  const trend = !v.delta || v.delta.abs === 0 ? 'flat' : v.delta.abs > 0 ? 'up' : 'down';
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;
  const href = drillHref(v.key, filters);
  const valueText = formatKpi(kit, v.key, v.value, { compact: true });
  const hover = v.parts
    ? t('tile.parts', { num: f.number(Math.round(v.parts.num * 10) / 10), den: f.number(Math.round(v.parts.den * 10) / 10) })
    : v.sample !== null
      ? t('tile.sample', { count: f.number(v.sample) })
      : null;

  return (
    <Card className={cn('flex min-w-0 flex-col gap-2 p-4', className)} data-testid={`kpi-${v.key}`}>
      <div className="flex items-start justify-between gap-1">
        <span className="min-w-0 text-sm leading-snug text-muted-foreground">{name}</span>
        <div className="flex shrink-0 items-center">
          {onNote ? (
            <Tooltip content={t('tile.note')}>
              <button
                type="button"
                onClick={() => onNote(v.key)}
                className="inline-flex size-6 items-center justify-center rounded-full text-subtle-foreground hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none print:hidden"
                aria-label={t('tile.note')}
                data-testid={`kpi-note-${v.key}`}
              >
                <MessageSquarePlus className="size-3.5" aria-hidden />
              </button>
            </Tooltip>
          ) : null}
          <KpiInfo kit={kit} kpi={v.key} />
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
        {hover ? (
          <Tooltip content={hover}>
            <span
              tabIndex={0}
              className="tabular text-h2 font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`kpi-value-${v.key}`}
            >
              {valueText}
            </span>
          </Tooltip>
        ) : (
          <span className="tabular text-h2 font-semibold tracking-tight" data-testid={`kpi-value-${v.key}`}>
            {valueText}
          </span>
        )}
        {deltaText ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium',
              v.tone === 'good' && 'bg-success-soft text-success',
              v.tone === 'bad' && 'bg-danger-soft text-danger',
              v.tone === 'flat' && 'bg-surface-muted text-muted-foreground',
            )}
            title={v.previous !== null ? t('tile.previous', { value: formatKpi(kit, v.key, v.previous) }) : undefined}
            data-testid={`kpi-delta-${v.key}`}
          >
            <DirIcon icon={TrendIcon} className="size-3.5" />
            {deltaText}
          </span>
        ) : null}
      </div>
      <Sparkline values={v.sparkline} label={t('tile.sparkline')} tone={v.tone} />
      {v.target !== null ? (
        <div className="space-y-1">
          <Progress
            value={Math.round((v.progress ?? 0) * 100)}
            tone={v.progress === null ? 'brand' : v.progress >= 1 ? 'success' : v.progress >= 0.85 ? 'warning' : 'danger'}
            aria-label={t('tile.target', { value: formatKpi(kit, v.key, v.target) })}
          />
          <p className="flex justify-between gap-2 text-xs text-subtle-foreground">
            <span>{t('tile.target', { value: formatKpi(kit, v.key, v.target, { compact: true }) })}</span>
            {v.progress !== null ? <span>{t('tile.progress', { pct: f.percent(v.progress) })}</span> : null}
          </p>
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 text-xs text-subtle-foreground">
        {v.small && v.sample !== null ? (
          <Badge tone="warning" data-testid={`kpi-small-${v.key}`}>
            {t('tile.small', { count: f.number(v.sample) })}
          </Badge>
        ) : null}
        {incomplete && v.projection !== null ? (
          <span>{t('tile.projection', { value: formatKpi(kit, v.key, v.projection, { compact: true }) })}</span>
        ) : null}
        {v.value === null ? <span>{t('tile.noData')}</span> : null}
        {href ? (
          <Button asChild variant="link" size="sm" className="ms-auto h-auto p-0 text-xs print:hidden">
            <Link href={href} data-testid={`kpi-drill-${v.key}`}>
              {t('tile.drill')}
            </Link>
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
