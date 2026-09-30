'use client';

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CalendarClock, Columns3, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useOptimistic, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Avatar, Card, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { dealReference, lostReasons, type LostReason } from '@/modules/crm/constants';
import { weightedValue } from '@/modules/crm/metrics';
import { moveDealAction, saveDealAction } from '@/modules/crm/server/actions';
import type { CrmOptions, DealCard, PipelineWithStages } from '@/modules/crm/server/queries';

type Stage = PipelineWithStages['stages'][number];

/** Arrow Left/Right jump to the neighbouring stage column, whatever the page direction. */
const columnKeys: KeyboardCoordinateGetter = (event, { context: { collisionRect, droppableContainers, droppableRects } }) => {
  if (!collisionRect || (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight')) return undefined;
  event.preventDefault();
  const cx = collisionRect.left + collisionRect.width / 2;
  let best: { left: number; top: number; width: number; d: number } | null = null;
  for (const c of droppableContainers.getEnabled()) {
    const rect = droppableRects.get(c.id);
    if (!rect) continue;
    const dx = rect.left + rect.width / 2 - cx;
    if (event.code === 'ArrowLeft' ? dx >= -1 : dx <= 1) continue;
    if (!best || Math.abs(dx) < best.d) best = { left: rect.left, top: rect.top, width: rect.width, d: Math.abs(dx) };
  }
  return best ? { x: best.left + (best.width - collisionRect.width) / 2, y: best.top + 56 } : undefined;
};

function DealCardView({ deal, today, staleDays, dragging }: { deal: DealCard; today: string; staleDays: number; dragging?: boolean }) {
  const t = useTranslations('crm.pipeline');
  const f = useFormat();
  const quietDays = Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(deal.lastActivityAt)) / 86_400_000);
  const overdue = deal.status === 'open' && deal.expectedCloseDate !== null && deal.expectedCloseDate < today;
  return (
    <div
      className={cn(
        'grid gap-1.5 rounded-lg border border-border bg-surface p-3 text-start shadow-xs',
        dragging && 'rotate-1 shadow-lg ring-2 ring-primary/50',
      )}
    >
      <Link href={`/crm/deals/${deal.id}`} className="line-clamp-2 text-sm font-medium hover:underline" data-testid="deal-card-link">
        <bdi>{deal.title}</bdi>
      </Link>
      <p className="truncate text-xs text-subtle-foreground">
        <span dir="ltr">{dealReference(deal.number)}</span>
        {deal.company ? (
          <>
            {' '}
            · <bdi>{deal.company}</bdi>
          </>
        ) : null}
      </p>
      <div className="flex items-center justify-between gap-2">
        <span className="tabular text-sm font-semibold">{f.currency(deal.valueMinor)}</span>
        <span className="tabular text-xs text-muted-foreground">{deal.probability}%</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {deal.owner ? <Avatar name={deal.owner.name} src={publicAssetUrl(deal.owner.avatarPath)} size="xs" /> : null}
        {deal.expectedCloseDate ? (
          <span
            className={cn('inline-flex items-center gap-1', overdue ? 'font-medium text-danger' : 'text-muted-foreground')}
            title={overdue ? t('overdue') : undefined}
          >
            <CalendarClock className="size-3.5" aria-hidden />
            {f.date(`${deal.expectedCloseDate}T12:00:00`, 'short')}
          </span>
        ) : null}
        {deal.status === 'open' && quietDays >= staleDays ? <span className="text-warning">{t('quiet', { days: quietDays })}</span> : null}
        {deal.nextActivityAt ? <span className="text-muted-foreground">{t('next', { when: f.relative(deal.nextActivityAt) })}</span> : null}
      </div>
    </div>
  );
}

function DraggableDeal({ deal, today, staleDays, disabled }: { deal: DealCard; today: string; staleDays: number; disabled: boolean }) {
  const { setNodeRef, transform, isDragging, attributes, listeners } = useDraggable({ id: deal.id, data: { dealId: deal.id }, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn('rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', isDragging && 'opacity-40')}
      data-testid="deal-card"
      data-deal-id={deal.id}
      {...attributes}
      {...listeners}
    >
      <DealCardView deal={deal} today={today} staleDays={staleDays} />
    </div>
  );
}

