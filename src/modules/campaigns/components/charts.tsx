'use client';

/**
 * Plain-SVG charts for campaign analytics (ADR-050), following the dataviz rules: one y-axis, thin 2px lines,
 * recessive grid, categorical colours in fixed order per entity (a channel keeps its colour across charts), legend
 * for 2+ series with direct end labels up to 4, crosshair + tooltip on hover/focus, and a table view. Time runs in
 * the reading direction (right → left in Arabic).
 */
import { Table2, LineChart } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

export type Series = { key: string; label: string; color: string; values: number[] };

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

function useWidth<T extends HTMLElement>(fallback = 320) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

export function TrendChart({
  title,
  points,
  series,
  formatValue,
  formatPoint,
  height = 240,
  className,
}: {
  title: string;
  points: string[];
  series: Series[];
  formatValue: (v: number) => string;
  formatPoint: (key: string) => string;
  height?: number;
  className?: string;
}) {
  const t = useTranslations('campaigns.chart');
  const rtl = useLocale() === 'ar';
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();

  const pad = { top: 12, bottom: 28, side: 12, axis: 56 };
  const directLabels = series.length > 1 && series.length <= 4;
  const labelRoom = directLabels ? 112 : 0;
  const plotW = Math.max(40, width - pad.side - pad.axis - labelRoom);
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const n = points.length;
  // The y-axis sits at the start edge; plot x grows in the reading direction.
  const x0 = rtl ? width - pad.axis : pad.axis;
  const xAt = (i: number) => (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const px = (i: number) => (rtl ? x0 - xAt(i) : x0 + xAt(i));
  const py = (v: number) => pad.top + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 72))));
  // The last tick only when it doesn't crowd the previous regular one.
  const step = n > 1 ? plotW / (n - 1) : plotW;
  const lastRegular = Math.floor((n - 1) / labelEvery) * labelEvery;
  const showTick = (i: number) => i % labelEvery === 0 || (i === n - 1 && (n - 1 - lastRegular) * step >= 72);
  // End labels: stacked apart by at least 12px so close series don't overprint.
  const endLabels = directLabels
    ? series
        .map((s) => ({ key: s.key, label: s.label.length > 16 ? `${s.label.slice(0, 15)}…` : s.label, y: py(s.values[n - 1] ?? 0) }))
        .sort((a, b) => a.y - b.y)
        .reduce<{ key: string; label: string; y: number }[]>((acc, l) => {
          const prev = acc[acc.length - 1];
          acc.push(prev && l.y - prev.y < 12 ? { ...l, y: prev.y + 12 } : l);
          return acc;
        }, [])
    : [];

  // SVG text-anchor start/end follow the text direction; pick them by the physical side the label grows towards,
  // so Arabic labels keep their own bidi order.
  const grow = (side: 'left' | 'right') => ((side === 'right') !== rtl ? 'start' : 'end');

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = rtl ? rect.right - e.clientX : e.clientX - rect.left;
    const i = Math.round((rel / rect.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === forward) setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    else if (e.key === back) setHover((h) => Math.max(0, (h ?? n) - 1));
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  };

  const paths = series.map((s) => ({
    ...s,
    d: s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' '),
  }));

  const toolbar = (
    <div className="flex items-center justify-between gap-2">
      <h3 id={titleId} className="text-sm font-semibold">
        {title}
      </h3>
      <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} data-testid="chart-table-toggle">
        {asTable ? <LineChart aria-hidden /> : <Table2 aria-hidden />}
        {asTable ? t('showChart') : t('showTable')}
      </Button>
    </div>
  );

  const legend =
    series.length > 1 ? (
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={t('legend')}>
        {series.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden />
            {s.label}
          </li>
        ))}
      </ul>
    ) : null;

  if (asTable) {
    return (
      <div className={cn('flex flex-col gap-3', className)}>
        {toolbar}
        <div className="max-h-80 overflow-auto rounded-md border border-border">
          <table className="w-full text-sm" aria-labelledby={titleId}>
            <thead className="sticky top-0 bg-surface-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t('period')}</th>
                {series.map((s) => (
                  <th key={s.key} className="px-3 py-2 text-end font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={p} className="border-t border-border">
                  <td className="px-3 py-1.5">{formatPoint(p)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="tabular px-3 py-1.5 text-end">
                      {formatValue(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const tipLeft = hover === null ? 0 : px(hover);
  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {toolbar}
      {legend}
      <div ref={ref} className="relative w-full min-w-0 overflow-hidden" data-testid="trend-chart">
        <svg
          width={width}
          height={height}
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          className="block overflow-visible rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={rtl ? x0 - plotW : x0}
                x2={rtl ? x0 : x0 + plotW}
                y1={py(v)}
                y2={py(v)}
                stroke={v === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}
                strokeWidth={1}
              />
              <text
                x={rtl ? x0 + 8 : x0 - 8}
                y={py(v)}
                dy="0.32em"
                textAnchor={grow(rtl ? 'right' : 'left')}
                className="tabular fill-subtle-foreground text-[0.6875rem]"
              >
                {formatValue(v)}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            showTick(i) ? (
              <text key={p} x={px(i)} y={height - 8} textAnchor="middle" className="fill-subtle-foreground text-[0.6875rem]">
                {formatPoint(p)}
              </text>
            ) : null,
          )}
          {paths.map((s) => (
            <path key={s.key} d={s.d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {endLabels.map((l) => (
            <text
              key={l.key}
              x={px(n - 1) + (rtl ? -8 : 8)}
              y={l.y}
              dy="0.32em"
              textAnchor={grow(rtl ? 'left' : 'right')}
              className="fill-muted-foreground text-[0.6875rem] font-medium"
            >
              {l.label}
            </text>
          ))}
          {hover !== null ? (
            <g aria-hidden>
              <line x1={px(hover)} x2={px(hover)} y1={pad.top} y2={pad.top + plotH} stroke="var(--chart-axis)" strokeWidth={1} />
              {series.map((s) => (
                <circle
                  key={s.key}
                  cx={px(hover)}
                  cy={py(s.values[hover] ?? 0)}
                  r={4}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ))}
            </g>
          ) : null}
          {/* Hit area larger than the marks. */}
          <rect
            x={rtl ? x0 - plotW - 8 : x0 - 8}
            y={pad.top}
            width={plotW + 16}
            height={plotH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 min-w-36 -translate-x-1/2 rounded-md border border-border bg-surface-raised p-2 text-xs shadow-md"
            style={{ left: Math.min(Math.max(tipLeft, 80), width - 80) }}
          >
            <p className="mb-1 font-medium">{formatPoint(points[hover]!)}</p>
            <ul className="flex flex-col gap-0.5">
              {series.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
                    {s.label}
                  </span>
                  <span className="tabular font-medium">{formatValue(s.values[hover] ?? 0)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Horizontal bars, one per entity (channel) for a single measure; value labels in ink at the bar end. */
export function BreakdownBars({
  title,
  rows,
  formatValue,
  className,
}: {
  title: string;
  rows: { key: string; label: string; color: string; value: number; hint?: string }[];
  formatValue: (v: number) => string;
  className?: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  const [hover, setHover] = useState<string | null>(null);
  return (
    <figure className={cn('flex flex-col gap-3', className)}>
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      <ul className="flex flex-col gap-3" data-testid="breakdown-bars">
        {rows.map((r) => (
          <li
            key={r.key}
            className="flex flex-col gap-1 text-sm"
            onPointerEnter={() => setHover(r.key)}
            onPointerLeave={() => setHover(null)}
            title={r.hint ?? formatValue(r.value)}
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="truncate text-muted-foreground">{r.label}</span>
              <span className="tabular shrink-0 font-medium">{formatValue(r.value)}</span>
            </span>
            <span className="relative h-2.5 w-full">
              <span
                className={cn('absolute inset-y-0 start-0 rounded-e-[4px] transition-opacity', hover && hover !== r.key && 'opacity-40')}
                style={{ width: `${max > 0 ? Math.max(1, (r.value / max) * 100) : 0}%`, background: r.color }}
              />
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/**
 * Progress towards a target with a tick for "where we should be by now" (the elapsed share of the flight).
 * `value` and `expected` are 0–1 shares of the target.
 */
export function PacingMeter({
  value,
  expected,
  tone,
  label,
}: {
  value: number;
  expected: number | null;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  label: string;
}) {
  const bar = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', neutral: 'bg-border-strong' }[tone];
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div
      className="relative h-2 w-full rounded-full bg-surface-muted"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <div className={cn('h-full rounded-full', bar)} style={{ width: `${pct}%` }} />
      {expected !== null ? (
        <span
          aria-hidden
          className="absolute -top-1 h-4 w-0.5 rounded-full bg-foreground/60"
          style={{ insetInlineStart: `calc(${Math.max(0, Math.min(100, expected * 100))}% - 1px)` }}
        />
      ) : null}
    </div>
  );
}
