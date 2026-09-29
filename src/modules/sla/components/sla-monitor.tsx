'use client';

import { AlarmClock, CheckCircle2, ClipboardCheck, MessageSquareReply, ShieldAlert, Siren } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState, SectionTitle, StatCard } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Textarea } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Card, NativeSelect, Progress } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import { breachLevelTone, breachViews, type BreachView } from '@/modules/sla/constants';
import { acknowledgeBreachAction } from '@/modules/sla/server/actions';
import type { BreachItem, SlaIssue, SlaMonitorData } from '@/modules/sla/server/queries';

function useParamLink() {
  const pathname = usePathname();
  const params = useSearchParams();
  return (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const q = next.toString();
    return q ? `${pathname}?${q}` : pathname;
  };
}

export function SlaFilters({
  days,
  clientId,
  clients,
}: {
  days: number;
  clientId: string | null;
  clients: { id: string; name: LocalizedText }[];
}) {
  const t = useTranslations('sla.monitor');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const link = useParamLink();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground" id="sla-period">
          {t('period')}
        </span>
        <div role="group" aria-labelledby="sla-period" className="inline-flex rounded-lg border border-border p-0.5">
          {[30, 90].map((d) => (
            <Link
              key={d}
              href={link({ days: d === 30 ? null : String(d) })}
              scroll={false}
              aria-current={days === d ? 'true' : undefined}
              className={cn(
                'rounded-md px-3 py-1 text-sm',
                days === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t('days', { count: d })}
            </Link>
          ))}
        </div>
      </div>
      <label className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">{t('client')}</span>
        <NativeSelect
          value={clientId ?? ''}
          onChange={(e) => router.push(link({ client: e.target.value || null }), { scroll: false })}
          className="min-w-48"
          data-testid="sla-client-filter"
        >
          <option value="">{t('allClients')}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {localized(c.name, locale)}
            </option>
          ))}
        </NativeSelect>
      </label>
    </div>
  );
}

export function IssueRow({ issue, showClient = true }: { issue: SlaIssue; showClient?: boolean }) {
  const t = useTranslations();
  const f = useFormat();
  const locale = useLocale() as Locale;
  const Icon = issue.kind === 'response' ? MessageSquareReply : AlarmClock;
  return (
    <Link
      href={`/requests/${issue.requestId}`}
      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-muted"
      data-testid="sla-issue"
      data-kind={issue.kind}
      data-state={issue.state}
    >
      <span
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
          issue.state === 'overdue' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          <bdi>{issue.title}</bdi>
        </p>
        <p className="truncate text-xs text-subtle-foreground">
          <span dir="ltr">{issue.reference}</span>
          {showClient ? ` · ${localized(issue.clientName, locale)}` : ''} · {issue.assigneeName ?? t('sla.monitor.unassigned')}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge tone={issue.state === 'overdue' ? 'danger' : 'warning'}>
          {t(`sla.monitor.kinds.${issue.kind}`)} · {t(`sla.monitor.states.${issue.state}`)}
        </Badge>
        <span className="text-xs text-subtle-foreground">{t('sla.monitor.due', { when: f.relative(issue.dueAt) })}</span>
      </div>
    </Link>
  );
}

