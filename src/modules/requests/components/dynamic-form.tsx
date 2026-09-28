'use client';

import { useLocale, useTranslations } from 'next-intl';

import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { Checkbox, NativeSelect } from '@/components/ui/primitives';
import { localized, type Locale } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import type { RequestFormField } from '@/modules/requests/form-schema';

/**
 * Renders a request form version's fields as controlled inputs. Validation messages come from
 * `buildAnswersSchema` (same validator the server action runs), keyed by field id.
 */
export function DynamicFields({
  fields,
  values,
  errors,
  onChange,
  disabled,
  idPrefix = 'field',
}: {
  fields: RequestFormField[];
  values: Record<string, unknown>;
  errors?: Record<string, string | undefined>;
  onChange: (id: string, value: unknown) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations('requests');
  return (
    <div className="grid gap-5">
      {fields.map((field) => {
        const label = localized(field.label, locale);
        const help = field.help ? localized(field.help, locale) : '';
        const value = values[field.id];
        const error = errors?.[field.id];
        const testId = `answer-${field.id}`;
        if (field.type === 'checkbox') {
          return (
            <div key={field.id} className="grid gap-1.5">
              <label className="flex items-start gap-3 rounded-lg border border-border p-3">
                <Checkbox
                  checked={Boolean(value)}
                  onCheckedChange={(v) => onChange(field.id, v === true)}
                  disabled={disabled}
                  aria-invalid={error ? true : undefined}
                  className="mt-0.5"
                  data-testid={testId}
                />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">
                    {label}
                    {field.required ? (
                      <span className="ms-0.5 text-danger" aria-hidden>
                        *
                      </span>
                    ) : null}
                  </span>
                  {help ? <span className="text-xs text-subtle-foreground">{help}</span> : null}
                </span>
              </label>
              {error ? <FieldError error={error} /> : null}
            </div>
          );
        }
        if (field.type === 'multi_select') {
          const selected = Array.isArray(value) ? (value as string[]) : [];
          return (
            <fieldset key={field.id} className="grid gap-1.5" aria-invalid={error ? true : undefined}>
              <legend className="mb-1.5 text-sm font-medium">
                {label}
                {field.required ? (
                  <span className="ms-0.5 text-danger" aria-hidden>
                    *
                  </span>
                ) : null}
              </legend>
              <div className="flex flex-wrap gap-2" data-testid={testId}>
                {(field.options ?? []).map((o) => {
                  const on = selected.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={disabled}
                      onClick={() => onChange(field.id, on ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        on
                          ? 'border-primary bg-primary-soft font-medium text-primary-soft-foreground'
                          : 'border-border bg-surface text-muted-foreground hover:bg-surface-muted',
                      )}
                    >
                      {localized(o.label, locale)}
                    </button>
                  );
                })}
              </div>
              {help && !error ? <p className="text-xs text-subtle-foreground">{help}</p> : null}
              {error ? <FieldError error={error} /> : null}
            </fieldset>
          );
        }
        return (
          <Field
            key={field.id}
            id={`${idPrefix}-${field.id}`}
            label={label}
            hint={help || undefined}
            error={error}
            required={field.required}
            optional={!field.required}
          >
            {(p) => {
              switch (field.type) {
                case 'long_text':
                  return (
                    <Textarea
                      {...p}
                      dir="auto"
                      rows={4}
                      value={String(value ?? '')}
                      maxLength={field.maxLength ?? 5000}
                      onChange={(e) => onChange(field.id, e.target.value)}
                      disabled={disabled}
                      data-testid={testId}
                    />
                  );
                case 'number':
                  return (
                    <Input
                      {...p}
                      type="number"
                      dir="ltr"
                      inputMode="decimal"
                      min={field.min ?? undefined}
                      max={field.max ?? undefined}
                      value={value === null || value === undefined ? '' : String(value)}
                      onChange={(e) => onChange(field.id, e.target.value)}
                      disabled={disabled}
                      data-testid={testId}
                    />
                  );
                case 'date':
                  return (
                    <Input
                      {...p}
                      type="date"
                      dir="ltr"
                      value={String(value ?? '')}
                      onChange={(e) => onChange(field.id, e.target.value)}
                      disabled={disabled}
                      data-testid={testId}
                    />
                  );
                case 'url':
                  return (
                    <Input
                      {...p}
                      type="url"
                      dir="ltr"
                      inputMode="url"
                      placeholder="https://"
                      value={String(value ?? '')}
                      onChange={(e) => onChange(field.id, e.target.value)}
                      disabled={disabled}
                      data-testid={testId}
                    />
                  );
                case 'single_select':
                  return (
                    <NativeSelect
                      {...p}
                      value={String(value ?? '')}
                      onChange={(e) => onChange(field.id, e.target.value)}
                      disabled={disabled}
                      data-testid={testId}
                    >
                      <option value="">{t('choose')}</option>
                      {(field.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {localized(o.label, locale)}
                        </option>
                      ))}
                    </NativeSelect>
                  );
                default:
                  return (
                    <Input
                      {...p}
                      dir="auto"
                      value={String(value ?? '')}
                      maxLength={field.maxLength ?? 200}
                      onChange={(e) => onChange(field.id, e.target.value)}
                      disabled={disabled}
                      data-testid={testId}
                    />
                  );
              }
            }}
          </Field>
        );
      })}
    </div>
  );
}

function FieldError({ error }: { error: string }) {
  const t = useTranslations();
  const key = `validation.${error}` as Parameters<typeof t>[0];
  return (
    <p role="alert" className="text-xs font-medium text-danger">
      {t.has(key) ? t(key) : error}
    </p>
  );
}
