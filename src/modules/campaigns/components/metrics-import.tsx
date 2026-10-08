'use client';

import { CalendarRange, FileUp, TriangleAlert, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type DragEvent, type ReactNode } from 'react';
import { toast } from 'sonner';

import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/overlays';
import { NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { cn } from '@/lib/utils/cn';
import { useMetricFormat } from '@/modules/campaigns/components/format';
import { baseMetrics, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from '@/modules/campaigns/constants';
import { parseMetricsCsv, type ColumnMapping, type CsvParseResult, type DateOrder } from '@/modules/campaigns/csv';
import { importMetricsAction } from '@/modules/campaigns/server/actions';
import type { ChannelItem } from '@/modules/campaigns/server/queries';

type Loaded = { name: string; text: string; result: CsvParseResult };

export function MetricsImportDialog({
  trigger,
  campaignId,
  channels,
  currency,
  startDate,
  endDate,
  canExtend,
  onImported,
}: {
  trigger: ReactNode;
  campaignId: string;
  channels: ChannelItem[];
  currency: string;
  /** The campaign's dates: days outside them are extended into or left out (FR6.2). */
  startDate: string;
  endDate: string;
  /** `campaigns:manage` — moving the campaign dates edits the campaign. */
  canExtend: boolean;
  /** The grid jumps to the imported week (FR6.3). */
  onImported?: (lastDate: string, channelId: string) => void;
}) {
  const t = useTranslations('campaigns');
  const tc = useTranslations('common');
  const f = useFormat();
  const { value } = useMetricFormat(currency);
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '');
  const [dragging, setDragging] = useState(false);
  const [outsideChoice, setOutsideChoice] = useState<'extend' | 'skip'>(canExtend ? 'extend' : 'skip');
  const day = (iso: string) => f.date(`${iso}T12:00:00Z`);
  const run = useAction(importMetricsAction, {
    onSuccess: (data) => {
      toast.success(t('import.done', { rows: data.rows }), {
        description: data.extended
          ? t('import.doneExtended', { from: day(data.extended.startDate), to: day(data.extended.endDate) })
          : data.skipped
            ? t('import.doneSkipped', { count: data.skipped })
            : undefined,
      });
      setOpen(false);
      setLoaded(null);
      onImported?.(data.dateTo, channelId);
    },
  });

  const read = async (file: File) => {
    if (file.size > IMPORT_MAX_BYTES) {
      toast.error(t('import.tooLarge'));
      return;
    }
    try {
      const text = await file.text();
      const result = parseMetricsCsv(text);
      setLoaded({ name: file.name, text, result });
      // Pick the channel whose platform matches the detected export, when there is one.
      const match = channels.find((c) =>
        result.preset === 'meta' ? ['meta', 'instagram', 'facebook'].includes(c.platform) : c.platform === result.preset,
      );
      if (match) setChannelId(match.id);
    } catch {
      toast.error(t('import.unreadable'));
    }
  };

  const reparse = (override: { mapping?: ColumnMapping; dateOrder?: DateOrder }) => {
    if (!loaded) return;
    const result = parseMetricsCsv(loaded.text, {
      mapping: override.mapping ?? loaded.result.mapping,
      dateOrder: override.dateOrder ?? loaded.result.dateOrder,
    });
    setLoaded({ ...loaded, result: { ...result, preset: loaded.result.preset } });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void read(file);
  };

  const r = loaded?.result;
  const rows = r?.rows ?? [];
  const outside = rows.filter((row) => row.date < startDate || row.date > endDate);
  const extendTo =
    rows.length > 0
      ? {
          from: rows[0]!.date < startDate ? rows[0]!.date : startDate,
          to: rows[rows.length - 1]!.date > endDate ? rows[rows.length - 1]!.date : endDate,
        }
      : null;
  const choice = canExtend ? outsideChoice : 'skip';
  const importable = outside.length && choice === 'skip' ? rows.length - outside.length : rows.length;
  const totals = rows.reduce(
    (acc, row) => {
      for (const m of baseMetrics) acc[m] += row[m];
      return acc;
    },
    Object.fromEntries(baseMetrics.map((m) => [m, 0])) as Record<(typeof baseMetrics)[number], number>,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setLoaded(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="lg" closeLabel={tc('close')} data-testid="import-dialog">
        <DialogHeader>
          <DialogTitle>{t('import.title')}</DialogTitle>
          <DialogDescription>{t('import.description')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {!loaded ? (
            <label
              htmlFor={inputId}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-center transition-colors hover:bg-surface-muted',
                dragging && 'border-primary bg-primary-soft/40',
              )}
            >
              <FileUp className="size-8 text-subtle-foreground" aria-hidden />
              <span className="font-medium text-link">{t('import.choose')}</span>
              <span className="text-sm text-muted-foreground">{t('import.drop')}</span>
              <input
                id={inputId}
                type="file"
                accept=".csv,text/csv,text/plain,.tsv"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void read(file);
                  e.target.value = '';
                }}
                data-testid="import-file"
              />
            </label>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-muted px-3 py-2 text-sm">
                <span className="truncate font-medium" dir="auto">
                  {loaded.name}
                </span>
                <span className="text-muted-foreground" data-testid="import-preset" data-preset={r!.preset}>
                  {t('import.detected', { preset: t(`import.presets.${r!.preset}`) })}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('import.channel')} required>
                  {(p) => (
                    <NativeSelect {...p} value={channelId} onChange={(e) => setChannelId(e.target.value)} data-testid="import-channel">
                      {channels.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || t(`platform.${c.platform}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field label={t('import.dateOrder')}>
                  {(p) => (
                    <NativeSelect {...p} value={r!.dateOrder} onChange={(e) => reparse({ dateOrder: e.target.value as DateOrder })}>
                      {(['ymd', 'dmy', 'mdy'] as const).map((o) => (
                        <option key={o} value={o}>
                          {t(`import.dateOrders.${o}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
              </div>

              <details className="rounded-md border border-border" open={r!.mapping.date === undefined}>
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t('import.mapping')}</summary>
                <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
                  <p className="text-xs text-subtle-foreground sm:col-span-2">{t('import.mappingHint')}</p>
                  {(['date', ...baseMetrics] as const).map((key) => (
                    <Field key={key} label={key === 'date' ? t('import.dateColumn') : t(`metric.${key}`)}>
                      {(p) => (
                        <NativeSelect
                          {...p}
                          value={r!.mapping[key] ?? ''}
                          onChange={(e) => {
                            const next = { ...r!.mapping };
                            if (e.target.value === '') delete next[key];
                            else next[key] = Number(e.target.value);
                            reparse({ mapping: next });
                          }}
                          data-testid={`map-${key}`}
                        >
                          <option value="">{t('import.notMapped')}</option>
                          {r!.headers.map((h, i) => (
                            <option key={`${h}-${i}`} value={i}>
                              {h || `#${i + 1}`}
                            </option>
                          ))}
                        </NativeSelect>
                      )}
                    </Field>
                  ))}
                </div>
              </details>

              {r!.period ? (
                <section
                  role="alert"
                  className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning-soft/40 p-4 text-sm"
                  data-testid="import-period"
                >
                  <p className="flex items-start gap-2 font-medium">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                    {t('import.periodTitle', { from: day(r!.period.from), to: day(r!.period.to) })}
                  </p>
                  <p className="text-muted-foreground">{t('import.periodBody')}</p>
                  <div>
                    <p className="mb-1 text-xs font-medium">{t('import.periodTotals', { rows: r!.period.rows })}</p>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                      {baseMetrics
                        .filter((m) => r!.mapping[m] !== undefined)
                        .map((m) => (
                          <div key={m} className="flex justify-between gap-2">
                            <dt className="text-muted-foreground">{t(`metric.${m}`)}</dt>
                            <dd className="tabular font-medium">{value(m, r!.period!.totals[m], { compact: true })}</dd>
                          </div>
                        ))}
                    </dl>
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium">{t('import.periodHowTitle')}</p>
                    <p className="text-xs" data-testid="import-period-how">
                      {t(`import.periodHow.${r!.preset}`)}
                    </p>
                  </div>
                </section>
              ) : r!.mapping.date === undefined ? (
                <p role="alert" className="text-sm font-medium text-danger">
                  {t('import.noDate')}
                </p>
              ) : (
                <section className="flex flex-col gap-2" aria-label={t('import.preview')} data-testid="import-preview">
                  <p className="text-sm font-medium" data-testid="import-summary">
                    {rows.length
                      ? t('import.summary', {
                          rows: rows.length,
                          from: f.date(`${rows[0]!.date}T12:00:00Z`),
                          to: f.date(`${rows[rows.length - 1]!.date}T12:00:00Z`),
                        })
                      : t('import.summary', { rows: 0, from: '—', to: '—' })}
                  </p>
                  {r!.skipped ? <p className="text-xs text-subtle-foreground">{t('import.skipped', { count: r!.skipped })}</p> : null}
                  {r!.errors.some((e) => e.code === 'invalid_number') ? (
                    <p className="text-xs text-warning">
                      {t('import.errors', { count: r!.errors.filter((e) => e.code === 'invalid_number').length })}
                    </p>
                  ) : null}
                  {r!.errors.some((e) => e.code === 'too_many_rows') ? (
                    <p className="text-xs text-warning">{t('import.tooMany', { max: IMPORT_MAX_ROWS })}</p>
                  ) : null}
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-surface-muted text-muted-foreground">
                        <tr>
                          {baseMetrics
                            .filter((m) => r!.mapping[m] !== undefined)
                            .map((m) => (
                              <th key={m} className="px-2 py-1.5 text-end font-medium whitespace-nowrap">
                                {t(`metric.${m}`)}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {baseMetrics
                            .filter((m) => r!.mapping[m] !== undefined)
                            .map((m) => (
                              <td key={m} className="tabular px-2 py-1.5 text-end font-medium whitespace-nowrap">
                                {value(m, totals[m], { compact: true })}
                              </td>
                            ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {outside.length && extendTo ? (
                    <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="import-outside">
                      <legend className="flex items-center gap-2 px-1 text-sm font-medium">
                        <CalendarRange className="size-4 text-subtle-foreground" aria-hidden />
                        {t('import.outsideTitle', { count: outside.length, start: day(startDate), end: day(endDate) })}
                      </legend>
                      {canExtend ? (
                        (['extend', 'skip'] as const).map((o) => (
                          <label key={o} className="flex cursor-pointer items-start gap-2 text-sm">
                            <input
                              type="radio"
                              name="importOutside"
                              value={o}
                              checked={outsideChoice === o}
                              onChange={() => setOutsideChoice(o)}
                              className="mt-1 accent-[var(--primary)]"
                              data-testid={`import-outside-${o}`}
                            />
                            <span>
                              <span className="block">
                                {o === 'extend'
                                  ? t('import.outsideExtend', { from: day(extendTo.from), to: day(extendTo.to) })
                                  : t('import.outsideSkip')}
                              </span>
                              {o === 'extend' ? (
                                <span className="block text-xs text-subtle-foreground">{t('import.outsideExtendHint')}</span>
                              ) : null}
                            </span>
                          </label>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">{t('import.outsideNoRight')}</p>
                      )}
                    </fieldset>
                  ) : null}
                  <p className="text-xs text-subtle-foreground">{t('import.replaceNote')}</p>
                </section>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {loaded ? (
            <Button variant="outline" onClick={() => setLoaded(null)}>
              {t('import.back')}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
          )}
          <Button
            disabled={!loaded || importable === 0 || !channelId || r?.mapping.date === undefined || Boolean(r?.period)}
            loading={run.pending}
            onClick={() =>
              loaded &&
              run.run({
                campaignId,
                channelId,
                fileName: loaded.name.slice(0, 255) || 'import.csv',
                preset: loaded.result.preset,
                rows: rows.map(({ date, ...m }) => ({ date, ...m })),
                outside: choice,
              })
            }
            data-testid="import-confirm"
          >
            <Upload aria-hidden />
            {t('import.confirm', { rows: importable })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
