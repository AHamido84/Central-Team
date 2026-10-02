import { Avatar } from '@/components/ui/primitives';
import { createFormatters } from '@/lib/i18n/format';
import { localized, type LocalizedText } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { quoteReference } from '@/modules/crm/constants';
import { lineTotal } from '@/modules/crm/quotes';
import type { QuoteDetail } from '@/modules/crm/server/queries';

export type QuoteLabels = {
  printTitle: string;
  number: string;
  date: string;
  to: string;
  preparedBy: string;
  /** Already formatted ("Valid until …"), or null without a validity date. */
  valid: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  subtotal: string;
  discount: string;
  total: string;
  notes: string;
  vatNote: string;
};

/**
 * The printable quotation. Rendered in the quote's own language and direction (not the viewer's), so an Arabic-speaking
 * rep can send an English quote. Prints through the shared `.report-print` rules (ADR-049).
 */
export function QuoteDocument({
  quote,
  labels,
  agency,
  timeZone,
}: {
  quote: QuoteDetail;
  labels: QuoteLabels;
  agency: { name: LocalizedText; logoPath: string | null; supportEmail: string | null };
  timeZone: string;
}) {
  const f = createFormatters({ locale: quote.locale, timeZone });
  const lang = quote.locale;
  const agencyName = localized(agency.name, lang);
  return (
    <article
      lang={lang}
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      className="report-print mx-auto flex w-full max-w-4xl flex-col gap-8 rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-8 print:max-w-none print:border-0 print:p-0 print:shadow-none"
      data-testid="quote-document"
      data-locale={lang}
    >
      <header className="flex flex-col gap-6 border-b-4 border-primary pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <Avatar square size="lg" name={agencyName} src={agency.logoPath ? (publicAssetUrl(agency.logoPath) ?? undefined) : undefined} />
          <div>
            <p className="text-lg font-semibold">{agencyName}</p>
            {agency.supportEmail ? (
              <p className="text-sm text-muted-foreground" dir="ltr">
                {agency.supportEmail}
              </p>
            ) : null}
          </div>
        </div>
        <div className="grid gap-1 text-sm sm:text-end">
          <p className="text-2xl font-bold tracking-tight">{labels.printTitle}</p>
          <p>
            <span className="text-muted-foreground">{labels.number}: </span>
            <span dir="ltr">{quoteReference(quote.number)}</span>
          </p>
          <p>
            <span className="text-muted-foreground">{labels.date}: </span>
            {f.date(quote.sentAt ?? quote.createdAt, 'long')}
          </p>
          {labels.valid ? <p className="text-muted-foreground">{labels.valid}</p> : null}
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{labels.to}</p>
          <p className="mt-1 font-semibold">
            <bdi>{quote.company ?? quote.dealTitle}</bdi>
          </p>
          {quote.contactName ? (
            <p className="text-sm">
              <bdi>{quote.contactName}</bdi>
            </p>
          ) : null}
        </div>
        {quote.createdByName ? (
          <div className="sm:text-end">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{labels.preparedBy}</p>
            <p className="mt-1 text-sm">
              <bdi>{quote.createdByName}</bdi>
            </p>
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold">
          <bdi>{quote.title}</bdi>
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="quote-doc-items">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 text-start font-medium">{labels.description}</th>
                <th className="w-16 py-2 text-end font-medium">{labels.quantity}</th>
                <th className="w-32 py-2 text-end font-medium">{labels.unitPrice}</th>
                <th className="w-32 py-2 text-end font-medium">{labels.lineTotal}</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((i) => (
                <tr key={i.id} className="border-b border-border/60 align-top">
                  <td className="py-2 pe-3">
                    <bdi>{i.description}</bdi>
                  </td>
                  <td className="tabular py-2 text-end">{f.number(i.quantity)}</td>
                  <td className="tabular py-2 text-end">{f.currency(i.unitPriceMinor, quote.currency)}</td>
                  <td className="tabular py-2 text-end">{f.currency(lineTotal(i), quote.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ms-auto mt-4 grid w-full max-w-xs gap-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{labels.subtotal}</dt>
            <dd className="tabular">{f.currency(quote.subtotalMinor, quote.currency)}</dd>
          </div>
          {quote.discountMinor ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{labels.discount}</dt>
              <dd className="tabular">{f.currency(-quote.discountMinor, quote.currency)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t-2 border-foreground pt-2 text-base font-bold">
            <dt>{labels.total}</dt>
            <dd className="tabular" data-testid="quote-doc-total">
              {f.currency(quote.totalMinor, quote.currency)}
            </dd>
          </div>
        </dl>
      </section>

      {quote.notes ? (
        <section>
          <p className="mb-1 text-sm font-semibold">{labels.notes}</p>
          <p className="text-sm whitespace-pre-line">{quote.notes}</p>
        </section>
      ) : null}
      <footer className="border-t border-border pt-4 text-xs text-subtle-foreground">{labels.vatNote}</footer>
    </article>
  );
}
