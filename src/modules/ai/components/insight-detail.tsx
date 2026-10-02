'use client';

import { Check, CircleSlash, ExternalLink, ListPlus, RotateCcw, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { PageHeader } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Card, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized } from '@/lib/i18n/localized';
import { InsightStatusBadge, SeverityBadge } from '@/modules/ai/components/badges';
import { useTextKit } from '@/modules/ai/components/use-text-kit';
import { insightBody, insightTitle, recommendationBody, recommendationTitle } from '@/modules/ai/insight-text';
import { decideRecommendationAction, explainInsightAction, setInsightStatusAction } from '@/modules/ai/server/actions';
import type { InsightDetail as Detail, RecommendationItem } from '@/modules/ai/server/queries';

function DismissDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
}) {
  const t = useTranslations('ai.insights');
  const tc = useTranslations('common');
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('dismissTitle')}</DialogTitle>
          <DialogDescription>{t('dismissBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label={t('dismissReason')} optional>
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid="dismiss-reason"
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button onClick={() => onConfirm(reason)} loading={pending} data-testid="dismiss-confirm">
            {t('dismiss')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AcceptDialog({
  rec,
  people,
  defaultDue,
}: {
  rec: RecommendationItem;
  people: { id: string; name: string }[];
  defaultDue: string;
}) {
  const t = useTranslations('ai.insights');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState(defaultDue);
  const accept = useAction(decideRecommendationAction, {
    successMessage: t('accepted'),
    onSuccess: () => setOpen(false),
  });
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} data-testid="rec-accept">
        <ListPlus aria-hidden />
        {t('accept')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={tc('close')}>
          <DialogHeader>
            <DialogTitle>{t('acceptTitle')}</DialogTitle>
            <DialogDescription>{t('acceptBody')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label={t('assignee')} optional>
              {(p) => (
                <NativeSelect {...p} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} data-testid="rec-assignee">
                  <option value="">{t('unassigned')}</option>
                  {people.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label={t('dueDate')}>
              {(p) => <Input {...p} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="rec-due" />}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              loading={accept.pending}
              onClick={() =>
                accept.run({ recommendationId: rec.id, decision: 'accepted', assigneeId: assigneeId || null, dueDate: dueDate || null })
              }
              data-testid="rec-accept-confirm"
            >
              {t('accept')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function InsightDetail({
  insight,
  canManage,
  canCreateTasks,
  aiUsable,
  people,
  defaultDue,
}: {
  insight: Detail;
  canManage: boolean;
  canCreateTasks: boolean;
  aiUsable: boolean;
  people: { id: string; name: string }[];
  defaultDue: string;
}) {
  const t = useTranslations('ai');
  const locale = useLocale() as 'ar' | 'en';
  const f = useFormat();
  const kit = useTextKit();
  const [dismissOpen, setDismissOpen] = useState(false);
  const [explanation, setExplanation] = useState<{ text: string; locale: 'ar' | 'en' } | null>(
    insight.explanation ? { text: insight.explanation, locale: insight.explanationLocale ?? locale } : null,
  );
  const status = useAction(setInsightStatusAction);
  const dismiss = useAction(setInsightStatusAction, { successMessage: t('insights.dismissed'), onSuccess: () => setDismissOpen(false) });
  const explain = useAction(explainInsightAction, {
    successMessage: t('insights.explained'),
    onSuccess: (r) => setExplanation({ text: r.explanation, locale }),
  });
  const decline = useAction(decideRecommendationAction, { successMessage: t('insights.recDismissed') });
  const x = insight.facts;
  const live = insight.status === 'open' || insight.status === 'acknowledged';

  return (
    <>
      <PageHeader
        title={insightTitle(kit, insight)}
        description={
          <span className="flex flex-wrap items-center gap-x-2">
            <Link href={`/campaigns/${insight.campaign.id}`} className="font-medium hover:underline">
              <bdi>{insight.campaign.name}</bdi>
            </Link>
            <span>·</span>
            <bdi>{localized(insight.client.name, locale)}</bdi>
          </span>
        }
        actions={
          canManage && insight.status !== 'resolved' ? (
            <>
              {insight.status === 'open' ? (
                <Button
                  variant="outline"
                  loading={status.pending}
                  onClick={() => status.run({ insightId: insight.id, status: 'acknowledged' })}
                  data-testid="insight-acknowledge"
                >
                  <Check aria-hidden />
                  {t('insights.acknowledge')}
                </Button>
              ) : null}
              {insight.status === 'dismissed' || insight.status === 'acknowledged' ? (
                <Button
                  variant="outline"
                  loading={status.pending}
                  onClick={() => status.run({ insightId: insight.id, status: 'open' })}
                  data-testid="insight-reopen"
                >
                  <RotateCcw aria-hidden />
                  {t('insights.reopen')}
                </Button>
              ) : null}
              {insight.status !== 'dismissed' ? (
                <Button variant="ghost" onClick={() => setDismissOpen(true)} data-testid="insight-dismiss">
                  <CircleSlash aria-hidden />
                  {t('insights.dismiss')}
                </Button>
              ) : null}
            </>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={insight.severity} />
          <InsightStatusBadge status={insight.status} />
          <Badge tone="outline">{t(`kind.${insight.kind}`)}</Badge>
          <span className="text-xs text-subtle-foreground">
            {t('insights.detected', { date: f.date(`${insight.detectedOn}T12:00:00Z`) })} ·{' '}
            {t('insights.lastSeen', { when: f.relative(insight.lastDetectedAt) })}
          </span>
        </div>
        {insight.status === 'dismissed' && insight.dismissReason ? (
          <p className="text-sm text-muted-foreground">
            {t('insights.dismissReason')}: {insight.dismissReason}
            {insight.actedBy ? <> — {insight.actedBy}</> : null}
          </p>
        ) : null}
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <Card className="p-5">
            <h2 className="text-sm font-semibold">{t('insights.numbers')}</h2>
            <p className="mt-2 text-sm" data-testid="insight-body">
              {insightBody(kit, insight)}
            </p>
            {x.change !== null && x.change !== undefined ? (
              <p className="mt-3 text-2xl font-semibold tabular-nums">
                <bdi dir="ltr">{f.number(x.change, { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 0 })}</bdi>
              </p>
            ) : null}
            <p className="mt-3 text-xs text-subtle-foreground">{t('insights.computedNote')}</p>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold">{t('insights.recommendations')}</h2>
            {insight.recommendationList.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('insights.noRecommendations')}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {insight.recommendationList.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-lg border border-border p-4"
                    data-testid="recommendation"
                    data-kind={r.kind}
                    data-status={r.status}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-medium">{recommendationTitle(kit, r)}</p>
                      <Badge tone={r.status === 'accepted' ? 'success' : r.status === 'dismissed' ? 'outline' : 'brand'}>
                        {t(`rec.status.${r.status}`)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{recommendationBody(kit, r)}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {r.status === 'proposed' && canManage && live ? (
                        <>
                          {canCreateTasks ? <AcceptDialog rec={r} people={people} defaultDue={defaultDue} /> : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={decline.pending}
                            onClick={() => decline.run({ recommendationId: r.id, decision: 'dismissed' })}
                            data-testid="rec-dismiss"
                          >
                            {t('insights.dismissRec')}
                          </Button>
                        </>
                      ) : null}
                      {r.status === 'accepted' && r.taskId ? (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/tasks?task=${r.taskId}`} data-testid="rec-open-task">
                            <ExternalLink aria-hidden />
                            {t('insights.openTask')}
                          </Link>
                        </Button>
                      ) : null}
                      {r.decidedBy && r.decidedAt ? (
                        <span className="text-xs text-subtle-foreground">
                          {r.decidedBy} · {f.relative(r.decidedAt)}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card className="flex h-fit flex-col gap-3 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" aria-hidden />
            {t('insights.explanation')}
          </h2>
          {explanation ? (
            <>
              <p
                className="text-sm whitespace-pre-line"
                lang={explanation.locale}
                dir={explanation.locale === 'ar' ? 'rtl' : 'ltr'}
                data-testid="insight-explanation"
              >
                {explanation.text}
              </p>
              <p className="text-xs text-subtle-foreground">{t('insights.aiDisclaimer')}</p>
            </>
          ) : null}
          {aiUsable ? (
            <Button
              variant={explanation ? 'outline' : 'primary'}
              loading={explain.pending}
              onClick={() => explain.run({ insightId: insight.id })}
              data-testid="insight-explain"
            >
              <Sparkles aria-hidden />
              {explanation ? t('insights.explainAgain') : t('insights.explain')}
            </Button>
          ) : !explanation ? (
            <p className="text-sm text-muted-foreground">
              {t('assistant.notEnabled')} — {t('assistant.notEnabledHint')}
            </p>
          ) : null}
        </Card>
      </div>

      <DismissDialog
        open={dismissOpen}
        onOpenChange={setDismissOpen}
        pending={dismiss.pending}
        onConfirm={(reason) => dismiss.run({ insightId: insight.id, status: 'dismissed', reason: reason || undefined })}
      />
    </>
  );
}
