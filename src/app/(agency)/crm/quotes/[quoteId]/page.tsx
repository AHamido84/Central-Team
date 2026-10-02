import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { requireAgency } from '@/lib/auth/context';
import { createFormatters } from '@/lib/i18n/format';
import { QuoteDocument } from '@/modules/crm/components/quote-document';
import { QuoteToolbar } from '@/modules/crm/components/quote-toolbar';
import { quoteReference } from '@/modules/crm/constants';
import { getCrmOptions, getDeal, getQuote } from '@/modules/crm/server/queries';

const uuid = /^[0-9a-f-]{36}$/;

export async function generateMetadata({ params }: { params: Promise<{ quoteId: string }> }): Promise<Metadata> {
  const { quoteId } = await params;
  const t = await getTranslations('nav');
  return { title: uuid.test(quoteId) ? t('quotes') : undefined };
}

export default async function QuotePage({ params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;
  if (!uuid.test(quoteId)) notFound();
  const ctx = await requireAgency('deals:read');
  if (!ctx.flags['module.crm']) notFound();
  const quote = await getQuote(ctx, quoteId);
  if (!quote) notFound();
  const [options, deal] = await Promise.all([getCrmOptions(ctx), getDeal(ctx, quote.dealId)]);
  // Labels follow the quote's language, not the viewer's.
  const t = await getTranslations({ locale: quote.locale, namespace: 'crm.quote' });
  const timeZone = ctx.organization.defaultTimezone;
  const f = createFormatters({ locale: quote.locale, timeZone });
  return (
    <div className="space-y-4">
      <BreadcrumbLabel segment={quoteId} label={quoteReference(quote.number)} />
      <QuoteToolbar quote={quote} options={options} dealPackageId={deal?.packageId ?? null} />
      <QuoteDocument
        quote={quote}
        timeZone={timeZone}
        agency={{ name: ctx.organization.name, logoPath: ctx.organization.logoPath, supportEmail: ctx.organization.supportEmail }}
        labels={{
          printTitle: t('printTitle'),
          number: t('number'),
          date: t('date'),
          to: t('to'),
          preparedBy: t('preparedBy'),
          valid: quote.validUntil ? t('valid', { date: f.date(`${quote.validUntil}T12:00:00Z`, 'long') }) : null,
          description: t('description'),
          quantity: t('quantity'),
          unitPrice: t('unitPriceShort'),
          lineTotal: t('lineTotal'),
          subtotal: t('subtotal'),
          discount: t('discountShort'),
          total: t('total'),
          notes: t('notes'),
          vatNote: t('vatNote'),
        }}
      />
    </div>
  );
}
