'use client';

import { ChevronLeft, ChevronRight, Inbox, RotateCw, Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { DirIcon, EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Card, NativeSelect, Tooltip } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { emailKinds, outboxStatuses, type OutboxStatus } from '@/modules/mail/constants';
import { resendEmailAction } from '@/modules/mail/server/actions';
import type { EmailLogRow } from '@/modules/mail/server/queries';

const statusTone: Record<OutboxStatus | 'retrying', 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  queued: 'neutral',
  sending: 'info',
  sent: 'success',
  failed: 'danger',
  retrying: 'warning',
};

/** Email log (FR2.1): every send of the last 90 days with its status and error, filterable, with resend. */
export function EmailLog({ rows, total, page, pageSize }: { rows: EmailLogRow[]; total: number; page: number; pageSize: number }) {
  const t = useTranslations('mail');
  const f = useFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const resend = useAction(resendEmailAction, { successMessage: t('log.resent') });
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="grid gap-4" data-testid="email-log">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-56 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: q.trim() || null });
          }}
        >
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('log.search')}
            aria-label={t('log.search')}
            className="ps-9"
            dir="auto"
            data-testid="email-log-search"
          />
        </form>
        <NativeSelect
          aria-label={t('log.status')}
          className="w-auto"
          value={params.get('status') ?? 'all'}
          onChange={(e) => go({ status: e.target.value === 'all' ? null : e.target.value })}
          data-testid="email-log-status"
        >
          <option value="all">{t('log.allStatuses')}</option>
          {outboxStatuses.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t('log.kind')}
          className="w-auto"
          value={params.get('kind') ?? 'all'}
          onChange={(e) => go({ kind: e.target.value === 'all' ? null : e.target.value })}
          data-testid="email-log-kind"
        >
          <option value="all">{t('log.allKinds')}</option>
          {emailKinds.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </NativeSelect>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Inbox} title={t('log.empty')} description={t('log.emptyBody')} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              const shown: OutboxStatus | 'retrying' = r.status === 'failed' && !r.final ? 'retrying' : r.status;
              return (
                <li key={r.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4" data-testid="email-log-row">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone={statusTone[shown]} dot data-testid="email-log-status-badge">
                        {t(`statuses.${shown}`)}
                      </Badge>
                      <Badge tone="outline">{t(`kinds.${r.kind}`)}</Badge>
                      <bdi dir="ltr" className="truncate font-medium">
                        {r.toEmail}
                      </bdi>
                    </p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{r.subject}</p>
                    <p className="mt-1 text-xs text-subtle-foreground">
                      {f.dateTime(r.sentAt ?? r.createdAt)}
                      {r.sender ? ` · ${t(`senders.${r.sender}`)}` : ''}
                      {r.provider ? ` · ${r.provider}` : ''}
                      {r.attempts > 1 ? ` · ${t('log.attempts', { count: r.attempts })}` : ''}
                      {shown === 'retrying' ? ` · ${t('log.retryAt', { when: f.relative(r.nextAttemptAt) })}` : ''}
                    </p>
                    {r.errorCode && r.status !== 'sent' ? (
                      <p className="mt-1 text-xs text-danger" data-testid="email-log-error">
                        {t(`errors.${r.errorCode as 'unknown'}`)}
                        {r.errorMessage ? (
                          <span className="block truncate text-subtle-foreground" dir="ltr">
                            {r.errorMessage}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                  {r.sensitive ? (
                    <Tooltip content={t('log.notResendable')}>
                      <span tabIndex={0} className="text-xs text-subtle-foreground">
                        {t('log.notResendable')}
                      </span>
                    </Tooltip>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={resend.pending}
                      onClick={() => void resend.run({ id: r.id })}
                      data-testid="email-log-resend"
                    >
                      <RotateCw />
                      {t('log.resend')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>
            <DirIcon icon={ChevronLeft} />
            {t('log.prev')}
          </Button>
          <span className="text-muted-foreground">{t('log.page', { page, pages })}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => go({ page: String(page + 1) })}>
            {t('log.next')}
            <DirIcon icon={ChevronRight} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
