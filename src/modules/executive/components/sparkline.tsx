import { cn } from '@/lib/utils/cn';

/**
 * A 12-point trend in a tile: one thin line, the last point marked, gaps where a month has no value. Time runs in the
 * reading direction (mirrored in Arabic), like the campaign charts.
 */
export function Sparkline({
  values,
  label,
  tone = 'flat',
  className,
}: {
  values: (number | null)[];
  label: string;
  tone?: 'good' | 'bad' | 'flat';
  className?: string;
}) {
  const w = 120;
  const h = 32;
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return <div className={cn('h-8', className)} aria-hidden />;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min || 1;
  const x = (i: number) => (values.length <= 1 ? w / 2 : (i / (values.length - 1)) * (w - 4) + 2);
  const y = (v: number) => h - 3 - ((v - min) / span) * (h - 6);
  const segments: string[] = [];
  let current = '';
  values.forEach((v, i) => {
    if (v === null) {
      if (current) segments.push(current);
      current = '';
      return;
    }
    current += `${current ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (current) segments.push(current);
  const lastIndex = values.findLastIndex((v) => v !== null);
  const color = tone === 'good' ? 'var(--color-success)' : tone === 'bad' ? 'var(--color-danger)' : 'var(--chart-1)';
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn('h-8 w-full rtl:-scale-x-100', className)}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      {segments.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <circle cx={x(lastIndex)} cy={y(values[lastIndex]!)} r={2.5} fill={color} />
    </svg>
  );
}
