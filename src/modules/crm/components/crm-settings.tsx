'use client';

import { ArrowDown, ArrowUp, Copy, ExternalLink, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Badge, Card, Checkbox, NativeSelect, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { cities } from '@/modules/clients/constants';
import { ServicePicker } from '@/modules/crm/components/lead-dialog';
import { leadSources, type CrmService, type LeadSource, type StageKind } from '@/modules/crm/constants';
import type { CrmSettingsData } from '@/modules/crm/server/queries';
import {
  createWebhookTokenAction,
  deleteLeadFormAction,
  deletePipelineAction,
  deleteRuleAction,
  moveRuleUpAction,
  revokeWebhookTokenAction,
  saveCrmSettingsAction,
  saveLeadFormAction,
  savePipelineAction,
  saveRuleAction,
  saveTargetAction,
} from '@/modules/crm/server/settings-actions';

type Person = { id: string; name: string };

async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    /* Clipboard blocked (insecure context); the text stays selectable on screen. */
  }
}

function MultiCheck<T extends string>({
  label,
  all,
  value,
  onChange,
  labelOf,
}: {
  label: string;
  all: readonly T[];
  value: T[];
  onChange: (v: T[]) => void;
  labelOf: (v: T) => string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {all.map((v) => (
          <label key={v} className="flex items-center gap-1.5 text-sm">
            <Checkbox
              checked={value.includes(v)}
              onCheckedChange={(c) => onChange(c === true ? [...value, v] : value.filter((x) => x !== v))}
            />
            {labelOf(v)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* Pipelines                                                                  */
/* -------------------------------------------------------------------------- */

type StageDraft = { key: string; id?: string; name: LocalizedText; kind: StageKind; probability: number };
let seq = 0;
const key = () => `s${++seq}`;

function PipelineEditor({
  pipeline,
  usage,
  onDone,
}: {
  pipeline: CrmSettingsData['pipelines'][number] | null;
  usage: Record<string, number>;
  onDone?: () => void;
}) {
  const t = useTranslations('crm.settings');
  const tc = useTranslations('common');
  const [nameAr, setNameAr] = useState(pipeline?.name.ar ?? '');
  const [nameEn, setNameEn] = useState(pipeline?.name.en ?? '');
  const [isDefault, setIsDefault] = useState(pipeline?.isDefault ?? false);
  const [stages, setStages] = useState<StageDraft[]>(
    () =>
      pipeline?.stages.map((s) => ({
        key: key(),
        id: s.id,
        name: { ar: s.name.ar ?? '', en: s.name.en ?? '' },
        kind: s.kind,
        probability: s.probability,
      })) ?? [
        { key: key(), name: { ar: 'جديد', en: 'New' }, kind: 'open', probability: 10 },
        { key: key(), name: { ar: 'رابحة', en: 'Won' }, kind: 'won', probability: 100 },
        { key: key(), name: { ar: 'خاسرة', en: 'Lost' }, kind: 'lost', probability: 0 },
      ],
  );
  const [error, setError] = useState<string | null>(null);
  const save = useAction(savePipelineAction, { successMessage: t('saved') });
  const remove = useAction(deletePipelineAction);
  const upd = (k: string, patch: Partial<StageDraft>) => setStages((s) => s.map((x) => (x.key === k ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setStages((s) => {
      const n = [...s];
      [n[i], n[i + d]] = [n[i + d]!, n[i]!];
      return n;
    });
  return (
    <Card className="p-4" data-testid="pipeline-editor">
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const res = await save.run({
            pipelineId: pipeline?.id,
            name: { ar: nameAr, en: nameEn },
            isDefault,
            stages: stages.map((s) => ({
              id: s.id,
              name: { ar: s.name.ar ?? '', en: s.name.en ?? '' },
              kind: s.kind,
              probability: s.probability,
            })),
          });
          if (!res.ok) {
            const first = Object.values(res.error.fieldErrors ?? {})[0]?.[0];
            if (first) setError(first);
            return;
          }
          onDone?.();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label={`${t('pipelineName')} · ${tc('arabic')}`}>
            {(p) => <Input {...p} dir="rtl" lang="ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} maxLength={80} />}
          </Field>
          <Field label={`${t('pipelineName')} · ${tc('english')}`}>
            {(p) => <Input {...p} dir="ltr" lang="en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} maxLength={80} />}
          </Field>
          <label className="flex h-10 items-center gap-2 text-sm">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} disabled={pipeline?.isDefault} />
            {t('defaultPipeline')}
          </label>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t('stages')}</legend>
          {stages.map((s, i) => (
            <div
              key={s.key}
              className="grid grid-cols-2 items-end gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_1fr_7rem_6rem_auto]"
              data-testid="stage-row"
            >
              <Input
                aria-label={`${t('stageName')} · ${tc('arabic')}`}
                dir="rtl"
                lang="ar"
                value={s.name.ar ?? ''}
                onChange={(e) => upd(s.key, { name: { ...s.name, ar: e.target.value } })}
                maxLength={60}
              />
              <Input
                aria-label={`${t('stageName')} · ${tc('english')}`}
                dir="ltr"
                lang="en"
                value={s.name.en ?? ''}
                onChange={(e) => upd(s.key, { name: { ...s.name, en: e.target.value } })}
                maxLength={60}
              />
              <NativeSelect aria-label={t('stageKind')} value={s.kind} onChange={(e) => upd(s.key, { kind: e.target.value as StageKind })}>
                {(['open', 'won', 'lost'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`kinds.${k}`)}
                  </option>
                ))}
              </NativeSelect>
              <Input
                aria-label={t('stageProbability')}
                type="number"
                dir="ltr"
                min={0}
                max={100}
                disabled={s.kind !== 'open'}
                value={s.kind === 'won' ? 100 : s.kind === 'lost' ? 0 : s.probability}
                onChange={(e) => upd(s.key, { probability: Number(e.target.value) })}
              />
              <div className="col-span-2 flex items-center justify-end gap-0.5 sm:col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('moveUp')}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('moveDown')}
                  disabled={i === stages.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('removeStage')}
                  disabled={Boolean(s.id && usage[s.id])}
                  title={s.id && usage[s.id] ? t('stageInUse', { count: usage[s.id]! }) : undefined}
                  onClick={() => setStages((x) => x.filter((y) => y.key !== s.key))}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const firstClosed = stages.findIndex((s) => s.kind !== 'open');
                const at = firstClosed === -1 ? stages.length : firstClosed;
                setStages((s) => [
                  ...s.slice(0, at),
                  { key: key(), name: { ar: '', en: '' }, kind: 'open', probability: 50 },
                  ...s.slice(at),
                ]);
              }}
            >
              <Plus />
              {t('addStage')}
            </Button>
          </div>
        </fieldset>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {tc.has(`validation.${error}` as never) ? tc(`validation.${error}` as never) : error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          {pipeline && !pipeline.isDefault ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost">
                  <Trash2 />
                  {t('deletePipeline')}
                </Button>
              }
              title={t('deletePipeline')}
              description={t('deletePipelineConfirm')}
              confirmLabel={tc('delete')}
              cancelLabel={tc('cancel')}
              destructive
              onConfirm={() => remove.run({ id: pipeline.id })}
            />
          ) : null}
          <Button type="submit" loading={save.pending} data-testid="pipeline-save">
            {t('savePipeline')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PipelinesTab({ data }: { data: CrmSettingsData }) {
  const t = useTranslations('crm.settings');
  const [adding, setAdding] = useState(false);
  return (
    <div className="grid gap-4">
      {data.pipelines.map((p) => (
        <PipelineEditor key={`${p.id}-${p.stages.map((s) => s.id).join()}`} pipeline={p} usage={data.stageUsage} />
      ))}
      {adding ? (
        <PipelineEditor pipeline={null} usage={{}} onDone={() => setAdding(false)} />
      ) : (
        <div>
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus />
            {t('newPipeline')}
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Website forms                                                              */
/* -------------------------------------------------------------------------- */

function FormEditor({ form, appUrl, onDone }: { form: CrmSettingsData['forms'][number] | null; appUrl: string; onDone?: () => void }) {
  const t = useTranslations('crm.settings');
  const tc = useTranslations('common');
  const [name, setName] = useState(form?.name ?? '');
  const [isActive, setIsActive] = useState(form?.isActive ?? true);
  const [services, setServices] = useState<string[]>(form?.services ?? []);
  const [ar, setAr] = useState(form?.thankYou.ar ?? '');
  const [en, setEn] = useState(form?.thankYou.en ?? '');
  const save = useAction(saveLeadFormAction, { successMessage: t('saved') });
  const remove = useAction(deleteLeadFormAction);
  const link = form ? `${appUrl}/f/${form.token}` : '';
  const snippet = form
    ? `<iframe src="${link}" title="${name.replace(/"/g, '')}" loading="lazy" style="width:100%;min-height:760px;border:0"></iframe>`
    : '';
  return (
    <Card className="grid gap-4 p-4" data-testid="lead-form-editor">
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await save.run({
            formId: form?.id,
            name,
            isActive,
            services: services as CrmService[],
            thankYou: { ar, en },
          });
          if (res.ok) onDone?.();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label={t('formName')} required>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-testid="lead-form-name" />}
          </Field>
          <label className="flex h-10 items-center gap-2 text-sm">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            {t('formActive')}
          </label>
        </div>
        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-medium">{t('formServices')}</legend>
          <p className="text-xs text-subtle-foreground">{t('formServicesHint')}</p>
          <ServicePicker value={services} onChange={setServices} />
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('thankYouAr')} optional>
            {(p) => <Textarea {...p} dir="rtl" lang="ar" rows={2} value={ar} onChange={(e) => setAr(e.target.value)} maxLength={300} />}
          </Field>
          <Field label={t('thankYouEn')} optional>
            {(p) => <Textarea {...p} dir="ltr" lang="en" rows={2} value={en} onChange={(e) => setEn(e.target.value)} maxLength={300} />}
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {form ? <span className="me-auto text-xs text-subtle-foreground">{t('submissions', { count: form.submissions })}</span> : null}
          {form ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost">
                  <Trash2 />
                  {t('deleteForm')}
                </Button>
              }
              title={t('deleteForm')}
              description={t('deleteFormConfirm')}
              confirmLabel={tc('delete')}
              cancelLabel={tc('cancel')}
              destructive
              onConfirm={() => remove.run({ id: form.id })}
            />
          ) : null}
          <Button type="submit" loading={save.pending} data-testid="lead-form-save">
            {tc('save')}
          </Button>
        </div>
      </form>
      {form ? (
        <div className="grid gap-2 rounded-lg bg-surface-muted p-3" data-testid="lead-form-embed">
          <p className="text-sm font-medium">{t('embed')}</p>
          <p className="text-xs text-subtle-foreground">{t('embedHint')}</p>
          <code
            dir="ltr"
            className="block overflow-x-auto rounded-md bg-surface p-2 text-xs whitespace-pre"
            data-testid="lead-form-snippet"
          >
            {snippet}
          </code>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => copy(snippet, t('copied'))}>
              <Copy />
              {t('copySnippet')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => copy(link, t('copied'))}>
              <Copy />
              {t('copyLink')}
            </Button>
            <Button asChild size="sm" variant="ghost">
              <a href={link} target="_blank" rel="noreferrer" data-testid="lead-form-open">
                <ExternalLink />
                {t('openForm')}
              </a>
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function FormsTab({ data, appUrl }: { data: CrmSettingsData; appUrl: string }) {
  const t = useTranslations('crm.settings');
  const [adding, setAdding] = useState(false);
  return (
    <div className="grid gap-4">
      {data.forms.length === 0 && !adding ? (
        <EmptyState compact icon={ExternalLink} title={t('noForms')} description={t('noFormsBody')} />
      ) : null}
      {data.forms.map((f) => (
        <FormEditor key={f.id} form={f} appUrl={appUrl} />
      ))}
      {adding ? (
        <FormEditor form={null} appUrl={appUrl} onDone={() => setAdding(false)} />
      ) : (
        <div>
          <Button variant="outline" onClick={() => setAdding(true)} data-testid="lead-form-new">
            <Plus />
            {t('newForm')}
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Assignment rules                                                           */
/* -------------------------------------------------------------------------- */

type Rule = CrmSettingsData['rules'][number];

function RuleEditor({ rule, owners, first, onDone }: { rule: Rule | null; owners: Person[]; first: boolean; onDone?: () => void }) {
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const tr = useTranslations();
  const [name, setName] = useState(rule?.name ?? '');
  const [services, setServices] = useState<string[]>(rule?.matchServices ?? []);
  const [cityList, setCities] = useState<string[]>(rule?.matchCities ?? []);
  const [sources, setSources] = useState<LeadSource[]>((rule?.matchSources ?? []) as LeadSource[]);
  const [members, setMembers] = useState<string[]>(rule?.memberIds ?? []);
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const save = useAction(saveRuleAction, { successMessage: t('settings.saved') });
  const up = useAction(moveRuleUpAction);
  const remove = useAction(deleteRuleAction);
  const next = rule && rule.memberIds.length ? owners.find((o) => o.id === rule.memberIds[rule.cursor % rule.memberIds.length]) : undefined;
  return (
    <Card className="p-4" data-testid="rule-editor">
      <form
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await save.run({
            ruleId: rule?.id,
            name,
            matchServices: services as CrmService[],
            matchCities: cityList as (typeof cities)[number][],
            matchSources: sources,
            memberIds: members,
            isActive,
          });
          if (!res.ok) return setErrors(res.error.fieldErrors);
          onDone?.();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label={t('settings.ruleName')} error={errors?.name?.[0]} required>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-testid="rule-name" />}
          </Field>
          <label className="flex h-10 items-center gap-2 text-sm">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            {t('settings.ruleActive')}
          </label>
        </div>
        <fieldset className="grid gap-1.5">
          <legend className="text-sm font-medium">
            {t('settings.ruleServices')} <span className="text-xs font-normal text-subtle-foreground">({t('settings.any')})</span>
          </legend>
          <ServicePicker value={services} onChange={setServices} />
        </fieldset>
        <MultiCheck
          label={t('settings.ruleCities')}
          all={cities}
          value={cityList as (typeof cities)[number][]}
          onChange={setCities}
          labelOf={(c) => tr(`clients.cities.${c}`)}
        />
        <MultiCheck
          label={t('settings.ruleSources')}
          all={leadSources}
          value={sources}
          onChange={setSources}
          labelOf={(s) => t(`sources.${s}`)}
        />
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{t('settings.ruleMembers')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5" data-testid="rule-members">
            {owners.map((o) => (
              <label key={o.id} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={members.includes(o.id)}
                  onCheckedChange={(c) => setMembers((m) => (c === true ? [...m, o.id] : m.filter((x) => x !== o.id)))}
                />
                {o.name}
              </label>
            ))}
          </div>
          {errors?.memberIds?.[0] ? (
            <p className="mt-1 text-xs text-danger">{tc(`validation.${errors.memberIds[0] as 'min_one'}` as never)}</p>
          ) : null}
        </fieldset>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {next ? <span className="me-auto text-xs text-subtle-foreground">{t('settings.nextUp', { name: next.name })}</span> : null}
          {rule && !first ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => up.run({ id: rule.id })}>
              <ArrowUp />
              {t('settings.moveUp')}
            </Button>
          ) : null}
          {rule ? (
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost" size="icon" aria-label={t('settings.deleteRule')}>
                  <Trash2 />
                </Button>
              }
              title={t('settings.deleteRule')}
              description={rule.name}
              confirmLabel={tc('delete')}
              cancelLabel={tc('cancel')}
              destructive
              onConfirm={() => remove.run({ id: rule.id })}
            />
          ) : null}
          <Button type="submit" loading={save.pending} data-testid="rule-save">
            {tc('save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function RulesTab({ data, owners }: { data: CrmSettingsData; owners: Person[] }) {
  const t = useTranslations('crm.settings');
  const [adding, setAdding] = useState(false);
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('rulesHint')}</p>
      {data.rules.length === 0 && !adding ? <EmptyState compact icon={Plus} title={t('noRules')} description={t('noRulesBody')} /> : null}
      {data.rules.map((r, i) => (
        <RuleEditor key={`${r.id}-${r.sortOrder}`} rule={r} owners={owners} first={i === 0} />
      ))}
      {adding ? (
        <RuleEditor rule={null} owners={owners} first onDone={() => setAdding(false)} />
      ) : (
        <div>
          <Button variant="outline" onClick={() => setAdding(true)} data-testid="rule-new">
            <Plus />
            {t('newRule')}
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Targets                                                                    */
/* -------------------------------------------------------------------------- */

function TargetsTab({ data, owners, thisMonth }: { data: CrmSettingsData; owners: Person[]; thisMonth: string }) {
  const t = useTranslations('crm.settings');
  const f = useFormat();
  const [month, setMonth] = useState(thisMonth);
  const [ownerId, setOwnerId] = useState('');
  const [amount, setAmount] = useState('');
  const save = useAction(saveTargetAction, { successMessage: t('saved') });
  const name = (id: string | null) => (id ? (owners.find((o) => o.id === id)?.name ?? '') : t('targetTeam'));
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('targetsHint')}</p>
      <Card className="p-4">
        <form
          className="grid gap-4 sm:grid-cols-[10rem_1fr_10rem_auto] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await save.run({ month, ownerId: ownerId || null, amountSar: Number(amount || 0) });
            if (res.ok) setAmount('');
          }}
          data-testid="target-form"
        >
          <Field label={t('targetMonth')}>
            {(p) => <Input {...p} type="month" dir="ltr" value={month} onChange={(e) => setMonth(e.target.value)} />}
          </Field>
          <Field label={t('targetOwner')}>
            {(p) => (
              <NativeSelect {...p} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                <option value="">{t('targetTeam')}</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('targetAmount')}>
            {(p) => (
              <Input
                {...p}
                type="number"
                dir="ltr"
                min={0}
                step="1000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                data-testid="target-amount"
              />
            )}
          </Field>
          <Button type="submit" loading={save.pending} disabled={!month || amount === ''} data-testid="target-save">
            {t('saveTarget')}
          </Button>
        </form>
      </Card>
      {data.targets.length === 0 ? (
        <p className="text-sm text-subtle-foreground">{t('noTargets')}</p>
      ) : (
        <Card className="divide-y divide-border" data-testid="targets-list">
          {data.targets.map((x) => (
            <div key={x.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="font-medium">{f.monthYear(`${x.month.slice(0, 7)}-15T12:00:00Z`)}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{name(x.ownerId)}</span>
              <span className="tabular">{f.currency(x.amountMinor)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Integrations (webhook tokens)                                              */
/* -------------------------------------------------------------------------- */

function IntegrationsTab({ data, appUrl }: { data: CrmSettingsData; appUrl: string }) {
  const t = useTranslations('crm.settings');
  const tc = useTranslations('common');
  const f = useFormat();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const create = useAction(createWebhookTokenAction);
  const revoke = useAction(revokeWebhookTokenAction);
  const url = `${appUrl}/api/webhooks/leads`;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        {t.rich('tokensHint', {
          url: () => (
            <code dir="ltr" className="rounded bg-surface-muted px-1 text-xs">
              {url}
            </code>
          ),
        })}
      </p>
      <Card className="p-4">
        <form
          className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await create.run({ name });
            if (res.ok) {
              setCreated(res.data.token);
              setName('');
            }
          }}
        >
          <Field label={t('tokenName')} required>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-testid="token-name" />}
          </Field>
          <Button type="submit" loading={create.pending} disabled={!name.trim()} data-testid="token-create">
            <KeyRound />
            {t('newToken')}
          </Button>
        </form>
        {created ? (
          <div className="mt-4 grid gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3" role="status">
            <p className="text-sm font-medium">{t('tokenCreated')}</p>
            <code dir="ltr" className="block overflow-x-auto rounded bg-surface p-2 text-xs" data-testid="token-value">
              {created}
            </code>
            <div>
              <Button size="sm" variant="outline" onClick={() => copy(created, t('copied'))}>
                <Copy />
                {tc('copy')}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
      {data.tokens.length === 0 ? (
        <p className="text-sm text-subtle-foreground">{t('noTokens')}</p>
      ) : (
        <Card className="divide-y divide-border">
          {data.tokens.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <KeyRound className="size-4 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-medium">{x.name}</span>
              <span className="text-xs text-subtle-foreground">
                {x.lastUsedAt ? t('lastUsed', { when: f.relative(x.lastUsedAt) }) : t('neverUsed')}
              </span>
              {x.revokedAt ? (
                <Badge tone="neutral">{t('revoked')}</Badge>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => revoke.run({ id: x.id })}>
                  {t('revoke')}
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* General                                                                    */
/* -------------------------------------------------------------------------- */

function GeneralTab({ data }: { data: CrmSettingsData }) {
  const t = useTranslations('crm.settings');
  const tc = useTranslations('common');
  const locale = useLocale() as Locale;
  const [staleDays, setStaleDays] = useState(String(data.settings.staleDays));
  const [typeId, setTypeId] = useState(data.settings.onboardingRequestTypeId ?? '');
  const [templateId, setTemplateId] = useState(data.settings.onboardingTemplateId ?? '');
  const save = useAction(saveCrmSettingsAction, { successMessage: t('saved') });
  const templates = data.templates.filter((x) => !typeId || !x.requestTypeId || x.requestTypeId === typeId);
  return (
    <Card className="p-4">
      <form
        className="grid max-w-xl gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run({
            staleDays: Number(staleDays),
            onboardingRequestTypeId: typeId || null,
            onboardingTemplateId: templateId || null,
          });
        }}
        data-testid="crm-general-form"
      >
        <Field label={t('staleDays')}>
          {(p) => (
            <Input
              {...p}
              type="number"
              dir="ltr"
              min={1}
              max={90}
              value={staleDays}
              onChange={(e) => setStaleDays(e.target.value)}
              className="w-28"
            />
          )}
        </Field>
        <Field label={t('onboardingType')} hint={t('onboardingHint')}>
          {(p) => (
            <NativeSelect {...p} value={typeId} onChange={(e) => setTypeId(e.target.value)} data-testid="crm-onboarding-type">
              <option value="">{t('none')}</option>
              {data.requestTypes.map((x) => (
                <option key={x.id} value={x.id}>
                  {localized(x.name, locale)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label={t('onboardingTemplate')}>
          {(p) => (
            <NativeSelect {...p} value={templateId} onChange={(e) => setTemplateId(e.target.value)} data-testid="crm-onboarding-template">
              <option value="">{t('none')}</option>
              {templates.map((x) => (
                <option key={x.id} value={x.id}>
                  {localized(x.name, locale)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <div>
          <Button type="submit" loading={save.pending} data-testid="crm-general-save">
            {tc('save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function CrmSettings({
  data,
  owners,
  appUrl,
  thisMonth,
}: {
  data: CrmSettingsData;
  owners: Person[];
  appUrl: string;
  thisMonth: string;
}) {
  const t = useTranslations('crm.settings.tabs');
  const tabs = ['pipelines', 'forms', 'rules', 'targets', 'integrations', 'general'] as const;
  return (
    <Tabs defaultValue="pipelines" className="grid gap-4">
      <TabsList className="flex-wrap">
        {tabs.map((x) => (
          <TabsTrigger key={x} value={x} data-testid={`crm-tab-${x}`}>
            {t(x)}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="pipelines">
        <PipelinesTab data={data} />
      </TabsContent>
      <TabsContent value="forms">
        <FormsTab data={data} appUrl={appUrl} />
      </TabsContent>
      <TabsContent value="rules">
        <RulesTab data={data} owners={owners} />
      </TabsContent>
      <TabsContent value="targets">
        <TargetsTab data={data} owners={owners} thisMonth={thisMonth} />
      </TabsContent>
      <TabsContent value="integrations">
        <IntegrationsTab data={data} appUrl={appUrl} />
      </TabsContent>
      <TabsContent value="general">
        <GeneralTab data={data} />
      </TabsContent>
    </Tabs>
  );
}
