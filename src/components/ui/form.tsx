'use client';

import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';

import { Label } from '@/components/ui/primitives';
import { cn } from '@/lib/utils/cn';

/**
 * Form field: label, control, hint and error wired with aria attributes.
 * `error` is a validation message key under the `validation` namespace (Zod issues are
 * produced with keys, see src/lib/validation.ts) or an already-translated string.
 */
export function Field({
  label,
  hint,
  error,
  required,
  optional,
  className,
  children,
  id: idProp,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  optional?: boolean;
  className?: string;
  id?: string;
  children: (props: { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }) => ReactNode;
}) {
  const t = useTranslations();
  const generated = useId();
  const id = idProp ?? generated;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const key = `validation.${error}` as Parameters<typeof t>[0];
  const errorText = error ? (t.has(key) ? t(key) : error) : null;
  return (
    <div className={cn('grid gap-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>
          {label}
          {required ? (
            <span className="ms-0.5 text-danger" aria-hidden>
              *
            </span>
          ) : null}
        </Label>
        {optional ? <span className="text-xs text-subtle-foreground">{t('common.optional')}</span> : null}
      </div>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-subtle-foreground">
          {hint}
        </p>
      ) : null}
      {errorText ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('grid gap-5 border-b border-border py-6 last:border-b-0 md:grid-cols-[16rem_1fr] md:gap-8', className)}>
      <div>
        <h2 className="text-[0.9375rem] font-semibold">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="grid max-w-2xl gap-4">{children}</div>
    </section>
  );
}
