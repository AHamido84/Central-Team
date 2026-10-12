'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, Label, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { kpis } from '@/modules/executive/catalog';
import { saveTargetsAction } from '@/modules/executive/server/actions';
import { useExecKit } from '@/modules/executive/components/use-kit';
import { targetMetrics, type TargetMetric } from '@/modules/executive/types';

type Row = { metric: string; quarter: number | null; value: number };
const periods = [null, 1, 2, 3, 4] as const;

/** KPI units ↔ what people type: percentages 0–100, money in SAR, ROAS and counts as they are. */
const unitOf = (m: TargetMetric): string => kpis[m].unit;
const toInput = (m: TargetMetric, v: number) => (unitOf(m) === 'percent' ? v * 100 : unitOf(m) === 'currency' ? v / 100 : v);
const fromInput = (m: TargetMetric, v: number) => (unitOf(m) === 'percent' ? v / 100 : unitOf(m) === 'currency' ? Math.round(v * 100) : v);

export function TargetsForm({ year, years, rows }: { year: number; years: number[]; rows: Row[] }) {
  const kit = useExecKit();
  const { t } = kit;
  const router = useRouter();
  const key = (m: string, q: number | null) => `${m}:${q ?? 0}`;
  const initial = Object.fromEntries(
    rows.map((r) => [key(r.metric, r.quarter), String(Math.round(toInput(r.metric as TargetMetric, r.value) * 100) / 100)]),
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const { run, pending } = useAction(saveTargetsAction, { successMessage: t('targets.saved') });

  const save = async () => {
    const bad = new Set<string>();
    const out: { metric: TargetMetric; quarter: number | null; value: number | null }[] = [];
    for (const m of targetMetrics) {
      for (const q of periods) {
        const raw = (values[key(m, q)] ?? '').trim();
        if (!raw) continue;
        const n = Number(raw.replace(',', '.'));
        if (!Number.isFinite(n) || n < 0) bad.add(key(m, q));
        else out.push({ metric: m, quarter: q, value: fromInput(m, n) });
      }
    }
    setInvalid(bad);
    if (bad.size) return;
    await run({ year, rows: out });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-36 flex-col gap-1.5">
          <Label htmlFor="targets-year">{t('targets.year')}</Label>
          <NativeSelect
            id="targets-year"
            value={year}
            onChange={(e) => router.push(`/executive/targets?year=${e.target.value}`)}
            data-testid="targets-year"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {kit.f.number(y, { useGrouping: false })}
              </option>
            ))}
          </NativeSelect>
        </div>
        <p className="max-w-2xl text-xs text-subtle-foreground">{t('targets.hint')}</p>
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[44rem] text-sm" data-testid="targets-table">
          <thead>
            <tr className="border-b border-border text-xs text-subtle-foreground">
              <th scope="col" className="px-4 py-3 text-start font-medium">
                {t('targets.metric')}
              </th>
              {periods.map((q) => (
                <th key={q ?? 0} scope="col" className="px-2 py-3 text-start font-medium">
                  {q === null ? t('targets.fullYear') : t('targets.quarter', { q })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {targetMetrics.map((m) => (
              <tr key={m} className="border-b border-border/60 last:border-0">
                <th scope="row" className="px-4 py-2 text-start font-medium">
                  {t(`kpi.${m}.name`)}
                </th>
                {periods.map((q) => {
                  const k = key(m, q);
                  const label = `${t(`kpi.${m}.name`)} — ${q === null ? t('targets.fullYear') : t('targets.quarter', { q })}`;
                  return (
                    <td key={k} className="px-2 py-2">
                      <Input
                        inputMode="decimal"
                        dir="ltr"
                        className="w-28 text-end"
                        value={values[k] ?? ''}
                        aria-label={label}
                        aria-invalid={invalid.has(k) || undefined}
                        title={invalid.has(k) ? t('targets.invalid') : undefined}
                        onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                        data-testid={`target-${m}-${q ?? 0}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {invalid.size ? (
        <p className="text-sm text-danger" role="alert">
          {t('targets.invalid')}
        </p>
      ) : null}
      <Button onClick={save} disabled={pending} data-testid="targets-save">
        {t('targets.save')}
      </Button>
    </div>
  );
}
