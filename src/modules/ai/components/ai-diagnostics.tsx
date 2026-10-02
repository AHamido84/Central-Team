'use client';

import { CircleCheck, CircleDashed, CircleX, PlayCircle, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { cn } from '@/lib/utils/cn';
import { testAssistantAction } from '@/modules/ai/server/actions';
import type { DiagnosticStep } from '@/modules/ai/server/diagnostics';

const icon = {
  pass: { Icon: CircleCheck, className: 'text-success' },
  warn: { Icon: TriangleAlert, className: 'text-warning' },
  fail: { Icon: CircleX, className: 'text-danger' },
  skip: { Icon: CircleDashed, className: 'text-subtle-foreground' },
} as const;

/** "Test assistant" (FR3.5): runs the whole chain once and lists every step with pass / fail and the reason. */
export function AiDiagnostics({ disabled }: { disabled: boolean }) {
  const t = useTranslations('ai.admin.test');
  const te = useTranslations('errors');
  const f = useFormat();
  const run = useAction(testAssistantAction, { refresh: true });
  const [result, setResult] = useState<{ steps: DiagnosticStep[]; at: string } | null>(null);

  const noteText = (s: DiagnosticStep) => {
    // Names and ids are isolated (gotcha 5); numbers stay numbers (plurals) and `retrieval` stays raw (select).
    const v = Object.fromEntries(
      Object.entries(s.values ?? {}).map(([k, x]) => [k, typeof x === 'number' || k === 'retrieval' ? x : `\u2068${x}\u2069`]),
    );
    return s.note ? t(`note.${s.note}` as 'note.switchOn', v as never) : null;
  };

  return (
    <Card className="flex flex-col gap-3 p-5 lg:col-span-2" data-testid="ai-diagnostics">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <PlayCircle className="size-4 text-primary" aria-hidden />
            {t('title')}
          </h2>
          <p className="mt-0.5 text-xs text-subtle-foreground">{t('hint')}</p>
        </div>
        <Button
          variant="outline"
          loading={run.pending}
          disabled={disabled}
          onClick={async () => {
            const r = await run.run({});
            if (r.ok) setResult(r.data);
          }}
          data-testid="ai-test-assistant"
        >
          {t('run')}
        </Button>
      </div>
      {run.pending ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t('running')}
        </p>
      ) : null}
      {result ? (
        <ol className="flex flex-col divide-y divide-border rounded-md border border-border" aria-live="polite" data-testid="ai-test-steps">
          {result.steps.map((s, i) => {
            const { Icon, className } = icon[s.status];
            const note = noteText(s);
            return (
              <li key={s.key} className="flex gap-3 px-3 py-2.5" data-testid="ai-test-step" data-step={s.key} data-status={s.status}>
                <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-hidden />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-medium">
                    <span>
                      {t('stepLabel', { n: f.number(i + 1), label: t(`step.${s.key}`) })}
                      <span className="sr-only"> — {t(`status.${s.status}`)}</span>
                    </span>
                    {s.ms !== undefined ? (
                      <span className="text-xs font-normal text-subtle-foreground tabular-nums">{t('ms', { ms: f.number(s.ms) })}</span>
                    ) : null}
                  </p>
                  {s.code ? <p className="text-sm text-danger">{te(s.code)}</p> : null}
                  {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
                  {s.detail ? (
                    <p className="text-xs break-words text-subtle-foreground" dir="auto">
                      {s.detail}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      {result ? <p className="text-xs text-subtle-foreground">{t('ranAt', { at: f.dateTime(result.at) })}</p> : null}
    </Card>
  );
}
