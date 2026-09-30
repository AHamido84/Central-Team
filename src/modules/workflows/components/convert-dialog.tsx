'use client';

import { ArrowDown, ArrowUp, CheckCheck, ListTodo, Plus, ScanEye, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Checkbox, NativeSelect, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { taskPriorities, type TaskPriority } from '@/modules/tasks/constants';
import { planDependents, schedulePlan, type PlanItem } from '@/modules/workflows/plan';
import { convertRequestToTasksAction, previewConversionAction } from '@/modules/workflows/server/actions';
import type { TemplateDetail } from '@/modules/workflows/server/queries';

type Option = { id: string; name: string };

/**
 * "Convert to tasks" (FR1.3): pick the workflow and start date, then review the proposed tasks — rename, reassign,
 * change department / reviewer / dates / priority, reorder, change what each waits for, remove steps, add tasks outside
 * the workflow — and only then create them. Dates recompute on every change unless typed by hand.
 */
export function ConvertToTasksButton({
  requestId,
  templates,
  today,
  canManageWorkflows,
  people = [],
  departments = [],
}: {
  requestId: string;
  templates: TemplateDetail[];
  today: string;
  canManageWorkflows: boolean;
  people?: Option[];
  departments?: { id: string; name: LocalizedText }[];
}) {
  const t = useTranslations('workflows.convert');
  const tr = useTranslations('requests');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [start, setStart] = useState(today);
  const [items, setItems] = useState<PlanItem[] | null>(null);
  const preview = useAction(previewConversionAction, { refresh: false });
  const convert = useAction(convertRequestToTasksAction, { successMessage: t('done') });
  const template = templates.find((x) => x.id === templateId);

  const update = (next: PlanItem[]) => setItems(schedulePlan(next, start));
  const patch = (key: string, p: Partial<PlanItem>) => items && update(items.map((i) => (i.key === key ? { ...i, ...p } : i)));
  const move = (index: number, by: -1 | 1) => {
    if (!items) return;
    const next = [...items];
    const [it] = next.splice(index, 1);
    next.splice(index + by, 0, it!);
    update(next);
  };
  const remove = (key: string) =>
    items && update(items.filter((i) => i.key !== key).map((i) => ({ ...i, dependsOn: i.dependsOn.filter((d) => d !== key) })));
  const add = () =>
    items &&
    update([
      ...items,
      {
        key: crypto.randomUUID(),
        stepId: null,
        title: t('newTask'),
        departmentId: null,
        assigneeId: null,
        reviewerId: null,
        priority: 'normal',
        durationDays: 1,
        startDate: start,
        dueDate: start,
        manualDates: false,
        dependsOn: items.length ? [items[items.length - 1]!.key] : [],
        deliverableType: null,
        requiresInternalReview: false,
        requiresClientApproval: false,
      },
    ]);

  const close = (o: boolean) => {
    setOpen(o);
    if (!o) setItems(null);
  };
  const valid = Boolean(items?.length) && items!.every((i) => i.title.trim() && i.startDate <= i.dueDate);

  return (
    <>
      <Button variant="soft" onClick={() => setOpen(true)} data-testid="convert-to-tasks">
        <ListTodo />
        {t('button')}
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent closeLabel={t('close')} size={items ? 'xl' : 'lg'}>
          <DialogHeader>
            <DialogTitle>{items ? t('reviewTitle') : t('title')}</DialogTitle>
            <DialogDescription>{items ? t('reviewHint') : t('description')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4" data-testid="convert-dialog" data-step={items ? 'review' : 'pick'}>
            {templates.length === 0 ? (
              <div className="grid gap-2 text-sm text-muted-foreground">
                <p>{t('noTemplates')}</p>
                {canManageWorkflows ? (
                  <Link href="/admin/workflows" className="text-link hover:underline">
                    {t('manage')}
                  </Link>
                ) : null}
              </div>
            ) : !items ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('template')}>
                  {(p) => (
                    <NativeSelect {...p} value={templateId} onChange={(e) => setTemplateId(e.target.value)} data-testid="convert-template">
                      {templates.map((x) => (
                        <option key={x.id} value={x.id}>
                          {localized(x.name, locale)}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field label={t('startDate')}>
                  {(p) => (
                    <Input {...p} type="date" dir="ltr" value={start} min={today} onChange={(e) => setStart(e.target.value || today)} />
                  )}
                </Field>
              </div>
            ) : (
              <>
                <ol className="grid gap-3" data-testid="convert-review">
                  {items.map((item, index) => (
                    <PlanRow
                      key={item.key}
                      item={item}
                      index={index}
                      items={items}
                      people={people}
                      departments={departments}
                      onPatch={(p) => patch(item.key, p)}
                      onMove={(by) => move(index, by)}
                      onRemove={() => remove(item.key)}
                      priorityLabel={(p) => tr(`priorities.${p}`)}
                    />
                  ))}
                </ol>
                {items.length === 0 ? <p className="text-sm text-danger">{t('empty')}</p> : null}
                <Button variant="outline" onClick={add} className="justify-self-start" data-testid="plan-add">
                  <Plus />
                  {t('addTask')}
                </Button>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            {items ? (
              <>
                <Button variant="ghost" onClick={() => setItems(null)}>
                  {t('back')}
                </Button>
                <Button
                  disabled={!valid}
                  loading={convert.pending}
                  onClick={async () => {
                    const res = await convert.run({ requestId, templateId, startDate: start, plan: items });
                    if (res.ok) {
                      close(false);
                      router.refresh();
                    }
                  }}
                  data-testid="convert-confirm"
                >
                  {t('confirmCount', { count: items.length })}
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => close(false)}>
                  {t('cancel')}
                </Button>
                <Button
                  disabled={!template}
                  loading={preview.pending}
                  onClick={async () => {
                    const res = await preview.run({ requestId, templateId, startDate: start });
                    if (res.ok) {
                      setStart(res.data.start);
                      setItems(res.data.items);
                    }
                  }}
                  data-testid="convert-review-button"
                >
                  {t('review')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PlanRow({
  item,
  index,
  items,
  people,
  departments,
  onPatch,
  onMove,
  onRemove,
  priorityLabel,
}: {
  item: PlanItem;
  index: number;
  items: PlanItem[];
  people: Option[];
  departments: { id: string; name: LocalizedText }[];
  onPatch: (p: Partial<PlanItem>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  priorityLabel: (p: TaskPriority) => string;
}) {
  const t = useTranslations('workflows');
  const locale = useLocale() as Locale;
  const blocked = planDependents(items, item.key);
  const candidates = items.filter((o) => o.key !== item.key && !blocked.has(o.key));
  const waitsFor = items.filter((o) => item.dependsOn.includes(o.key));
  return (
    <li className="grid gap-3 rounded-lg border border-border p-3" data-testid="plan-item" data-step={item.stepId ?? 'adhoc'}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-foreground">
          {index + 1}
        </span>
        <Input
          value={item.title}
          maxLength={200}
          dir="auto"
          aria-label={t('convert.taskTitle')}
          onChange={(e) => onPatch({ title: e.target.value })}
          className="h-8 min-w-48 flex-1"
          data-testid="plan-title"
        />
        {!item.stepId ? <Badge tone="warning">{t('convert.outsideWorkflow')}</Badge> : null}
        {item.requiresInternalReview ? (
          <Badge tone="info">
            <ScanEye />
            {t('builder.internalReviewShort')}
          </Badge>
        ) : null}
        {item.requiresClientApproval ? (
          <Badge tone="brand">
            <CheckCheck />
            {t('builder.clientApprovalShort')}
          </Badge>
        ) : null}
        <span className="ms-auto flex gap-1">
          <Button variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label={t('convert.moveUp')}>
            <ArrowUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={index === items.length - 1}
            onClick={() => onMove(1)}
            aria-label={t('convert.moveDown')}
            data-testid="plan-move-down"
          >
            <ArrowDown />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-danger"
            onClick={onRemove}
            aria-label={t('convert.remove')}
            data-testid="plan-remove"
          >
            <Trash2 />
          </Button>
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Select label={t('convert.assignee')} value={item.assigneeId} onChange={(v) => onPatch({ assigneeId: v })} testId="plan-assignee">
          <option value="">{t('convert.nobody')}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select
          label={t('convert.reviewer')}
          value={item.reviewerId}
          onChange={(v) => onPatch({ reviewerId: v, requiresInternalReview: Boolean(v) })}
          testId="plan-reviewer"
        >
          <option value="">{t('convert.nobody')}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select
          label={t('convert.department')}
          value={item.departmentId}
          onChange={(v) => onPatch({ departmentId: v })}
          testId="plan-department"
        >
          <option value="">{t('convert.none')}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {localized(d.name, locale)}
            </option>
          ))}
        </Select>
        <Select
          label={t('convert.priority')}
          value={item.priority}
          onChange={(v) => onPatch({ priority: (v ?? 'normal') as TaskPriority })}
          testId="plan-priority"
        >
          {taskPriorities.map((p) => (
            <option key={p} value={p}>
              {priorityLabel(p)}
            </option>
          ))}
        </Select>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          {t('convert.duration')}
          <Input
            type="number"
            dir="ltr"
            min={0}
            max={365}
            value={item.durationDays}
            onChange={(e) => onPatch({ durationDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)), manualDates: false })}
            className="h-8"
            data-testid="plan-duration"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          {t('convert.start')}
          <Input
            type="date"
            dir="ltr"
            value={item.startDate}
            onChange={(e) => e.target.value && onPatch({ startDate: e.target.value, manualDates: true })}
            className="h-8"
            data-testid="plan-start"
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          {t('convert.due')}
          <Input
            type="date"
            dir="ltr"
            value={item.dueDate}
            min={item.startDate}
            onChange={(e) => e.target.value && onPatch({ dueDate: e.target.value, manualDates: true })}
            className="h-8"
            data-testid="plan-due"
          />
        </label>
        <div className="grid gap-1 text-xs font-medium text-muted-foreground">
          {t('convert.dependsOn')}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 justify-start truncate font-normal" data-testid="plan-deps">
                {waitsFor.length ? waitsFor.map((w) => items.indexOf(w) + 1).join('، ') : t('convert.noDependencies')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="grid max-h-72 w-72 gap-1 overflow-y-auto p-2">
              {candidates.map((o) => (
                <label key={o.key} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface-muted">
                  <Checkbox
                    checked={item.dependsOn.includes(o.key)}
                    onCheckedChange={(on) =>
                      onPatch({ dependsOn: on ? [...item.dependsOn, o.key] : item.dependsOn.filter((d) => d !== o.key) })
                    }
                  />
                  <span className="tabular text-xs text-subtle-foreground">{items.indexOf(o) + 1}</span>
                  <span className="min-w-0 truncate" dir="auto">
                    {o.title}
                  </span>
                </label>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </li>
  );
}

function Select({
  label,
  value,
  onChange,
  testId,
  children,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <NativeSelect value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className="h-8 text-sm" data-testid={testId}>
        {children}
      </NativeSelect>
    </label>
  );
}