function AcknowledgeDialog({ breach, open, onOpenChange }: { breach: BreachItem; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations();
  const [note, setNote] = useState(breach.note ?? '');
  const ack = useAction(acknowledgeBreachAction, { successMessage: t('sla.monitor.acknowledged') });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await ack.run({ breachId: breach.id, note });
            if (res.ok) onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('sla.monitor.acknowledgeTitle')}</DialogTitle>
            <DialogDescription>{t('sla.monitor.acknowledgeBody')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={t('sla.monitor.note')} optional>
              {(p) => (
                <Textarea
                  {...p}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder={t('sla.monitor.notePlaceholder')}
                  data-testid="breach-note"
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={ack.pending} data-testid="breach-ack-confirm">
              {t('sla.monitor.acknowledge')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BreachRow({ breach, people, canAcknowledge }: { breach: BreachItem; people: Record<string, string>; canAcknowledge: boolean }) {
  const t = useTranslations();
  const f = useFormat();
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(false);
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start" data-testid="breach-row" data-level={breach.level}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={breachLevelTone[breach.level]}>{t(`sla.monitor.levels.${breach.level}`)}</Badge>
          <Badge tone="neutral">{t(`sla.monitor.kinds.${breach.kind}`)}</Badge>
          {breach.resolvedAt ? (
            <Badge tone="success">
              <CheckCircle2 aria-hidden />
              {t('sla.monitor.resolved', { when: f.relative(breach.resolvedAt) })}
            </Badge>
          ) : null}
        </div>
        <Link href={`/requests/${breach.requestId}`} className="mt-1 block truncate text-sm font-medium hover:underline">
          <span dir="ltr" className="text-muted-foreground">
            {breach.reference}
          </span>{' '}
          <bdi>{breach.title}</bdi>
        </Link>
        <p className="text-xs text-subtle-foreground">
          {localized(breach.clientName, locale)} · {t('sla.monitor.due', { when: f.dateTime(breach.dueAt) })} ·{' '}
          {t('sla.monitor.detected', { when: f.relative(breach.detectedAt) })}
        </p>
        {breach.acknowledgedAt ? (
          <p className="mt-1 text-xs text-muted-foreground" data-testid="breach-acknowledged">
            {t('sla.monitor.acknowledgedBy', {
              name: (breach.acknowledgedBy && people[breach.acknowledgedBy]) || t('common.unknownUser'),
              when: f.relative(breach.acknowledgedAt),
            })}
            {breach.note ? (
              <>
                {' — '}
                <bdi>{breach.note}</bdi>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      {canAcknowledge && !breach.acknowledgedAt ? (
        <>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="breach-ack">
            <ClipboardCheck />
            {t('sla.monitor.acknowledge')}
          </Button>
          <AcknowledgeDialog breach={breach} open={open} onOpenChange={setOpen} />
        </>
      ) : null}
    </li>
  );
}

function rateLabel(f: ReturnType<typeof useFormat>, noData: string, c: { rate: number | null }) {
  return c.rate === null ? noData : f.percent(c.rate);
}

export function SlaMonitor({ data, view, canAcknowledge }: { data: SlaMonitorData; view: BreachView; canAcknowledge: boolean }) {
  const t = useTranslations();
  const f = useFormat();
  const locale = useLocale() as Locale;
  const link = useParamLink();
  const noData = t('sla.monitor.noData');
  const overdue = data.issues.filter((i) => i.state === 'overdue').length;
  const unacknowledged = data.breaches.filter((b) => !b.acknowledgedAt && b.level === 'breached' && !b.resolvedAt).length;
  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('sla.monitor.responseCompliance')}
          value={rateLabel(f, noData, data.compliance.response)}
          icon={MessageSquareReply}
          footer={t('sla.monitor.ofTotal', { met: data.compliance.response.met, total: data.compliance.response.total })}
        />
        <StatCard
          label={t('sla.monitor.resolutionCompliance')}
          value={rateLabel(f, noData, data.compliance.resolution)}
          icon={CheckCircle2}
          footer={t('sla.monitor.ofTotal', { met: data.compliance.resolution.met, total: data.compliance.resolution.total })}
        />
        <StatCard
          label={t('sla.monitor.openIssues')}
          value={f.number(data.issues.length)}
          icon={AlarmClock}
          footer={t('sla.monitor.overdueCount', { count: overdue })}
        />
        <StatCard label={t('sla.monitor.views.unacknowledged')} value={f.number(unacknowledged)} icon={Siren} />
      </div>
      <p className="-mt-4 text-xs text-subtle-foreground">{t('sla.monitor.complianceHint', { days: data.days })}</p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-8">
          <section>
            <SectionTitle title={t('sla.monitor.openIssues')} />
            <Card className="divide-y divide-border" data-testid="sla-issues">
              {data.issues.length === 0 ? (
                <EmptyState compact icon={CheckCircle2} title={t('sla.monitor.noIssues')} description={t('sla.monitor.noIssuesBody')} />
              ) : (
                data.issues.map((i) => <IssueRow key={`${i.requestId}-${i.kind}`} issue={i} />)
              )}
            </Card>
          </section>

          <section>
            <SectionTitle title={t('sla.monitor.breachLog')} />
            <nav aria-label={t('sla.monitor.breachLog')} className="mb-3 flex flex-wrap gap-1">
              {breachViews.map((v) => (
                <Link
                  key={v}
                  href={link({ view: v === 'open' ? null : v })}
                  scroll={false}
                  aria-current={view === v ? 'page' : undefined}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm',
                    view === v
                      ? 'border-primary bg-primary-soft text-primary-soft-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                  data-testid={`breach-view-${v}`}
                >
                  {t(`sla.monitor.views.${v}`)}
                </Link>
              ))}
            </nav>
            <Card>
              {data.breaches.length === 0 ? (
                <EmptyState compact icon={ShieldAlert} title={t('sla.monitor.noBreaches')} description={t('sla.monitor.noBreachesBody')} />
              ) : (
                <ul className="divide-y divide-border" data-testid="breach-log">
                  {data.breaches.map((b) => (
                    <BreachRow key={b.id} breach={b} people={data.people} canAcknowledge={canAcknowledge} />
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>

        <aside className="min-w-0">
          <SectionTitle title={t('sla.monitor.byClient')} />
          <Card className="divide-y divide-border" data-testid="sla-by-client">
            {data.byClient.length === 0 ? (
              <EmptyState compact icon={ClipboardCheck} title={t('sla.monitor.noData')} />
            ) : (
              data.byClient.map((c) => (
                <Link key={c.clientId} href={`/clients/${c.clientId}`} className="grid gap-2 px-4 py-3 hover:bg-surface-muted">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium">{localized(c.clientName, locale)}</span>
                    <Badge tone={c.breaches ? 'danger' : 'neutral'}>{t('sla.monitor.breachesCount', { count: c.breaches })}</Badge>
                  </div>
                  {(['response', 'resolution'] as const).map((k) => (
                    <div key={k} className="grid grid-cols-[6rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{t(`sla.monitor.kinds.${k}`)}</span>
                      <Progress value={(c[k].rate ?? 0) * 100} aria-label={t(`sla.monitor.kinds.${k}`)} />
                      <span className="tabular text-end">{rateLabel(f, '—', c[k])}</span>
                    </div>
                  ))}
                </Link>
              ))
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
