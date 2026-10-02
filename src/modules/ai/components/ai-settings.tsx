'use client';

import { Database, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Badge, Card, NativeSelect, Progress, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { sensitivities, type Sensitivity } from '@/modules/ai/insights-core';
import { rebuildIndexAction, saveAiSettingsAction } from '@/modules/ai/server/actions';
import { AiDiagnostics } from '@/modules/ai/components/ai-diagnostics';
import type { IndexHealth } from '@/modules/ai/server/indexer';
import type { AiAdminView } from '@/modules/ai/server/queries';
import { sourceTypes } from '@/modules/ai/types';

const purposes = ['assistant', 'report_draft', 'insight_explain', 'embedding'] as const;

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
  testId,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p className="mt-0.5 text-xs text-subtle-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </div>
  );
}

export function AiSettings({ view, index }: { view: AiAdminView; index: IndexHealth }) {
  const t = useTranslations('ai.admin');
  const ta = useTranslations('ai.assistant');
  const f = useFormat();
  const [form, setForm] = useState(view.settings);
  const dirty = JSON.stringify(form) !== JSON.stringify(view.settings);
  const save = useAction(saveAiSettingsAction, { successMessage: t('saved') });
  const rebuild = useAction(rebuildIndexAction);
  const [rebuilt, setRebuilt] = useState<number | null>(null);
  const used = view.usage.total;
  const budget = form.monthlyTokenBudget;
  const share = budget > 0 ? Math.min(100, (used / budget) * 100) : 100;
  const indexed = index.chunks;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="flex flex-col gap-5 p-5 lg:col-span-2">
        <h2 className="text-sm font-semibold">{t('general')}</h2>
        <SwitchRow
          id="ai-enabled"
          label={t('enabled')}
          hint={t('enabledHint')}
          checked={form.enabled}
          onChange={(v) => setForm({ ...form, enabled: v })}
          testId="ai-enabled"
        />
        <Field label={t('sensitivity')} hint={t('sensitivityHint')}>
          {(p) => (
            <NativeSelect
              {...p}
              value={form.sensitivity}
              onChange={(e) => setForm({ ...form, sensitivity: e.target.value as Sensitivity })}
              data-testid="ai-sensitivity"
            >
              {sensitivities.map((s) => (
                <option key={s} value={s}>
                  {t(`sensitivityOption.${s}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <SwitchRow
          id="ai-autodraft"
          label={t('autoDraft')}
          hint={t('autoDraftHint')}
          checked={form.autoDraftReports}
          onChange={(v) => setForm({ ...form, autoDraftReports: v })}
          testId="ai-autodraft"
        />
        <Field label={t('budget')} hint={t('budgetHint')}>
          {(p) => (
            <Input
              {...p}
              type="number"
              inputMode="numeric"
              min={0}
              step={100000}
              dir="ltr"
              value={form.monthlyTokenBudget}
              onChange={(e) => setForm({ ...form, monthlyTokenBudget: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              data-testid="ai-budget"
            />
          )}
        </Field>
        <div className="flex justify-end">
          <Button disabled={!dirty} loading={save.pending} onClick={() => save.run(form)} data-testid="ai-save">
            {t('save')}
          </Button>
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-2 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" aria-hidden />
            {t('provider')}
          </h2>
          <Badge
            tone={view.mode === 'live' ? 'success' : view.mode === 'mock' ? 'info' : 'warning'}
            className="w-fit"
            data-testid="ai-mode"
            data-mode={view.mode}
          >
            {t(`mode.${view.mode}`)}
          </Badge>
          <p className="text-sm text-muted-foreground">
            {view.mode === 'live' ? t('textBy', { model: `\u2068${view.model}\u2069` }) : t(`modeHint.${view.mode}`)}
          </p>
          {view.mode !== 'off' ? (
            <p className="text-sm text-muted-foreground" data-testid="ai-search-mode" data-search={view.embedder ? 'semantic' : 'keyword'}>
              {view.embedder ? t('search.semantic', { embedding: `\u2068${view.embedder}\u2069` }) : t('search.keyword')}
            </p>
          ) : null}
          <p className="text-xs text-subtle-foreground">{t('indexHealth.voyageOptional')}</p>
          {view.missing.length ? (
            <p className="text-xs text-subtle-foreground">
              {t('missing')}
              <bdi dir="ltr" className="font-mono">
                {view.missing.join(', ')}
              </bdi>
            </p>
          ) : null}
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-sm font-semibold">{t('usage')}</h2>
          <Progress value={share} tone={share >= 90 ? 'danger' : share >= 70 ? 'warning' : 'brand'} aria-label={t('usage')} />
          <p className="text-sm tabular-nums" data-testid="ai-usage">
            {t('usageOf', { used: f.number(used), budget: f.number(budget) })}
          </p>
          {used === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noUsage')}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {purposes.map((p) =>
                view.usage.byPurpose[p] ? (
                  <li key={p} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{t(`purpose.${p}`)}</span>
                    <span className="tabular-nums">{f.number(view.usage.byPurpose[p]!)}</span>
                  </li>
                ) : null,
              )}
            </ul>
          )}
        </Card>
      </div>

      <Card className="flex flex-col gap-3 p-5 lg:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Database className="size-4 text-primary" aria-hidden />
              {t('index')}
            </h2>
            <p className="mt-0.5 text-xs text-subtle-foreground">{t('indexHint')}</p>
          </div>
          <Button
            variant="outline"
            loading={rebuild.pending}
            disabled={!view.settings.enabled || view.mode === 'off' || !index.model}
            onClick={async () => {
              const r = await rebuild.run({});
              if (r.ok) setRebuilt(r.data.indexed);
            }}
            data-testid="ai-rebuild"
          >
            <RefreshCw aria-hidden />
            {t('rebuild')}
          </Button>
        </div>
        {index.model ? (
          <>
            <p className="text-sm" data-testid="ai-index-status">
              {t('indexed', { count: indexed })} · {t('stale', { count: index.stale })}
              {rebuilt !== null ? <span className="text-success"> · {t('rebuilt', { count: rebuilt })}</span> : null}
            </p>
            <Progress
              value={index.progress}
              tone={index.progress >= 100 ? 'brand' : 'warning'}
              aria-label={t('indexHealth.progress', { progress: index.progress })}
            />
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle-foreground" data-testid="ai-index-health">
              <dd>{t('indexHealth.model', { model: `\u2068${index.model}\u2069` })}</dd>
              <dd>{index.lastBuiltAt ? t('indexHealth.lastBuilt', { at: f.dateTime(index.lastBuiltAt) }) : t('indexHealth.neverBuilt')}</dd>
              <dd className="tabular-nums">{t('indexHealth.progress', { progress: f.number(index.progress) })}</dd>
              {index.otherModel > 0 ? <dd>{t('indexHealth.otherModel', { count: index.otherModel })}</dd> : null}
            </dl>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {sourceTypes.map((s) => (
                <li key={s} className="rounded-md border border-border px-3 py-2">
                  <p className="text-xs text-subtle-foreground">{ta(`sourceType.${s}`)}</p>
                  <p className="text-lg font-semibold tabular-nums">{f.number(index.byType[s] ?? 0)}</p>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="ai-index-status" data-index="unused">
            {t('indexHealth.unused')}
          </p>
        )}
      </Card>

      <AiDiagnostics disabled={!view.settings.enabled} />

      <Card className="flex h-fit flex-col gap-2 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-success" aria-hidden />
          {t('dataTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('dataBody')}</p>
      </Card>
    </div>
  );
}
