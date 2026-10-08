'use client';

import { ChevronLeft, ChevronRight, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type KeyboardEvent } from 'react';

import { useFormat } from '@/components/providers';
import { DirIcon } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { cn } from '@/lib/utils/cn';
import { PlatformMark } from '@/modules/campaigns/components/badges';
import { baseMetrics, type BaseMetric } from '@/modules/campaigns/constants';
import { addDays, weekStart, type MetricRow } from '@/modules/campaigns/metrics';
import { saveMetricsAction } from '@/modules/campaigns/server/actions';
import type { ChannelItem } from '@/modules/campaigns/server/queries';

const money: readonly BaseMetric[] = ['spend', 'revenue'];

/** Stored value → what the cell shows (SAR for money). */
const toCell = (metric: BaseMetric, v: number) => (money.includes(metric) ? String(v / 100) : String(v));
const fromCell = (metric: BaseMetric, s: string) => {
  const n = Number(s.replace(/[,٬\s]/g, '').replace('٫', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return money.includes(metric) ? Math.round(n * 100) : Math.round(n);
};

/**
 * Manual entry, one channel and one week (Sunday–Saturday) at a time. Rows are days, columns metrics; arrow keys
 * move between cells. Only touched days are saved (whole-day upsert).
 */
export function MetricsGrid({
  campaignId,
  channels,
  rows,
  startDate,
  endDate,
  today,
  focus,
}: {
  /** Open on this day's week and channel (after an import, or "Show" in the import history — FR6.3). */
  focus?: { date: string; channelId: string } | null;
  campaignId: string;
  channels: ChannelItem[];
  rows: MetricRow[];
  startDate: string;
  endDate: string;
  today: string;
}) {
  const t = useTranslations('campaigns');
  const f = useFormat();
  const [channelId, setChannelId] = useState(
    focus && channels.some((c) => c.id === focus.channelId) ? focus.channelId : (channels[0]?.id ?? ''),
  );
  const lastDay = [addDays(today, -1), endDate].sort()[0]!;
  const target = focus?.date ?? lastDay;
  const initial = weekStart(target < startDate ? startDate : target > endDate ? endDate : target);
  const [week, setWeek] = useState(initial);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const save = useAction(saveMetricsAction, { successMessage: t('metrics.saved'), onSuccess: () => setEdits({}) });

  if (channels.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground" data-testid="metrics-grid">
        {t('metrics.noChannels')}
      </Card>
    );
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const existing = new Map(rows.map((r) => [`${r.channelId}|${r.date}`, r]));
  const key = (date: string, metric: BaseMetric) => `${channelId}|${date}|${metric}`;
  const cellValue = (date: string, metric: BaseMetric) => {
    const k = key(date, metric);
    if (k in edits) return edits[k]!;
    const row = existing.get(`${channelId}|${date}`);
    return row ? toCell(metric, row[metric]) : '';
  };
  const dirty = Object.keys(edits).length > 0;
  const firstWeek = weekStart(startDate);
  const lastWeek = weekStart(endDate);

  const onSave = async () => {
    const byDay = new Map<string, { channelId: string; date: string } & Record<BaseMetric, number>>();
    for (const k of Object.keys(edits)) {
      const [ch, date] = k.split('|') as [string, string];
      const dayKey = `${ch}|${date}`;
      if (byDay.has(dayKey)) continue;
      const base = existing.get(dayKey);
      const values = Object.fromEntries(
        baseMetrics.map((m) => {
          const edited = edits[`${ch}|${date}|${m}`];
          const v = edited !== undefined ? (edited.trim() === '' ? 0 : fromCell(m, edited)) : (base?.[m] ?? 0);
          return [m, v ?? 0];
        }),
      ) as Record<BaseMetric, number>;
      byDay.set(dayKey, { channelId: ch, date, ...values });
    }
    await save.run({ campaignId, rows: [...byDay.values()] });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0] };
    const rtl = document.documentElement.dir === 'rtl';
    moves.ArrowLeft = [0, rtl ? 1 : -1];
    moves.ArrowRight = [0, rtl ? -1 : 1];
    const move = moves[e.key];
    if (!move) return;
    // Left/right only leave the cell when the caret is at its edge, so typing still works.
    const input = e.currentTarget;
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && input.selectionStart !== input.selectionEnd) return;
    const next = document.querySelector<HTMLInputElement>(`[data-cell="${r + move[0]}:${c + move[1]}"]`);
    if (next) {
      e.preventDefault();
      next.focus();
      next.select();
    }
  };

  return (
    <Card id="metrics-grid" className="flex scroll-mt-20 flex-col gap-4 p-4" data-testid="metrics-grid">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('fields.channels')}>
          {channels.map((ch) => (
            <button
              key={ch.id}
              type="button"
              role="tab"
              aria-selected={ch.id === channelId}
              onClick={() => setChannelId(ch.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
                ch.id === channelId
                  ? 'border-primary bg-primary-soft text-primary-soft-foreground'
                  : 'border-border text-muted-foreground hover:bg-surface-muted',
              )}
              data-testid="grid-channel"
            >
              <PlatformMark platform={ch.platform} />
              {ch.name || t(`platform.${ch.platform}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('metrics.previous')}
            disabled={week <= firstWeek}
            onClick={() => setWeek(addDays(week, -7))}
          >
            <DirIcon icon={ChevronLeft} />
          </Button>
          <span className="min-w-40 text-center text-sm font-medium" aria-live="polite">
            {t('metrics.range', { from: f.dayMonth(`${days[0]}T12:00:00Z`), to: f.date(`${days[6]}T12:00:00Z`) })}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('metrics.next')}
            disabled={week >= lastWeek}
            onClick={() => setWeek(addDays(week, 7))}
          >
            <DirIcon icon={ChevronRight} />
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-start font-medium">{t('chart.period')}</th>
              {baseMetrics.map((m) => (
                <th key={m} className="px-1 py-2 text-end font-medium whitespace-nowrap">
                  {t(`metric.${m}`)}
                  {money.includes(m) ? <span className="text-subtle-foreground">*</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((date, r) => {
              const outside = date < startDate || date > endDate || date > today;
              return (
                <tr key={date} className={cn('border-t border-border', outside && 'opacity-50')}>
                  <th scope="row" className="px-2 py-1.5 text-start font-normal whitespace-nowrap text-muted-foreground">
                    {f.weekday(`${date}T12:00:00Z`)} · {f.dayMonth(`${date}T12:00:00Z`)}
                  </th>
                  {baseMetrics.map((m, c) => {
                    const k = key(date, m);
                    return (
                      <td key={m} className="px-1 py-1">
                        <input
                          data-cell={`${r}:${c}`}
                          inputMode="decimal"
                          dir="ltr"
                          disabled={outside}
                          title={outside ? t('metrics.outsideFlight') : undefined}
                          aria-label={t('metrics.cell', {
                            metric: t(`metric.${m}`),
                            channel: channels.find((ch) => ch.id === channelId)?.name || '',
                            date: f.date(`${date}T12:00:00Z`),
                          })}
                          value={cellValue(date, m)}
                          onChange={(e) => setEdits((prev) => ({ ...prev, [k]: e.target.value }))}
                          onKeyDown={(e) => onKeyDown(e, r, c)}
                          onFocus={(e) => e.currentTarget.select()}
                          className={cn(
                            'tabular h-8 w-full min-w-20 rounded border border-transparent bg-surface-muted/60 px-2 text-end outline-none hover:border-border focus:border-primary focus:bg-surface disabled:cursor-not-allowed',
                            k in edits && 'border-primary/40 bg-primary-soft/40',
                            k in edits && edits[k]!.trim() !== '' && fromCell(m, edits[k]!) === null && 'border-danger',
                          )}
                          data-testid={`cell-${date}-${m}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="me-auto text-xs text-subtle-foreground">* {t('metrics.moneyHint')}</span>
        {dirty ? <span className="text-sm text-warning">{t('metrics.unsaved')}</span> : null}
        <Button variant="outline" disabled={!dirty} onClick={() => setEdits({})}>
          {t('metrics.discard')}
        </Button>
        <Button
          onClick={onSave}
          loading={save.pending}
          disabled={
            !dirty || Object.entries(edits).some(([k, v]) => v.trim() !== '' && fromCell(k.split('|')[2] as BaseMetric, v) === null)
          }
          data-testid="metrics-save"
        >
          <Save aria-hidden />
          {t('metrics.save')}
        </Button>
      </div>
    </Card>
  );
}
