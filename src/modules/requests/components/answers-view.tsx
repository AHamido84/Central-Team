'use client';

import { ExternalLink } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { useFormat } from '@/components/providers';
import { Badge } from '@/components/ui/primitives';
import { localized, type Locale } from '@/lib/i18n/localized';
import { isEmptyAnswer, type RequestFormField } from '@/modules/requests/form-schema';

/** Read view of a request's answers, rendered against the form version it was submitted with. */
export function AnswersView({ fields, answers }: { fields: RequestFormField[]; answers: Record<string, unknown> }) {
  const locale = useLocale() as Locale;
  const t = useTranslations('requests');
  const f = useFormat();
  const optionLabel = (field: RequestFormField, value: string) =>
    localized(field.options?.find((o) => o.value === value)?.label, locale) || value;

  return (
    <dl className="divide-y divide-border" data-testid="request-answers">
      {fields.map((field) => {
        const value = answers[field.id];
        let content: ReactNode;
        if (isEmptyAnswer(value) || (field.type === 'checkbox' && value === false && !field.required)) {
          content = field.type === 'checkbox' ? t('answerNo') : <span className="text-subtle-foreground">{t('notAnswered')}</span>;
        } else if (field.type === 'checkbox') {
          content = value ? t('answerYes') : t('answerNo');
        } else if (field.type === 'number') {
          content = <span className="tabular">{f.number(Number(value))}</span>;
        } else if (field.type === 'date') {
          content = f.date(`${String(value)}T12:00:00`, 'long');
        } else if (field.type === 'url') {
          content = (
            <a
              href={String(value)}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex max-w-full items-center gap-1 text-primary underline-offset-2 hover:underline"
            >
              <bdi dir="ltr" className="truncate">
                {String(value)}
              </bdi>
              <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            </a>
          );
        } else if (field.type === 'single_select') {
          content = optionLabel(field, String(value));
        } else if (field.type === 'multi_select') {
          content = (
            <span className="flex flex-wrap gap-1.5">
              {(value as string[]).map((v) => (
                <Badge key={v} tone="brand">
                  {optionLabel(field, v)}
                </Badge>
              ))}
            </span>
          );
        } else {
          content = (
            <p dir="auto" className="text-start break-words whitespace-pre-wrap">
              {String(value)}
            </p>
          );
        }
        return (
          <div key={field.id} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[12rem_1fr] sm:gap-4">
            <dt className="text-sm text-muted-foreground">{localized(field.label, locale)}</dt>
            <dd className="text-sm">{content}</dd>
          </div>
        );
      })}
    </dl>
  );
}
