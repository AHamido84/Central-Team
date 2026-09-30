'use client';

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowUp,
  CheckCheck,
  ChevronDown,
  Clock,
  FileBox,
  GripVertical,
  Link2,
  Plus,
  ScanEye,
  Settings2,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';

import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { Badge, Card, Checkbox, NativeSelect, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import { DeleteDialog } from '@/modules/data/components/delete-dialog';
import { dayInZone } from '@/modules/tasks/constants';
import { TemplateSettingsDialog, type RequestTypeOption } from '@/modules/workflows/components/templates-admin';
import {
  assigneeModes,
  deliverableTypes,
  dependents,
  MAX_STEPS,
  scheduleSteps,
  type AssigneeMode,
  type DeliverableType,
} from '@/modules/workflows/constants';
import { saveStepsSchema, type TemplateStepInput } from '@/modules/workflows/schemas';
import { saveTemplateStepsAction } from '@/modules/workflows/server/actions';
import type { TemplateDetail } from '@/modules/workflows/server/queries';

type Option = { id: string; name: LocalizedText | string };
type Step = TemplateStepInput;

const toStep = (s: TemplateDetail['steps'][number]): Step => ({
  id: s.id,
  name: { ar: s.name.ar ?? '', en: s.name.en ?? '' },
  description: { ar: s.description.ar ?? '', en: s.description.en ?? '' },
  departmentId: s.departmentId,
  assigneeMode: s.assigneeMode,
  assigneeRoleId: s.assigneeRoleId,
  assigneeUserId: s.assigneeUserId,
  slaDays: s.slaDays,
  dependsOn: s.dependsOn,
  requiresInternalReview: s.requiresInternalReview,
  requiresClientApproval: s.requiresClientApproval,
  deliverableType: s.deliverableType,
});

function StepCard({
  step,
  index,
  steps,
  departments,
  roles,
  people,
  error,
  onChange,
  onMove,
  onRemove,
}: {
  step: Step;
  index: number;
  steps: Step[];
  departments: Option[];
  roles: Option[];
  people: Option[];
  error?: string;
  onChange: (s: Step) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(!step.name.ar && !step.name.en);
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({ id: step.id });
  const set = (patch: Partial<Step>) => onChange({ ...step, ...patch });
  const name = (o: Option) => (typeof o.name === 'string' ? o.name : localized(o.name, locale));
  const title = localized(step.name, locale) || t('workflows.builder.untitled');
  const dept = departments.find((d) => d.id === step.departmentId);
  const blocked = dependents(
    steps.map((s, i) => ({ ...s, sortOrder: i })),
    step.id,
  );
  const choices = steps.filter((s) => s.id !== step.id && !blocked.has(s.id));
  const after = steps.filter((s) => step.dependsOn.includes(s.id));

  return (
    <Card
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('overflow-hidden', isDragging && 'z-10 shadow-lg ring-2 ring-primary', error && 'border-danger/50')}
      data-testid="workflow-step"
    >
      <div className="flex items-center gap-1.5 p-2 sm:gap-2 sm:p-3">
        <button
          type="button"
          className="cursor-grab touch-none rounded p-1 text-subtle-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
          aria-label={t('workflows.builder.dragStep', { name: title })}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-foreground">
          {index + 1}
        </span>
        <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-subtle-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden />
              {t('workflows.builder.days', { count: step.slaDays })}
            </span>
            {dept ? <span>· {name(dept)}</span> : null}
            {after.length ? (
              <span className="inline-flex items-center gap-1">
                · <Link2 className="size-3" aria-hidden />
                {after.map((a) => localized(a.name, locale) || t('workflows.builder.untitled')).join('، ')}
              </span>
            ) : null}
          </span>
        </button>
        <div className="hidden flex-wrap gap-1 md:flex">
          {step.deliverableType ? (
            <Badge tone="outline">
              <FileBox />
              {t(`workflows.deliverableTypes.${step.deliverableType}`)}
            </Badge>
          ) : null}
          {step.requiresInternalReview ? (
            <Badge tone="info">
              <ScanEye />
              {t('workflows.builder.internalReviewShort')}
            </Badge>
          ) : null}
          {step.requiresClientApproval ? (
            <Badge tone="brand">
              <CheckCheck />
              {t('workflows.builder.clientApprovalShort')}
            </Badge>
          ) : null}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => onMove(-1)} disabled={index === 0} aria-label={t('workflows.builder.moveUp')}>
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onMove(1)}
          disabled={index === steps.length - 1}
          aria-label={t('workflows.builder.moveDown')}
        >
          <ArrowDown />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          disabled={steps.length <= 1}
          aria-label={t('workflows.builder.removeStep')}
        >
          <Trash2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen((o) => !o)}
          aria-label={t('workflows.builder.editStep')}
          aria-expanded={open}
        >
          <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
      </div>
      {error ? <p className="px-4 pb-2 text-xs text-danger">{error}</p> : null}
      {open ? (
        <div className="grid gap-4 border-t border-border bg-surface-muted/40 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.nameAr')}>
              {(p) => (
                <Input
                  {...p}
                  dir="rtl"
                  lang="ar"
                  value={step.name.ar}
                  onChange={(e) => set({ name: { ...step.name, ar: e.target.value } })}
                  data-testid="step-name-ar"
                />
              )}
            </Field>
            <Field label={t('admin.nameEn')}>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  lang="en"
                  value={step.name.en}
                  onChange={(e) => set({ name: { ...step.name, en: e.target.value } })}
                  data-testid="step-name-en"
                />
              )}
            </Field>
            <Field label={t('workflows.builder.instructionsAr')} optional>
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  dir="rtl"
                  lang="ar"
                  value={step.description.ar}
                  onChange={(e) => set({ description: { ...step.description, ar: e.target.value } })}
                />
              )}
            </Field>
            <Field label={t('workflows.builder.instructionsEn')} optional>
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  dir="ltr"
                  lang="en"
                  value={step.description.en}
                  onChange={(e) => set({ description: { ...step.description, en: e.target.value } })}
                />
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('workflows.builder.department')} optional>
              {(p) => (
                <NativeSelect {...p} value={step.departmentId ?? ''} onChange={(e) => set({ departmentId: e.target.value || null })}>
                  <option value="">{t('workflows.builder.noDepartment')}</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {name(d)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label={t('workflows.builder.assignee')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={step.assigneeMode}
                  onChange={(e) => set({ assigneeMode: e.target.value as AssigneeMode })}
                  data-testid="step-assignee-mode"
                >
                  {assigneeModes.map((m) => (
                    <option key={m} value={m}>
                      {t(`workflows.assigneeModes.${m}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            {step.assigneeMode === 'role' ? (
              <Field label={t('workflows.builder.role')}>
                {(p) => (
                  <NativeSelect {...p} value={step.assigneeRoleId ?? ''} onChange={(e) => set({ assigneeRoleId: e.target.value || null })}>
                    <option value="">{t('workflows.builder.choose')}</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {name(r)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            ) : step.assigneeMode === 'user' ? (
              <Field label={t('workflows.builder.person')}>
                {(p) => (
                  <NativeSelect {...p} value={step.assigneeUserId ?? ''} onChange={(e) => set({ assigneeUserId: e.target.value || null })}>
                    <option value="">{t('workflows.builder.choose')}</option>
                    {people.map((r) => (
                      <option key={r.id} value={r.id}>
                        {name(r)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            ) : (
              <p className="self-end pb-2 text-xs text-muted-foreground">{t(`workflows.assigneeHints.${step.assigneeMode}`)}</p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('workflows.builder.slaDays')} hint={t('workflows.builder.slaDaysHint')}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  dir="ltr"
                  min={0}
                  max={60}
                  value={step.slaDays}
                  onChange={(e) => set({ slaDays: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })}
                  data-testid="step-sla"
                />
              )}
            </Field>
            <Field label={t('workflows.builder.deliverable')} hint={t('workflows.builder.deliverableHint')} optional>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={step.deliverableType ?? ''}
                  onChange={(e) => {
                    const v = (e.target.value || null) as DeliverableType | null;
                    set({ deliverableType: v, ...(v ? {} : { requiresInternalReview: false, requiresClientApproval: false }) });
                  }}
                  data-testid="step-deliverable"
                >
                  <option value="">{t('workflows.builder.noDeliverable')}</option>
                  {deliverableTypes.map((d) => (
                    <option key={d} value={d}>
                      {t(`workflows.deliverableTypes.${d}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3',
                !step.deliverableType && 'opacity-60',
              )}
            >
              <span>
                <span className="block text-sm font-medium">{t('workflows.builder.internalReview')}</span>
                <span className="block text-xs text-muted-foreground">{t('workflows.builder.internalReviewHint')}</span>
              </span>
              <Switch
                checked={step.requiresInternalReview}
                disabled={!step.deliverableType}
                onCheckedChange={(v) => set({ requiresInternalReview: v })}
                data-testid="step-internal-review"
              />
            </label>
            <label
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3',
                !step.deliverableType && 'opacity-60',
              )}
            >
              <span>
                <span className="block text-sm font-medium">{t('workflows.builder.clientApproval')}</span>
                <span className="block text-xs text-muted-foreground">{t('workflows.builder.clientApprovalHint')}</span>
              </span>
              <Switch
                checked={step.requiresClientApproval}
                disabled={!step.deliverableType}
                onCheckedChange={(v) => set({ requiresClientApproval: v })}
                data-testid="step-client-approval"
              />
            </label>
          </div>
          <fieldset className="grid gap-2" data-testid="step-dependencies">
            <legend className="mb-1 text-sm font-medium">{t('workflows.builder.dependsOn')}</legend>
            {choices.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('workflows.builder.noDependencyChoices')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {choices.map((c) => {
                  const checked = step.dependsOn.includes(c.id);
                  return (
                    <label key={c.id} className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          set({ dependsOn: v === true ? [...step.dependsOn, c.id] : step.dependsOn.filter((d) => d !== c.id) })
                        }
                      />
                      {localized(c.name, locale) || t('workflows.builder.untitled')}
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
        </div>
      ) : null}
    </Card>
  );
}

/** The template's steps as a flow: working-day schedule from today, review and approval stages, dependencies. */
function FlowPreview({ steps, today }: { steps: Step[]; today: string }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const f = useFormat();
  const schedule = scheduleSteps(
    steps.map((s, i) => ({ ...s, sortOrder: i })),
    today,
  );
  if (!schedule) return <p className="text-sm text-danger">{t('validation.dependency_cycle')}</p>;
  const last = [...schedule.values()].reduce((m, s) => (s.dueDate > m ? s.dueDate : m), today);
  return (
    <div className="space-y-3" data-testid="workflow-preview">
      <ol className="relative space-y-3 border-s-2 border-border ps-5">
        {steps.map((s) => {
          const sched = schedule.get(s.id)!;
          return (
            <li key={s.id} className="relative">
              <span className="absolute -start-[1.6rem] top-1 size-3 rounded-full border-2 border-surface bg-primary" aria-hidden />
              <p className="text-sm font-medium">{localized(s.name, locale) || t('workflows.builder.untitled')}</p>
              <p className="tabular text-xs text-muted-foreground">
                {t('workflows.builder.range', {
                  start: f.date(`${sched.startDate}T12:00:00`, 'short'),
                  end: f.date(`${sched.dueDate}T12:00:00`, 'short'),
                })}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {s.deliverableType ? <Badge tone="outline">{t(`workflows.deliverableTypes.${s.deliverableType}`)}</Badge> : null}
                {s.requiresInternalReview ? <Badge tone="info">{t('workflows.builder.internalReviewShort')}</Badge> : null}
                {s.requiresClientApproval ? <Badge tone="brand">{t('workflows.builder.clientApprovalShort')}</Badge> : null}
                {s.assigneeMode !== 'none' ? (
                  <Badge tone="neutral">
                    <UserRound />
                    {t(`workflows.assigneeModes.${s.assigneeMode}`)}
                  </Badge>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-muted-foreground">{t('workflows.builder.finishes', { date: f.date(`${last}T12:00:00`, 'long') })}</p>
    </div>
  );
}

export function WorkflowBuilder({
  template,
  departments,
  roles,
  people,
  requestTypes,
  timeZone,
  canDelete,
}: {
  canDelete: boolean;
  template: TemplateDetail;
  departments: Option[];
  roles: Option[];
  people: Option[];
  requestTypes: RequestTypeOption[];
  timeZone: string;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [steps, setSteps] = useState<Step[]>(() => template.steps.map(toStep));
  const dndId = useId();
  const [dirty, setDirty] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const save = useAction(saveTemplateStepsAction, { successMessage: t('workflows.builder.saved'), onSuccess: () => setDirty(false) });
  const [deleting, setDeleting] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const today = useMemo(() => dayInZone(new Date(), timeZone), [timeZone]);

  const parsed = useMemo(() => saveStepsSchema.safeParse({ templateId: template.id, steps }), [steps, template.id]);
  const errors = useMemo(() => {
    const out: Record<number, string> = {};
    let general: string | null = null;
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const idx = issue.path[0] === 'steps' && typeof issue.path[1] === 'number' ? issue.path[1] : -1;
        const key = `validation.${issue.message}` as Parameters<typeof t>[0];
        const text = t.has(key) ? t(key) : issue.message;
        if (idx >= 0) out[idx] ??= text;
        else general ??= text;
      }
    }
    return { byStep: out, general };
  }, [parsed, t]);

  const update = (next: Step[]) => {
    setSteps(next);
    setDirty(true);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= steps.length) return;
    update(arrayMove(steps, from, to));
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    move(
      steps.findIndex((s) => s.id === e.active.id),
      steps.findIndex((s) => s.id === e.over!.id),
    );
  };
  const addStep = () => {
    const last = steps[steps.length - 1];
    update([
      ...steps,
      {
        id: crypto.randomUUID(),
        name: { ar: '', en: '' },
        description: { ar: '', en: '' },
        departmentId: null,
        assigneeMode: 'none',
        assigneeRoleId: null,
        assigneeUserId: null,
        slaDays: 1,
        dependsOn: last ? [last.id] : [],
        requiresInternalReview: false,
        requiresClientApproval: false,
        deliverableType: null,
      },
    ]);
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={template.isActive ? 'success' : 'neutral'} dot>
                {template.isActive ? t('workflows.active') : t('workflows.inactive')}
              </Badge>
              {template.isDefault ? <Badge tone="brand">{t('workflows.default')}</Badge> : null}
              {dirty ? <Badge tone="info">{t('workflows.builder.unsaved')}</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {template.requestTypeName
                ? t('workflows.forType', { type: localized(template.requestTypeName, locale) })
                : t('workflows.anyType')}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} data-testid="edit-workflow-settings">
              <Settings2 />
              {t('workflows.editSettings')}
            </Button>
            {canDelete ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('workflows.delete')}
                  onClick={() => setDeleting(true)}
                  data-testid="template-delete"
                >
                  <Trash2 />
                </Button>
                <DeleteDialog
                  type="workflow_template"
                  id={template.id}
                  open={deleting}
                  onOpenChange={setDeleting}
                  onDeleted={() => router.push('/admin/workflows')}
                />
              </>
            ) : null}
          </div>
        </Card>

        <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="grid gap-3" data-testid="workflow-steps">
              {steps.map((s, i) => (
                <StepCard
                  key={s.id}
                  step={s}
                  index={i}
                  steps={steps}
                  departments={departments}
                  roles={roles}
                  people={people}
                  error={errors.byStep[i]}
                  onChange={(next) => update(steps.map((x) => (x.id === s.id ? next : x)))}
                  onMove={(d) => move(i, i + d)}
                  onRemove={() =>
                    update(steps.filter((x) => x.id !== s.id).map((x) => ({ ...x, dependsOn: x.dependsOn.filter((d) => d !== s.id) })))
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <Button variant="soft" onClick={addStep} disabled={steps.length >= MAX_STEPS} data-testid="add-step">
          <Plus />
          {t('workflows.builder.addStep')}
        </Button>
        <div className="sticky bottom-0 z-10 -mx-(--gutter) flex flex-wrap items-center gap-3 border-t border-border bg-surface/95 px-(--gutter) py-3 backdrop-blur">
          <p className="me-auto text-sm text-muted-foreground">
            {errors.general ?? (dirty ? t('workflows.builder.unsavedHint') : t('workflows.builder.upToDate'))}
          </p>
          <Button
            onClick={() => parsed.success && void save.run(parsed.data)}
            disabled={!dirty || !parsed.success}
            loading={save.pending}
            data-testid="save-workflow"
          >
            {t('workflows.builder.save')}
          </Button>
        </div>
      </div>
      <aside className="min-w-0 xl:sticky xl:top-20 xl:self-start">
        <Card className="p-5">
          <h2 className="mb-1 font-semibold">{t('workflows.builder.previewTitle')}</h2>
          <p className="mb-4 text-xs text-muted-foreground">{t('workflows.builder.previewHint')}</p>
          <FlowPreview steps={steps} today={today} />
        </Card>
      </aside>
      <TemplateSettingsDialog template={template} requestTypes={requestTypes} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
