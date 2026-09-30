'use client';

import { Package, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { quoteTotals } from '@/modules/crm/quotes';
import { saveQuoteAction } from '@/modules/crm/server/deal-actions';
import type { CrmOptions, QuoteDetail } from '@/modules/crm/server/queries';

type Line = { key: string; packageId: string | null; description: string; quantity: string; unitPrice: string };

let seq = 0;
const nextKey = () => `l${++seq}`;

export function QuoteEditor({
  dealId,
  deal,
  options,
  quote,
  open,
  onOpenChange,
}: {
  dealId: string;
  deal: { title: string; packageId: string | null };
  options: CrmOptions;
  quote: QuoteDetail | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations();
  const f = useFormat();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pkgLine = (id: string, lang: Locale): Line | null => {
    const p = options.packages.find((x) => x.id === id);
    if (!p) return null;
    return {
      key: nextKey(),
      packageId: p.id,
      description: localized(p.name, lang),
      quantity: '1',
      unitPrice: String((p.priceMinor ?? 0) / 100),
    };
  };
  const [lang, setLang] = useState<'ar' | 'en'>(quote?.locale ?? locale);
  const [title, setTitle] = useState(quote?.title ?? deal.title);
  const [validUntil, setValidUntil] = useState(quote?.validUntil ?? '');
  const [discount, setDiscount] = useState(String((quote?.discountMinor ?? 0) / 100));
  const [notes, setNotes] = useState(quote?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(() => {
    if (quote)
      return quote.items.map((i) => ({
        key: nextKey(),
        packageId: i.packageId,
        description: i.description,
        quantity: String(i.quantity),
        unitPrice: String(i.unitPriceMinor / 100),
      }));
    const first = deal.packageId ? pkgLine(deal.packageId, locale) : null;
    return [first ?? { key: nextKey(), packageId: null, description: '', quantity: '1', unitPrice: '0' }];
  });
  const [addPkg, setAddPkg] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const save = useAction(saveQuoteAction, { successMessage: t('crm.quote.saved') });

  const minor = (v: string) => Math.round(Number(v || 0) * 100);
  const totals = quoteTotals(
    lines.map((l) => ({ quantity: Number(l.quantity || 0), unitPriceMinor: minor(l.unitPrice) })),
    minor(discount),
  );
  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} size="xl">
        <form
          className="flex min-h-0 flex-col"
          noValidate
          data-testid="quote-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await save.run({
              quoteId: quote?.id,
              dealId,
              title,
              locale: lang,
              validUntil: validUntil || null,
              discountSar: Number(discount || 0),
              notes,
              items: lines.map((l) => ({
                packageId: l.packageId,
                description: l.description,
                quantity: Number(l.quantity || 0),
                unitPriceSar: Number(l.unitPrice || 0),
              })),
            });
            if (!res.ok) return setErrors(res.error.fieldErrors);
            onOpenChange(false);
            if (!quote) router.push(`/crm/quotes/${res.data.quoteId}`);
          }}
        >
          <DialogHeader>
            <DialogTitle>{quote ? t('crm.quote.editTitle') : t('crm.quote.newTitle')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('crm.quote.title')} error={errors?.title?.[0]} required className="sm:col-span-3">
                {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} data-testid="quote-title" />}
              </Field>
              <Field label={t('crm.quote.language')}>
                {(p) => (
                  <NativeSelect {...p} value={lang} onChange={(e) => setLang(e.target.value as 'ar' | 'en')} data-testid="quote-locale">
                    <option value="ar">{t('common.arabic')}</option>
                    <option value="en">{t('common.english')}</option>
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('crm.quote.validUntil')} optional>
                {(p) => <Input {...p} type="date" dir="ltr" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}
              </Field>
              <Field label={t('crm.quote.discount')}>
                {(p) => (
                  <Input {...p} type="number" dir="ltr" min={0} step="50" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                )}
              </Field>
            </div>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t('crm.quote.items')}</legend>
              {errors?.items?.[0] ? <p className="text-sm text-danger">{t(`validation.${errors.items[0] as 'min_one'}`)}</p> : null}
              <ul className="grid gap-2" data-testid="quote-lines">
                {lines.map((l, i) => (
                  <li
                    key={l.key}
                    className="grid grid-cols-[minmax(0,1fr)_4.5rem_7rem_auto] items-end gap-2 max-sm:grid-cols-[minmax(0,1fr)_4.5rem_6rem_auto]"
                  >
                    <Field label={t('crm.quote.description')} error={errors?.[`items.${i}.description`]?.[0]}>
                      {(p) => (
                        <Input
                          {...p}
                          value={l.description}
                          onChange={(e) => update(l.key, { description: e.target.value })}
                          maxLength={300}
                          data-testid="quote-line-description"
                        />
                      )}
                    </Field>
                    <Field label={t('crm.quote.quantity')}>
                      {(p) => (
                        <Input
                          {...p}
                          type="number"
                          dir="ltr"
                          min={0}
                          step="1"
                          value={l.quantity}
                          onChange={(e) => update(l.key, { quantity: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label={t('crm.quote.unitPrice')}>
                      {(p) => (
                        <Input
                          {...p}
                          type="number"
                          dir="ltr"
                          min={0}
                          step="50"
                          value={l.unitPrice}
                          onChange={(e) => update(l.key, { unitPrice: e.target.value })}
                          data-testid="quote-line-price"
                        />
                      )}
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('common.remove')}
                      disabled={lines.length === 1}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setLines((ls) => [...ls, { key: nextKey(), packageId: null, description: '', quantity: '1', unitPrice: '0' }])
                  }
                  data-testid="quote-add-line"
                >
                  <Plus />
                  {t('crm.quote.addItem')}
                </Button>
                {options.packages.length ? (
                  <div className="flex items-center gap-2">
                    <NativeSelect
                      aria-label={t('crm.quote.addPackage')}
                      value={addPkg}
                      onChange={(e) => setAddPkg(e.target.value)}
                      className="h-8 w-auto"
                    >
                      <option value="">{t('crm.quote.addPackage')}</option>
                      {options.packages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {localized(p.name, locale)}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!addPkg}
                      onClick={() => {
                        const line = pkgLine(addPkg, lang);
                        if (line) setLines((ls) => [...ls.filter((x) => x.description.trim()), line]);
                        setAddPkg('');
                      }}
                    >
                      <Package />
                      {t('crm.quote.insert')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </fieldset>

            <dl className="ms-auto grid w-full max-w-xs gap-1 text-sm" data-testid="quote-totals">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('crm.quote.subtotal')}</dt>
                <dd className="tabular">{f.currency(totals.subtotal)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t('crm.quote.discount')}</dt>
                <dd className="tabular">{f.currency(-totals.discount)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-border pt-1 font-semibold">
                <dt>{t('crm.quote.total')}</dt>
                <dd className="tabular" data-testid="quote-total">
                  {f.currency(totals.total)}
                </dd>
              </div>
            </dl>

            <Field label={t('crm.quote.notes')} optional>
              {(p) => (
                <Textarea
                  {...p}
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('crm.quote.notesPlaceholder')}
                  maxLength={4000}
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={save.pending} data-testid="quote-save">
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