function StageColumn({
  stage,
  deals,
  today,
  staleDays,
  canMove,
}: {
  stage: Stage;
  deals: DealCard[];
  today: string;
  staleDays: number;
  canMove: boolean;
}) {
  const t = useTranslations('crm.pipeline');
  const f = useFormat();
  const locale = useLocale() as Locale;
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { stageId: stage.id } });
  const total = deals.reduce((n, d) => n + d.valueMinor, 0);
  const weighted = deals.reduce((n, d) => n + (stage.kind === 'open' ? weightedValue(d) : stage.kind === 'won' ? d.valueMinor : 0), 0);
  const name = localized(stage.name, locale);
  return (
    <section
      ref={setNodeRef}
      className={cn('flex w-72 shrink-0 flex-col rounded-xl bg-surface-muted/60', isOver && 'ring-2 ring-primary/60')}
      aria-label={name}
      data-testid="stage-column"
      data-stage-id={stage.id}
      data-kind={stage.kind}
    >
      <header className="grid gap-0.5 px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span
            className={cn('size-2 rounded-full', stage.kind === 'won' ? 'bg-success' : stage.kind === 'lost' ? 'bg-danger' : 'bg-primary')}
            aria-hidden
          />
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</h3>
          <span className="tabular rounded-full bg-surface px-1.5 text-xs text-muted-foreground">{f.number(deals.length)}</span>
        </div>
        <p className="text-xs text-subtle-foreground">
          {t('total', { value: f.currency(total) })}
          {stage.kind === 'open' ? ` · ${t('weighted', { value: f.currency(weighted) })}` : ''}
        </p>
      </header>
      <div className="grid max-h-[calc(100dvh-19rem)] min-h-20 content-start gap-2 overflow-y-auto px-2 pb-3">
        {deals.map((d) => (
          <DraggableDeal key={d.id} deal={d} today={today} staleDays={staleDays} disabled={!canMove} />
        ))}
        {deals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-subtle-foreground">
            {t('dropHere')}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function LostDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: (reason: LostReason, note: string) => void;
}) {
  const t = useTranslations();
  const [reason, setReason] = useState<LostReason>('price');
  const [note, setNote] = useState('');
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent closeLabel={t('common.close')}>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(reason, note);
          }}
          data-testid="lost-form"
        >
          <DialogHeader>
            <DialogTitle>{t('crm.pipeline.lostTitle')}</DialogTitle>
            <DialogDescription>{t('crm.pipeline.lostBody')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label={t('crm.pipeline.lostReason')}>
              {(p) => (
                <NativeSelect {...p} value={reason} onChange={(e) => setReason(e.target.value as LostReason)} data-testid="lost-reason">
                  {lostReasons.map((r) => (
                    <option key={r} value={r}>
                      {t(`crm.lostReasons.${r}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label={t('crm.pipeline.lostNote')} optional>
              {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="destructive" data-testid="lost-confirm">
              {t('crm.pipeline.markLost')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DealDialog({
  open,
  onOpenChange,
  options,
  pipelineId,
  me,
  canManageAll,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  options: CrmOptions;
  pipelineId: string;
  me: string;
  canManageAll: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [value, setValue] = useState('');
  const [close, setClose] = useState('');
  const [packageId, setPackageId] = useState('');
  const [ownerId, setOwnerId] = useState(me);
  const save = useAction(saveDealAction, { successMessage: t('common.saved') });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <form
          className="flex min-h-0 flex-col"
          data-testid="deal-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await save.run({
              title,
              company: company || null,
              pipelineId,
              valueSar: Number(value || 0),
              expectedCloseDate: close || null,
              ownerId: ownerId || null,
              packageId: packageId || null,
            });
            if (res.ok) router.push(`/crm/deals/${res.data.dealId}`);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('crm.pipeline.newDeal')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label={t('crm.leads.dealTitle')} required>
              {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} data-testid="deal-title" />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('crm.pipeline.company')} optional>
                {(p) => <Input {...p} value={company} onChange={(e) => setCompany(e.target.value)} maxLength={120} />}
              </Field>
              <Field label={t('crm.pipeline.value')}>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    dir="ltr"
                    min={0}
                    step="100"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    data-testid="deal-value"
                  />
                )}
              </Field>
              <Field label={t('crm.pipeline.expectedClose')} optional>
                {(p) => <Input {...p} type="date" dir="ltr" value={close} onChange={(e) => setClose(e.target.value)} />}
              </Field>
              <Field label={t('crm.pipeline.package')} optional>
                {(p) => (
                  <NativeSelect {...p} value={packageId} onChange={(e) => setPackageId(e.target.value)}>
                    <option value="">{t('crm.pipeline.noPackage')}</option>
                    {options.packages.map((x) => (
                      <option key={x.id} value={x.id}>
                        {localized(x.name, locale)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              {canManageAll ? (
                <Field label={t('crm.deal.owner')}>
                  {(p) => (
                    <NativeSelect {...p} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                      {options.owners.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={save.pending} disabled={!title.trim()} data-testid="deal-save">
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PipelineBoard({
  deals,
  pipeline,
  options,
  today,
  staleDays,
  me,
  canManage,
  canManageAll,
}: {
  deals: DealCard[];
  pipeline: PipelineWithStages;
  options: CrmOptions;
  today: string;
  staleDays: number;
  me: string;
  canManage: boolean;
  canManageAll: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const dndId = useId();
  const [owner, setOwner] = useState('');
  const [creating, setCreating] = useState(false);
  const [pendingLost, setPendingLost] = useState<{ dealId: string; stageId: string } | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [optimistic, applyMove] = useOptimistic(deals, (state, move: { dealId: string; stageId: string }) =>
    state.map((d) => (d.id === move.dealId ? { ...d, stageId: move.stageId } : d)),
  );
  const move = useAction(moveDealAction);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeys }),
  );
  const visible = useMemo(() => optimistic.filter((d) => !owner || d.owner?.id === owner), [optimistic, owner]);
  const stageName = (id: string) => localized(pipeline.stages.find((s) => s.id === id)?.name ?? {}, locale);
  const titleOf = (id: string | number) => deals.find((d) => d.id === String(id))?.title ?? '';

  const commit = (dealId: string, stageId: string, lost?: { reason: LostReason; note: string }) => {
    startTransition(async () => {
      applyMove({ dealId, stageId });
      const res = await move.run({ dealId, stageId, lostReason: lost?.reason ?? null, lostNote: lost?.note ?? null });
      if (res.ok && res.data.status === 'won') toast.success(t('crm.pipeline.won'));
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const dealId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    const deal = deals.find((d) => d.id === dealId);
    if (!stageId || !deal || deal.stageId === stageId) return;
    const stage = pipeline.stages.find((s) => s.id === stageId);
    if (stage?.kind === 'lost') return setPendingLost({ dealId, stageId });
    commit(dealId, stageId);
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => t('crm.pipeline.dnd.picked', { title: titleOf(active.id) }),
    onDragOver: ({ over }) => (over ? t('crm.pipeline.dnd.over', { stage: stageName(String(over.id)) }) : t('crm.pipeline.dnd.outside')),
    onDragEnd: ({ active, over }) =>
      over
        ? t('crm.pipeline.dnd.dropped', { title: titleOf(active.id), stage: stageName(String(over.id)) })
        : t('crm.pipeline.dnd.cancelled'),
    onDragCancel: () => t('crm.pipeline.dnd.cancelled'),
  };

  const active = activeId ? optimistic.find((d) => d.id === activeId) : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {options.pipelines.length > 1 ? (
          <NativeSelect
            aria-label={t('crm.pipeline.pipeline')}
            value={pipeline.id}
            onChange={(e) => router.push(`${pathname}?pipeline=${e.target.value}`)}
            className="min-w-48"
          >
            {options.pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {localized(p.name, locale)}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        <NativeSelect
          aria-label={t('crm.deal.owner')}
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          className="min-w-44"
          data-testid="board-owner"
        >
          <option value="">{t('crm.pipeline.allOwners')}</option>
          {options.owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </NativeSelect>
        <div className="flex-1" />
        {canManage ? (
          <Button onClick={() => setCreating(true)} data-testid="deal-new">
            <Plus />
            {t('crm.pipeline.newDeal')}
          </Button>
        ) : null}
      </div>
      {pipeline.stages.length === 0 ? (
        <Card>
          <EmptyState icon={Columns3} title={t('crm.pipeline.noPipeline')} description={t('crm.pipeline.noPipelineBody')} />
        </Card>
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setActiveId(String(e.active.id))}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
          accessibility={{ announcements, screenReaderInstructions: { draggable: t('crm.pipeline.dnd.instructions') } }}
        >
          <div className="-mx-(--gutter) overflow-x-auto px-(--gutter) pb-4" data-testid="pipeline-board">
            <div className="flex gap-3">
              {pipeline.stages.map((s) => (
                <StageColumn
                  key={s.id}
                  stage={s}
                  deals={visible.filter((d) => d.stageId === s.id)}
                  today={today}
                  staleDays={staleDays}
                  canMove={canManage}
                />
              ))}
            </div>
          </div>
          <DragOverlay>{active ? <DealCardView deal={active} today={today} staleDays={staleDays} dragging /> : null}</DragOverlay>
        </DndContext>
      )}
      <LostDialog
        key={pendingLost?.dealId ?? 'none'}
        open={pendingLost !== null}
        onCancel={() => setPendingLost(null)}
        onConfirm={(reason, note) => {
          if (pendingLost) commit(pendingLost.dealId, pendingLost.stageId, { reason, note });
          setPendingLost(null);
        }}
      />
      {canManage ? (
        <DealDialog
          open={creating}
          onOpenChange={setCreating}
          options={options}
          pipelineId={pipeline.id}
          me={me}
          canManageAll={canManageAll}
        />
      ) : null}
    </div>
  );
}
