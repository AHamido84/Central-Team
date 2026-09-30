'use client';

import { ArrowDown, ArrowUp, Plus, Printer, Send, Trash2, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Badge, Card, Checkbox, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { AiDraftButton } from '@/modules/ai/components/ai-draft-button';
import { ReportView } from '@/modules/campaigns/components/report-view';
import { metricKeys, reportSectionKinds, type MetricKey, type ReportSectionKind } from '@/modules/campaigns/constants';
import { sectionHasBody } from '@/modules/campaigns/periods';
import type { ReportSectionConfig } from '@/modules/campaigns/report-types';
import { deleteReportAction, publishReportAction, saveReportAction, unpublishReportAction } from '@/modules/campaigns/server/actions';
import type { ReportDetail } from '@/modules/campaigns/server/queries';

type Draft = { key: string; kind: ReportSectionKind; config: ReportSectionConfig; body: string };

const withMetrics: readonly ReportSectionKind[] = ['kpi_summary', 'trend', 'channel_breakdown'];

export function ReportBuilder({
  report,
  canManage,
  aiDraft = false,
}: {
  report: ReportDetail;
  canManage: boolean;
  /** Phase 8: "Draft with AI" on commentary / next-steps sections (ADR-077). */
  aiDraft?: boolean;
}) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const tm = useTranslations('campaigns');
  const f = useFormat();
  const router = useRouter();
  const published = report.status === 'published';
  const editable = canManage && !published;
  const fromReport = () => ({
    title: report.title,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    locale: report.locale,
    sections: report.sections.map((s) => ({ key: s.id, kind: s.kind, config: s.config, body: s.body })) as Draft[],
  });
  const [draft, setDraft] = useState(fromReport);
  const [dirty, setDirty] = useState(false);
  const update = (patch: Partial<ReturnType<typeof fromReport>>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const setSection = (i: number, patch: Partial<Draft>) =>
    update({ sections: draft.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, by: number) => {
    const next = [...draft.sections];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item!);
    update({ sections: next });
  };

  const save = useAction(saveReportAction, { successMessage: t('builder.saved'), onSuccess: () => setDirty(false) });
  const publish = useAction(publishReportAction, { successMessage: t('builder.published') });
  const unpublish = useAction(unpublishReportAction, { successMessage: t('builder.unpublished') });
  const remove = useAction(deleteReportAction, {
    successMessage: t('builder.deleted'),
    refresh: false,
    onSuccess: () => router.push('/reports'),
  });

  const onSave = () =>
    save.run({
      reportId: report.id,
      title: draft.title,
      periodStart: draft.periodStart,
      periodEnd: draft.periodEnd,
      locale: draft.locale,
      sections: draft.sections.map((s) => ({ kind: s.kind, config: s.config, body: s.body })),
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Badge tone={published ? 'success' : 'warning'} dot data-testid="report-status" data-status={report.status}>
          {t(`status.${report.status}`)}
        </Badge>
        {report.scheduled ? <Badge tone="outline">{t('scheduled')}</Badge> : null}
        <span className="text-sm text-subtle-foreground">
          {published && report.publishedAt ? t('builder.frozen', { date: f.date(report.publishedAt) }) : t('builder.live')}
        </span>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => window.print()} data-testid="report-print">
            <Printer aria-hidden />
            {t('builder.print')}
          </Button>
          {editable ? (
            <>
              <Button variant="outline" onClick={onSave} loading={save.pending} disabled={!dirty} data-testid="report-save">
                {t('builder.save')}
              </Button>
              <ConfirmDialog
                trigger={
                  <Button disabled={dirty} title={dirty ? t('builder.saveFirst') : undefined} data-testid="report-publish">
                    <Send aria-hidden />
                    {t('builder.publish')}
                  </Button>
                }
                title={t('builder.publishTitle')}
                description={t('builder.publishBody')}
                confirmLabel={t('builder.publish')}
                cancelLabel={tc('cancel')}
                onConfirm={() => publish.run({ reportId: report.id })}
              />
            </>
          ) : null}
          {canManage && published ? (
            <ConfirmDialog
              trigger={
                <Button variant="outline" data-testid="report-unpublish">
                  <Undo2 aria-hidden />
                  {t('builder.unpublish')}
                </Button>
              }
              title={t('builder.unpublishTitle')}
              description={t('builder.unpublishBody')}
              confirmLabel={t('builder.unpublish')}
              cancelLabel={tc('cancel')}
              onConfirm={() => unpublish.run({ reportId: report.id })}
            />
          ) : null}
          {editable ? (
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="icon" aria-label={t('builder.delete')}>
                  <Trash2 aria-hidden />
                </Button>
              }
              title={t('builder.deleteTitle')}
              description={t('builder.deleteBody')}
              confirmLabel={tc('delete')}
              cancelLabel={tc('cancel')}
              destructive
              onConfirm={() => remove.run({ reportId: report.id })}
            />
          ) : null}
        </div>
      </div>

      <div className={editable ? 'grid gap-4 xl:grid-cols-[24rem_1fr]' : ''}>
        {editable ? (
          <Card className="flex h-fit flex-col gap-4 p-4 print:hidden" data-testid="report-editor">
            <Field label={t('create.reportTitle')} required>
              {(p) => <Input {...p} value={draft.title} maxLength={200} onChange={(e) => update({ title: e.target.value })} />}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('create.from')}>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={draft.periodStart}
                    max={draft.periodEnd}
                    onChange={(e) => update({ periodStart: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('create.to')}>
                {(p) => (
                  <Input
                    {...p}
                    type="date"
                    value={draft.periodEnd}
                    min={draft.periodStart}
                    onChange={(e) => update({ periodEnd: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <Field label={t('create.locale')}>
              {(p) => (
                <NativeSelect {...p} value={draft.locale} onChange={(e) => update({ locale: e.target.value as 'ar' | 'en' })}>
                  <option value="ar">{t('create.localeAr')}</option>
                  <option value="en">{t('create.localeEn')}</option>
                </NativeSelect>
              )}
            </Field>

            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">{t('builder.sections')}</h2>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="add-section">
                    <Plus aria-hidden />
                    {t('builder.addSection')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {reportSectionKinds.map((k) => (
                    <DropdownMenuItem
                      key={k}
                      onSelect={() =>
                        update({ sections: [...draft.sections, { key: crypto.randomUUID(), kind: k, config: {}, body: '' }] })
                      }
                    >
                      {t(`kind.${k}`)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <ol className="flex flex-col gap-3">
              {draft.sections.map((s, i) => (
                <li key={s.key} className="rounded-md border border-border p-3" data-testid="section-editor" data-kind={s.kind}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{t(`kind.${s.kind}`)}</span>
                    <span className="flex items-center">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('builder.moveUp')}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('builder.moveDown')}
                        disabled={i === draft.sections.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('builder.remove')}
                        disabled={draft.sections.length === 1}
                        onClick={() => update({ sections: draft.sections.filter((_, j) => j !== i) })}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </span>
                  </div>
                  {aiDraft && (s.kind === 'commentary' || s.kind === 'next_steps') ? (
                    <div className="mt-2 flex justify-end">
                      <AiDraftButton
                        reportId={report.id}
                        section={s.kind}
                        hasText={s.body.trim() !== ''}
                        disabled={
                          draft.periodStart !== report.periodStart || draft.periodEnd !== report.periodEnd || draft.locale !== report.locale
                        }
                        disabledReason={t('builder.saveFirst')}
                        onDraft={(text) => setSection(i, { body: text })}
                      />
                    </div>
                  ) : null}
                  {sectionHasBody(s.kind) ? (
                    <Textarea
                      className="mt-2"
                      rows={5}
                      maxLength={10000}
                      value={s.body}
                      dir={draft.locale === 'ar' ? 'rtl' : 'ltr'}
                      lang={draft.locale}
                      placeholder={t('builder.bodyPlaceholder')}
                      aria-label={t(`kind.${s.kind}`)}
                      onChange={(e) => setSection(i, { body: e.target.value })}
                      data-testid="section-body"
                    />
                  ) : null}
                  {withMetrics.includes(s.kind) ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">{t('builder.metrics')}</summary>
                      <div className="mt-2 grid grid-cols-2 gap-1.5">
                        {metricKeys.map((m) => {
                          const on = (s.config.metrics ?? []).includes(m);
                          return (
                            <label key={m} className="inline-flex items-center gap-2 text-xs">
                              <Checkbox
                                checked={on}
                                onCheckedChange={(v) => {
                                  const current = s.config.metrics ?? [];
                                  const next = v ? [...current, m].slice(0, 8) : current.filter((x) => x !== m);
                                  setSection(i, { config: { ...s.config, metrics: next as MetricKey[] } });
                                }}
                              />
                              {tm(`metric.${m}`)}
                            </label>
                          );
                        })}
                      </div>
                      {s.kind === 'trend' ? (
                        <NativeSelect
                          className="mt-2 w-auto"
                          aria-label={t('builder.grain')}
                          value={s.config.grain ?? 'day'}
                          onChange={(e) => setSection(i, { config: { ...s.config, grain: e.target.value as 'day' | 'week' } })}
                        >
                          <option value="day">{tm('chart.day')}</option>
                          <option value="week">{tm('chart.week')}</option>
                        </NativeSelect>
                      ) : null}
                    </details>
                  ) : null}
                </li>
              ))}
            </ol>
            {dirty ? <p className="text-xs text-warning">{t('builder.unsaved')}</p> : null}
          </Card>
        ) : null}
        <ReportView report={editable ? { ...report, title: draft.title, sections: report.sections } : report} />
      </div>
    </div>
  );
}
