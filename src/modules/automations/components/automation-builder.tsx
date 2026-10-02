'use client';

import { ArrowDown, ArrowUp, Check, FlaskConical, Info, Plus, Save, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/overlays';
import {
  Badge,
  Card,
  Checkbox,
  NativeSelect,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { labelKey } from '@/modules/automations/components/labels';
import {
  actionSubjects,
  actionTypes,
  notifyRecipients,
  opsByType,
  settableStatuses,
  triggerCatalog,
  triggerDefinition,
  valuelessOps,
  type ActionType,
  type ConditionOp,
  type TriggerField,
  type TriggerType,
} from '@/modules/automations/constants';
import { deleteAutomationAction, dryRunAutomationAction, saveAutomationAction } from '@/modules/automations/server/actions';
import type { AutomationDetail, AutomationRunItem, BuilderOptions, RecentEvent } from '@/modules/automations/server/queries';
import type { AutomationAction, AutomationCondition } from '@/modules/automations/types';

let seq = 0;
const newId = () => `a${Date.now().toString(36)}${(++seq).toString(36)}`;

function defaultAction(type: ActionType): AutomationAction {
  const id = newId();
  switch (type) {
    case 'notify':
      return { id, type, config: { recipients: ['owner'], userIds: [], title: '', body: '' } };
    case 'assign':
      return { id, type, config: { userIds: [] } };
    case 'create_task':
      return { id, type, config: { title: '', description: '', dueInDays: 1, priority: 'normal', assigneeIds: [], departmentId: null } };
    case 'change_status':
      return { id, type, config: { status: 'contacted' } };
    case 'send_whatsapp':
      return { id, type, config: { to: 'record', phone: '', templateId: '', params: [] } };
    case 'webhook':
      return { id, type, config: { url: 'https://' } };
  }
}

function PeoplePicker({
  people,
  value,
  onChange,
  label,
}: {
  people: BuilderOptions['people'];
  value: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  const t = useTranslations('automations');
  const format = useFormat();
  const names = people.filter((p) => value.includes(p.id)).map((p) => p.name);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between font-normal" aria-label={label}>
          <span className="truncate">{names.length ? format.list(names) : t('pickPeople')}</span>
          <Badge tone="neutral">{value.length}</Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-72 w-72 overflow-y-auto p-2" align="start">
        {people.map((p) => (
          <label key={p.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-muted">
            <Checkbox
              checked={value.includes(p.id)}
              onCheckedChange={(c) => onChange(c === true ? [...value, p.id] : value.filter((x) => x !== p.id))}
            />
            <bdi>{p.name}</bdi>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ValueInput({
  field,
  op,
  value,
  onChange,
  options,
}: {
  field: TriggerField;
  op: ConditionOp;
  value: AutomationCondition['value'];
  onChange: (v: AutomationCondition['value']) => void;
  options: BuilderOptions;
}) {
  const t = useTranslations('automations');
  const locale = useLocale() as Locale;
  const label = t('value');
  if (valuelessOps.includes(op)) return <span className="text-xs text-subtle-foreground">—</span>;
  const multi = op === 'in' || op === 'not_in';
  const choices: { value: string; label: string }[] | null =
    field.type === 'enum'
      ? (field.options ?? []).map((o) => ({ value: o, label: t(`values.${o}` as never) }))
      : field.type === 'client'
        ? options.clients.map((c) => ({ value: c.id, label: localized(c.name, locale) }))
        : field.type === 'user'
          ? options.people.map((p) => ({ value: p.id, label: p.name }))
          : field.type === 'boolean'
            ? [
                { value: 'true', label: t('values.true') },
                { value: 'false', label: t('values.false') },
              ]
            : null;
  if (choices && multi) {
    const list = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-1" role="group" aria-label={label}>
        {choices.map((c) => (
          <label key={c.value} className="flex items-center gap-1.5 text-sm">
            <Checkbox
              checked={list.includes(c.value)}
              onCheckedChange={(v) => onChange(v === true ? [...list, c.value] : list.filter((x) => x !== c.value))}
            />
            {c.label}
          </label>
        ))}
      </div>
    );
  }
  if (choices)
    return (
      <NativeSelect aria-label={label} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} data-testid="condition-value">
        <option value="">{t('choose')}</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </NativeSelect>
    );
  return (
    <Input
      aria-label={label}
      type={field.type === 'number' ? 'number' : 'text'}
      value={value === undefined || value === null ? '' : String(value)}
      onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
      data-testid="condition-value"
    />
  );
}

function ActionEditor({
  action,
  onChange,
  options,
  subject,
  signingKey,
}: {
  action: AutomationAction;
  onChange: (a: AutomationAction) => void;
  options: BuilderOptions;
  subject: string;
  signingKey: string;
}) {
  const t = useTranslations('automations');
  const locale = useLocale() as Locale;
  switch (action.type) {
    case 'notify': {
      const c = action.config;
      const set = (patch: Partial<typeof c>) => onChange({ ...action, config: { ...c, ...patch } });
      return (
        <div className="grid gap-3">
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t('recipients')}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {notifyRecipients.map((r) => (
                <label key={r} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={c.recipients.includes(r)}
                    onCheckedChange={(v) => set({ recipients: v === true ? [...c.recipients, r] : c.recipients.filter((x) => x !== r) })}
                  />
                  {t(`recipientTypes.${r}`)}
                </label>
              ))}
            </div>
          </fieldset>
          {c.recipients.includes('users') ? (
            <PeoplePicker
              people={options.people}
              value={c.userIds}
              onChange={(userIds) => set({ userIds })}
              label={t('recipientTypes.users')}
            />
          ) : null}
          <Field label={t('messageTitle')} required>
            {(p) => (
              <Input {...p} value={c.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} data-testid="notify-title" />
            )}
          </Field>
          <Field label={t('messageBody')} optional>
            {(p) => <Textarea {...p} rows={2} value={c.body} maxLength={500} onChange={(e) => set({ body: e.target.value })} />}
          </Field>
        </div>
      );
    }
    case 'assign':
      return (
        <Field label={t('assignTo')} hint={t('assignHint')}>
          {() => (
            <PeoplePicker
              people={options.people}
              value={action.config.userIds}
              onChange={(userIds) => onChange({ ...action, config: { userIds } })}
              label={t('assignTo')}
            />
          )}
        </Field>
      );
    case 'create_task': {
      const c = action.config;
      const set = (patch: Partial<typeof c>) => onChange({ ...action, config: { ...c, ...patch } });
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('taskTitle')} required className="sm:col-span-2">
            {(p) => (
              <Input {...p} value={c.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} data-testid="task-title" />
            )}
          </Field>
          <Field label={t('taskDescription')} optional className="sm:col-span-2">
            {(p) => <Textarea {...p} rows={2} value={c.description} onChange={(e) => set({ description: e.target.value })} />}
          </Field>
          <Field label={t('dueInDays')}>
            {(p) => (
              <Input
                {...p}
                type="number"
                min={0}
                max={365}
                value={c.dueInDays}
                onChange={(e) => set({ dueInDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })}
              />
            )}
          </Field>
          <Field label={t('priority')}>
            {(p) => (
              <NativeSelect {...p} value={c.priority} onChange={(e) => set({ priority: e.target.value as typeof c.priority })}>
                {(['low', 'normal', 'high', 'urgent'] as const).map((x) => (
                  <option key={x} value={x}>
                    {t(`values.${x}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('department')} optional>
            {(p) => (
              <NativeSelect {...p} value={c.departmentId ?? ''} onChange={(e) => set({ departmentId: e.target.value || null })}>
                <option value="">{t('none')}</option>
                {options.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {localized(d.name, locale)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('assignees')} optional>
            {() => (
              <PeoplePicker
                people={options.people}
                value={c.assigneeIds}
                onChange={(assigneeIds) => set({ assigneeIds })}
                label={t('assignees')}
              />
            )}
          </Field>
        </div>
      );
    }
    case 'change_status': {
      const list = (settableStatuses as Record<string, readonly string[]>)[subject] ?? [];
      return (
        <Field label={t('newStatus')}>
          {(p) => (
            <NativeSelect {...p} value={action.config.status} onChange={(e) => onChange({ ...action, config: { status: e.target.value } })}>
              {list.map((s) => (
                <option key={s} value={s}>
                  {t(`values.${s}` as never)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      );
    }
    case 'send_whatsapp': {
      const c = action.config;
      const set = (patch: Partial<typeof c>) => onChange({ ...action, config: { ...c, ...patch } });
      const template = options.templates.find((x) => x.id === c.templateId);
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('sendTo')}>
            {(p) => (
              <NativeSelect {...p} value={c.to} onChange={(e) => set({ to: e.target.value as 'record' | 'phone' })}>
                <option value="record">{t('sendToRecord')}</option>
                <option value="phone">{t('sendToPhone')}</option>
              </NativeSelect>
            )}
          </Field>
          {c.to === 'phone' ? (
            <Field label={t('phone')}>
              {(p) => <Input {...p} dir="ltr" inputMode="tel" value={c.phone} onChange={(e) => set({ phone: e.target.value })} />}
            </Field>
          ) : (
            <div />
          )}
          <Field label={t('template')} className="sm:col-span-2" hint={!options.templates.length ? t('noTemplates') : undefined}>
            {(p) => (
              <NativeSelect
                {...p}
                value={c.templateId}
                onChange={(e) => {
                  const next = options.templates.find((x) => x.id === e.target.value);
                  set({ templateId: e.target.value, params: Array.from({ length: next?.paramCount ?? 0 }, (_, i) => c.params[i] ?? '') });
                }}
              >
                <option value="">{t('choose')}</option>
                {options.templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {x.language.toUpperCase()}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          {template?.body ? <p className="text-xs whitespace-pre-line text-muted-foreground sm:col-span-2">{template.body}</p> : null}
          {c.params.map((v, i) => (
            <Field key={i} label={t('param', { n: i + 1 })}>
              {(p) => (
                <Input
                  {...p}
                  value={v}
                  onChange={(e) => {
                    const params = [...c.params];
                    params[i] = e.target.value;
                    set({ params });
                  }}
                />
              )}
            </Field>
          ))}
        </div>
      );
    }
    case 'webhook':
      return (
        <div className="grid gap-3">
          <Field label={t('webhookUrl')} hint={t('webhookHint')}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                type="url"
                value={action.config.url}
                onChange={(e) => onChange({ ...action, config: { url: e.target.value } })}
              />
            )}
          </Field>
          <div className="text-xs text-muted-foreground">
            <p>{t('signingKey')}</p>
            <code dir="ltr" className="mt-1 block truncate rounded bg-surface-muted px-2 py-1 font-mono">
              {signingKey}
            </code>
          </div>
        </div>
      );
  }
}

function RunLog({ runs }: { runs: AutomationRunItem[] }) {
  const t = useTranslations('automations');
  const format = useFormat();
  if (!runs.length) return <EmptyState icon={Info} title={t('runs.emptyTitle')} description={t('runs.emptyBody')} compact />;
  const tone = { succeeded: 'success', failed: 'danger', skipped: 'neutral', running: 'info' } as const;
  return (
    <ul className="divide-y divide-border" data-testid="run-log">
      {runs.map((r) => (
        <li key={r.id} className="px-5 py-3" data-testid="run-row">
          <details>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
              <Badge tone={tone[r.status]} dot>
                {t(`runs.status.${r.status}`)}
              </Badge>
              {r.dryRun ? <Badge tone="warning">{t('runs.dryRun')}</Badge> : null}
              {r.skipReason ? (
                <span className="text-xs text-muted-foreground">{t(`runs.skip.${r.skipReason as 'conditions'}`)}</span>
              ) : null}
              <span className="text-xs text-subtle-foreground">{format.dateTime(r.startedAt)}</span>
              {r.attempts > 1 ? <span className="text-xs text-subtle-foreground">{t('runs.attempts', { count: r.attempts })}</span> : null}
              {r.depth > 0 ? <span className="text-xs text-subtle-foreground">{t('runs.depth', { depth: r.depth })}</span> : null}
            </summary>
            <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
              <div>
                <p className="mb-1 font-medium text-muted-foreground">{t('conditions')}</p>
                {r.conditions.length ? (
                  <ul className="space-y-1">
                    {r.conditions.map((c, i) => (
                      <li key={i} className={c.passed ? 'flex items-center gap-1 text-success' : 'flex items-center gap-1 text-danger'}>
                        {c.passed ? (
                          <Check className="size-3.5" aria-label={t('runs.passed')} />
                        ) : (
                          <X className="size-3.5" aria-label={t('runs.notPassed')} />
                        )}
                        {t(`fields.${labelKey(c.field)}` as never)} · {t(`ops.${c.op as 'eq'}`)}{' '}
                        <bdi dir="ltr" className="font-mono">
                          {JSON.stringify(c.actual)}
                        </bdi>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-subtle-foreground">{t('runs.noConditions')}</p>
                )}
              </div>
              <div>
                <p className="mb-1 font-medium text-muted-foreground">{t('actions')}</p>
                <ul className="space-y-1">
                  {r.actions.map((a) => (
                    <li key={a.id}>
                      <span
                        className={
                          a.status === 'failed' ? 'text-danger' : a.status === 'succeeded' ? 'text-success' : 'text-muted-foreground'
                        }
                      >
                        {t(`actionTypes.${a.type as 'notify'}`)} · {t(`runs.actionStatus.${a.status}`)}
                      </span>
                      {a.error ? (
                        <span className="text-danger">
                          {' '}
                          ·{' '}
                          <bdi dir="ltr" className="font-mono">
                            {a.error}
                          </bdi>
                        </span>
                      ) : null}
                      {a.output ? (
                        <bdi dir="ltr" className="block truncate font-mono text-subtle-foreground">
                          {JSON.stringify(a.output)}
                        </bdi>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

export function AutomationBuilder({
  automation,
  options,
  events,
  signingKey,
  canManage,
  initialTab = 'rule',
}: {
  automation: AutomationDetail | null;
  options: BuilderOptions;
  events: RecentEvent[];
  signingKey: string;
  canManage: boolean;
  initialTab?: 'rule' | 'test' | 'runs';
}) {
  const t = useTranslations('automations');
  const tc = useTranslations('common');
  const format = useFormat();
  const router = useRouter();
  const [name, setName] = useState(automation?.name ?? '');
  const [description, setDescription] = useState(automation?.description ?? '');
  const [isActive, setIsActive] = useState(automation?.isActive ?? true);
  const [triggerType, setTriggerType] = useState<TriggerType>((automation?.triggerType as TriggerType) ?? 'lead.created');
  const [match, setMatch] = useState<'all' | 'any'>(automation?.match ?? 'all');
  const [conditions, setConditions] = useState<AutomationCondition[]>(automation?.conditions ?? []);
  const [actions, setActions] = useState<AutomationAction[]>(automation?.actions ?? [defaultAction('notify')]);
  const [eventId, setEventId] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const def = triggerDefinition(triggerType)!;
  const fields = def.fields;
  const available = actionTypes.filter(
    (a) => actionSubjects[a] === 'any' || (actionSubjects[a] as readonly string[]).includes(def.subject),
  );
  const placeholders = fields.map((f) => `{{${f.key}}}`);

  const save = useAction(saveAutomationAction, {
    successMessage: tc('saved'),
    onSuccess: (r) => {
      if (!automation) router.push(`/admin/automations/${r.id}`);
    },
  });
  const dryRun = useAction(dryRunAutomationAction, { successMessage: t('dryRunDone') });
  const remove = useAction(deleteAutomationAction, { refresh: false, onSuccess: () => router.push('/admin/automations') });

  const submit = async () => {
    setErrors({});
    const res = await save.run({ id: automation?.id, name, description, isActive, triggerType, match, conditions, actions });
    if (!res.ok && res.error.fieldErrors) setErrors(res.error.fieldErrors);
  };

  const groups = useMemo(() => {
    const out = new Map<string, TriggerType[]>();
    for (const tr of triggerCatalog) out.set(tr.subject, [...(out.get(tr.subject) ?? []), tr.type]);
    return [...out];
  }, []);

  const builder = (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label={t('name')} required error={errors.name?.[0]}>
          {(p) => (
            <Input
              {...p}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              disabled={!canManage}
              data-testid="automation-name"
            />
          )}
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <Switch checked={isActive} onCheckedChange={setIsActive} disabled={!canManage} data-testid="automation-active" />
          {t('active')}
        </label>
        <Field label={t('descriptionLabel')} optional className="sm:col-span-2">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={description}
              maxLength={1000}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canManage}
            />
          )}
        </Field>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">{t('when')}</h2>
        <NativeSelect
          aria-label={t('trigger')}
          value={triggerType}
          disabled={!canManage}
          onChange={(e) => {
            const next = e.target.value as TriggerType;
            setTriggerType(next);
            setConditions([]);
            const nextDef = triggerDefinition(next)!;
            setActions((list) =>
              list.filter(
                (a) => actionSubjects[a.type] === 'any' || (actionSubjects[a.type] as readonly string[]).includes(nextDef.subject),
              ),
            );
          }}
          data-testid="automation-trigger"
        >
          {groups.map(([subject, types]) => (
            <optgroup key={subject} label={t(`subjects.${subject as 'lead'}`)}>
              {types.map((tt) => (
                <option key={tt} value={tt}>
                  {t(`triggers.${labelKey(tt)}` as never)}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('if')}</h2>
          {conditions.length > 1 ? (
            <NativeSelect
              aria-label={t('match')}
              value={match}
              onChange={(e) => setMatch(e.target.value as 'all' | 'any')}
              className="w-auto"
              disabled={!canManage}
            >
              <option value="all">{t('matchAll')}</option>
              <option value="any">{t('matchAny')}</option>
            </NativeSelect>
          ) : null}
        </div>
        {!conditions.length ? <p className="text-xs text-subtle-foreground">{t('noConditions')}</p> : null}
        {conditions.map((c, i) => {
          const field = fields.find((f) => f.key === c.field) ?? fields[0]!;
          const ops = opsByType[field.type];
          return (
            <div
              key={i}
              className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[14rem_10rem_minmax(0,1fr)_auto] md:items-center"
              data-testid="condition-row"
            >
              <NativeSelect
                aria-label={t('field')}
                value={c.field}
                disabled={!canManage}
                onChange={(e) => {
                  const f = fields.find((x) => x.key === e.target.value)!;
                  const next = [...conditions];
                  next[i] = { field: f.key, op: opsByType[f.type][0]!, value: undefined };
                  setConditions(next);
                }}
                data-testid="condition-field"
              >
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {t(`fields.${labelKey(f.key)}` as never)}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label={t('operator')}
                value={c.op}
                disabled={!canManage}
                onChange={(e) => {
                  const next = [...conditions];
                  next[i] = { ...c, op: e.target.value as ConditionOp, value: undefined };
                  setConditions(next);
                }}
                data-testid="condition-op"
              >
                {ops.map((o) => (
                  <option key={o} value={o}>
                    {t(`ops.${o}`)}
                  </option>
                ))}
              </NativeSelect>
              <ValueInput
                field={field}
                op={c.op}
                value={c.value}
                options={options}
                onChange={(value) => {
                  const next = [...conditions];
                  next[i] = { ...c, value };
                  setConditions(next);
                }}
              />
              {canManage ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('removeCondition')}
                  onClick={() => setConditions(conditions.filter((_, j) => j !== i))}
                >
                  <X aria-hidden />
                </Button>
              ) : null}
              {errors[`conditions.${i}`] ? <p className="text-xs text-danger md:col-span-4">{t('invalidCondition')}</p> : null}
            </div>
          );
        })}
        {canManage && conditions.length < 20 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setConditions([...conditions, { field: fields[0]!.key, op: opsByType[fields[0]!.type][0]!, value: undefined }])}
            data-testid="add-condition"
          >
            <Plus aria-hidden />
            {t('addCondition')}
          </Button>
        ) : null}
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">{t('then')}</h2>
        {actions.map((a, i) => (
          <div key={a.id} className="space-y-3 rounded-md border border-border p-3" data-testid="action-row">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{t('actionNumber', { n: i + 1, action: t(`actionTypes.${a.type}`) })}</p>
              {canManage ? (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('moveUp')}
                    disabled={i === 0}
                    onClick={() => setActions(swap(actions, i, i - 1))}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('moveDown')}
                    disabled={i === actions.length - 1}
                    onClick={() => setActions(swap(actions, i, i + 1))}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('removeAction')}
                    disabled={actions.length === 1}
                    onClick={() => setActions(actions.filter((x) => x.id !== a.id))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ) : null}
            </div>
            <fieldset disabled={!canManage} className="min-w-0">
              <ActionEditor
                action={a}
                subject={def.subject}
                options={options}
                signingKey={signingKey}
                onChange={(next) => setActions(actions.map((x) => (x.id === a.id ? next : x)))}
              />
            </fieldset>
            {errors[`actions.${i}`] ? <p className="text-xs text-danger">{t('invalidAction')}</p> : null}
          </div>
        ))}
        {canManage && actions.length < 10 ? (
          <div className="flex flex-wrap gap-2">
            {available.map((type) => (
              <Button
                key={type}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setActions([...actions, defaultAction(type)])}
                data-testid={`add-action-${type}`}
              >
                <Plus aria-hidden />
                {t(`actionTypes.${type}`)}
              </Button>
            ))}
          </div>
        ) : null}
        <p className="text-xs text-subtle-foreground">
          {t('placeholdersHint')}{' '}
          <bdi dir="ltr" className="font-mono">
            {placeholders.slice(0, 6).join(' ')}
          </bdi>
        </p>
      </Card>

      {canManage ? (
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="submit" loading={save.pending} data-testid="automation-save">
            <Save aria-hidden />
            {tc('save')}
          </Button>
          {automation ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost" className="text-danger">
                  <Trash2 aria-hidden />
                  {tc('delete')}
                </Button>
              }
              title={t('deleteTitle')}
              description={t('deleteBody')}
              confirmLabel={tc('delete')}
              cancelLabel={tc('cancel')}
              destructive
              onConfirm={() => remove.run({ id: automation.id })}
            />
          ) : null}
        </div>
      ) : null}
    </form>
  );

  if (!automation) return builder;

  return (
    <Tabs defaultValue={initialTab}>
      <TabsList>
        <TabsTrigger value="rule">{t('tabs.rule')}</TabsTrigger>
        <TabsTrigger value="test" data-testid="tab-test">
          {t('tabs.test')}
        </TabsTrigger>
        <TabsTrigger value="runs" data-testid="tab-runs">
          {t('tabs.runs')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="rule" className="mt-4">
        {builder}
      </TabsContent>
      <TabsContent value="test" className="mt-4 space-y-4">
        <Card className="space-y-3 p-5">
          <p className="text-sm text-muted-foreground">{t('dryRunBody')}</p>
          {events.length ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label={t('dryRunEvent')} className="flex-1">
                {(p) => (
                  <NativeSelect {...p} value={eventId} onChange={(e) => setEventId(e.target.value)} data-testid="dry-run-event">
                    <option value="">{t('latestEvent')}</option>
                    {events.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {format.dateTime(ev.occurredAt)} · {ev.label}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Button
                type="button"
                onClick={() => void dryRun.run({ id: automation.id, eventId: eventId || null })}
                loading={dryRun.pending}
                disabled={!canManage}
                data-testid="dry-run"
              >
                <FlaskConical aria-hidden />
                {t('dryRun')}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-subtle-foreground">{t('noEvents')}</p>
          )}
        </Card>
        <Card>
          <RunLog runs={automation.runs.filter((r) => r.dryRun)} />
        </Card>
      </TabsContent>
      <TabsContent value="runs" className="mt-4">
        <Card>
          <RunLog runs={automation.runs.filter((r) => !r.dryRun)} />
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function swap<T>(list: T[], i: number, j: number): T[] {
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}
