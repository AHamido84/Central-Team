'use client';

import { Check, Eye } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { useFormat } from '@/components/providers';
import { localized, type Locale } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import type { ProgressStep } from '@/modules/workflows/server/queries';

/** Which workflow step is active — step names and states only (the portal never sees internal tasks). */
export function RequestProgress({ steps }: { steps: ProgressStep[] }) {
  const t = useTranslations('workflows.progress');
  const locale = useLocale() as Locale;
  const f = useFormat();
  if (!steps.length) return null;
  const done = steps.filter((s) => s.state === 'done').length;
  return (
    <div className="grid gap-3" data-testid="request-progress">
      <p className="text-sm text-muted-foreground">{t('summary', { done, total: steps.length })}</p>
      <ol className="grid gap-0">
        {steps.map((s, i) => (
          <li key={s.order} className="relative flex gap-3 pb-4 last:pb-0" data-testid="progress-step" data-state={s.state}>
            {i < steps.length - 1 ? (
              <span
                className={cn(
                  'absolute start-3 top-7 bottom-0 w-0.5 -translate-x-1/2 rtl:translate-x-1/2',
                  s.state === 'done' ? 'bg-success' : 'bg-border',
                )}
                aria-hidden
              />
            ) : null}
            <span
              className={cn(
                'relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold',
                s.state === 'done' && 'border-success bg-success text-white',
                (s.state === 'active' || s.state === 'review') && 'border-primary bg-primary-soft text-primary-soft-foreground',
                s.state === 'pending' && 'border-border bg-surface text-subtle-foreground',
              )}
              aria-hidden
            >
              {s.state === 'done' ? <Check className="size-3.5" /> : s.state === 'review' ? <Eye className="size-3.5" /> : i + 1}
            </span>
            <span className="grid min-w-0 gap-0.5">
              <span className={cn('text-sm font-medium', s.state === 'pending' && 'text-muted-foreground')}>
                {localized(s.name, locale)}
              </span>
              <span className="text-xs text-subtle-foreground">
                {t(`states.${s.state}`)}
                {s.dueDate && s.state !== 'done' ? ` · ${t('expected', { date: f.date(`${s.dueDate}T12:00:00`, 'medium') })}` : ''}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
