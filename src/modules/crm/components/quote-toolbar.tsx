'use client';

import { ArrowLeft, Check, Pencil, Printer, Send, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { DirIcon } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/overlays';
import { useAction } from '@/lib/actions/use-action';
import { QuoteStatusBadge } from '@/modules/crm/components/badges';
import { QuoteEditor } from '@/modules/crm/components/quote-editor';
import type { QuoteStatus } from '@/modules/crm/constants';
import { deleteQuoteAction } from '@/modules/crm/server/actions';
import { setQuoteStatusAction } from '@/modules/crm/server/deal-actions';
import type { CrmOptions, QuoteDetail } from '@/modules/crm/server/queries';

export function QuoteToolbar({ quote, options, dealPackageId }: { quote: QuoteDetail; options: CrmOptions; dealPackageId: string | null }) {
  const t = useTranslations('crm.quote');
  const tc = useTranslations('common');
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const status = useAction(setQuoteStatusAction, { successMessage: tc('saved') });
  const remove = useAction(deleteQuoteAction);
  const set = (s: QuoteStatus) => status.run({ quoteId: quote.id, status: s });
  const draft = quote.status === 'draft';
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden" data-testid="quote-toolbar">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/crm/deals/${quote.dealId}`}>
          <DirIcon icon={ArrowLeft} />
          {t('backToDeal')}
        </Link>
      </Button>
      <QuoteStatusBadge status={quote.status} />
      <div className="flex-1" />
      {quote.canWrite && draft ? (
        <>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} data-testid="quote-edit">
            <Pencil />
            {tc('edit')}
          </Button>
          <Button variant="outline" size="sm" loading={status.pending} onClick={() => set('sent')} data-testid="quote-mark-sent">
            <Send />
            {t('markSent')}
          </Button>
        </>
      ) : null}
      {quote.canWrite && quote.status === 'sent' ? (
        <>
          <Button variant="outline" size="sm" loading={status.pending} onClick={() => set('accepted')} data-testid="quote-accepted">
            <Check />
            {t('markAccepted')}
          </Button>
          <Button variant="outline" size="sm" loading={status.pending} onClick={() => set('declined')}>
            <X />
            {t('markDeclined')}
          </Button>
        </>
      ) : null}
      <Button size="sm" onClick={() => window.print()} data-testid="quote-print">
        <Printer />
        {t('print')}
      </Button>
      {quote.canWrite && draft ? (
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label={t('deleteQuote')}>
              <Trash2 />
            </Button>
          }
          title={t('deleteQuote')}
          description={t('deleteConfirm', { title: quote.title })}
          confirmLabel={tc('delete')}
          cancelLabel={tc('cancel')}
          destructive
          onConfirm={async () => {
            const res = await remove.run({ id: quote.id });
            if (res.ok) router.push(`/crm/deals/${quote.dealId}`);
          }}
        />
      ) : null}
      {!draft ? <p className="w-full text-xs text-subtle-foreground">{t('readOnly')}</p> : null}
      {editing ? (
        <QuoteEditor
          dealId={quote.dealId}
          deal={{ title: quote.dealTitle, packageId: dealPackageId }}
          options={options}
          quote={quote}
          open={editing}
          onOpenChange={setEditing}
        />
      ) : null}
    </div>
  );
}
