'use client';

import { AlertTriangle, CalendarOff, CheckCircle2, Gauge, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { EmptyState, SectionTitle } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Avatar, Card, NativeSelect, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { capacityGrid, memberLoad, type Cell, type Level } from '@/modules/capacity/calc';
import { addTimeOffAction, deleteTimeOffAction, saveEffortsAction, saveMemberHoursAction } from '@/modules/capacity/server/actions';
import type { CapacityData } from '@/modules/capacity/server/queries';
import { packageItemTypes, type PackageItemType } from '@/modules/clients/constants';

const levelClass: Record<Level, string> = {
  idle: 'bg-surface-muted text-subtle-foreground',
  ok: 'bg-success-soft text-success',
  tight: 'bg-warning-soft text-warning',
  over: 'bg-danger-soft text-danger',
};

function useGrid(data: CapacityData, simulate: { items: { itemType: string; quantity: number }[]; startDate: string } | null) {
  return useMemo(
    () =>
      capacityGrid({
        today: data.today,
        weeks: data.weeks,
        departmentIds: data.departments.map((d) => d.id),
        members: data.members,
        timeOff: data.timeOff,
        holidays: new Set(data.holidays),
        tasks: data.tasks,
        packages: data.packages,
        deals: data.deals,
        efforts: data.efforts,
        simulate,
      }),
    [data, simulate],
  );
}

function Legend() {
  const t = useTranslations('capacity.levels');
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-hidden>
      {(['ok', 'tight', 'over'] as const).map((l) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <span className={cn('size-3 rounded-sm', levelClass[l])} />
          {t(l)}
        </span>
      ))}
    </div>
  );
}

function Heatmap({ data, grid, weeks }: { data: CapacityData; grid: ReturnType<typeof capacityGrid>; weeks: number }) {
  const t = useTranslations('capacity');
  const f = useFormat();
  const locale = useLocale() as Locale;
  const h = (n: number) => f.number(Math.round(n));
  const title = (c: Cell) =>
    t('cellTitle', {
      demand: h(c.demand),
      capacity: h(c.capacity),
      tasks: h(c.tasks),
      packages: h(c.packages),
      pipeline: h(c.pipeline),
      simulated: h(c.simulated),
    });
  return (
    <div className="min-w-0 overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[44rem] border-separate border-spacing-1 p-2 text-sm" data-testid="capacity-heatmap">
        <thead>
          <tr>
            <th className="sticky start-0 bg-surface px-2 py-1 text-start font-medium text-muted-foreground">{t('department')}</th>
            {data.weeks.slice(0, weeks).map((w) => (
              <th key={w.start} className="px-1 py-1 text-center text-xs font-medium whitespace-nowrap text-muted-foreground">
                {f.dayMonth(`${w.start}T12:00:00Z`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row) => {
            const dept = data.departments.find((d) => d.id === row.departmentId)!;
            return (
              <tr key={row.departmentId} data-testid="capacity-row">
                <th scope="row" className="sticky start-0 bg-surface px-2 py-1 text-start font-medium whitespace-nowrap">
                  {localized(dept.name, locale)}
                </th>
                {row.cells.slice(0, weeks).map((c, i) => (
                  <td
                    key={data.weeks[i]!.start}
                    className={cn('relative rounded-md px-1 py-2 text-center', levelClass[c.level])}
                    title={title(c)}
                    data-level={c.level}
                    data-testid="capacity-cell"
                  >
                    <span className="sr-only">{title(c)}</span>
                    <span aria-hidden className="tabular block text-sm font-semibold">
                      {c.ratio === null ? (c.demand > 0 ? '!' : '—') : f.percent(c.ratio)}
                    </span>
                    <span aria-hidden className="tabular block text-[0.6875rem] opacity-80">
                      {t('hoursShort', { demand: h(c.demand), capacity: h(c.capacity) })}
                    </span>
                    {c.simulated > 0 ? (
                      <span aria-hidden className="tabular block text-[0.6875rem] font-medium">
                        {t('plusHours', { hours: h(c.simulated) })}
                      </span>
                    ) : null}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Simulator({ data }: { data: CapacityData }) {
  const t = useTranslations('capacity');
  const f = useFormat();
  const locale = useLocale() as Locale;
  const [packageId, setPackageId] = useState('');
  const [start, setStart] = useState(data.weeks[1]?.start ?? data.today);
  const [weeks, setWeeks] = useState(8);
  const pkg = data.catalog.find((p) => p.id === packageId);
  const simulate = useMemo(() => (pkg ? { items: pkg.items, startDate: start } : null), [pkg, start]);
  const before = useGrid(data, null);
  const after = useGrid(data, simulate);
  const firstWeek = data.weeks.findIndex((w) => w.end >= start);
  const range = (cells: Cell[]) => cells.slice(Math.max(0, firstWeek), weeks);
  const issues = after
    .map((row) => {
      const dept = data.departments.find((d) => d.id === row.departmentId)!;
      const cells = range(row.cells);
      const worst: Level = cells.some((c) => c.level === 'over') ? 'over' : cells.some((c) => c.level === 'tight') ? 'tight' : 'ok';
      const added = cells.reduce((n, c) => n + c.simulated, 0);
      const peak = Math.max(0, ...cells.map((c) => c.ratio ?? (c.demand > 0 ? Infinity : 0)));
      return { dept, worst, added, peak };
    })
    .filter((r) => r.added > 0);
  const verdict: Level = issues.some((i) => i.worst === 'over') ? 'over' : issues.some((i) => i.worst === 'tight') ? 'tight' : 'ok';
  const noEffort = pkg && issues.length === 0;
  return (
    <section className="grid min-w-0 grid-cols-1 gap-4" data-testid="capacity-simulator">
      <SectionTitle title={t('simulator.title')} />
      <Card className="grid gap-4 p-4">
        <p className="text-sm text-muted-foreground">{t('simulator.body')}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('simulator.package')}>
            {(p) => (
              <NativeSelect {...p} value={packageId} onChange={(e) => setPackageId(e.target.value)} data-testid="sim-package">
                <option value="">{t('simulator.choose')}</option>
                {data.catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {localized(c.name, locale)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('simulator.start')}>
            {(p) => (
              <NativeSelect {...p} value={start} onChange={(e) => setStart(e.target.value)} data-testid="sim-start">
                {data.weeks.map((w) => (
                  <option key={w.start} value={w.start}>
                    {t('simulator.weekOf', { date: f.date(`${w.start}T12:00:00Z`) })}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('simulator.horizon')}>
            {(p) => (
              <NativeSelect {...p} value={String(weeks)} onChange={(e) => setWeeks(Number(e.target.value))} data-testid="sim-weeks">
                {[4, 6, 8].map((n) => (
                  <option key={n} value={n}>
                    {t('simulator.weeks', { count: n })}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
        {pkg ? (
          <div
            className={cn('flex items-start gap-3 rounded-lg p-3', noEffort ? 'bg-surface-muted' : levelClass[verdict])}
            role="status"
            data-testid="sim-verdict"
            data-verdict={noEffort ? 'none' : verdict}
          >
            {verdict === 'ok' || noEffort ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            )}
            <div className="grid gap-1 text-sm">
              <p className="font-semibold">{noEffort ? t('simulator.noEffort') : t(`simulator.verdict.${verdict}`)}</p>
              {issues.map((i) => (
                <p key={i.dept.id} className="text-foreground">
                  {t('simulator.impact', {
                    department: localized(i.dept.name, locale),
                    hours: f.number(Math.round(i.added)),
                    peak: Number.isFinite(i.peak) ? f.percent(i.peak) : '—',
                  })}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </Card>
      <Heatmap data={data} grid={pkg ? after : before} weeks={weeks} />
    </section>
  );
}

function MemberWarnings({ data }: { data: CapacityData }) {
  const t = useTranslations('capacity');
  const f = useFormat();
  const load = useMemo(
    () =>
      memberLoad({
        today: data.today,
        weeks: data.weeks,
        members: data.members,
        timeOff: data.timeOff,
        holidays: new Set(data.holidays),
        tasks: data.tasks,
      }),
    [data],
  );
  const over = load
    .map((l) => ({
      person: data.people.find((p) => p.id === l.userId)!,
      weeks: l.weeks.map((w, i) => ({ ...w, week: data.weeks[i]! })).filter((w) => w.level === 'over'),
    }))
    .filter((x) => x.weeks.length);
  return (
    <section data-testid="capacity-warnings">
      <SectionTitle title={t('warnings.title')} />
      {over.length === 0 ? (
        <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-success" aria-hidden />
          {t('warnings.none')}
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {over.map(({ person, weeks }) => (
            <div key={person.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="capacity-warning">
              <Avatar size="sm" name={person.name} src={publicAssetUrl(person.avatarPath) ?? undefined} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{person.name}</span>
              <span className="flex flex-wrap gap-1">
                {weeks.map((w) => (
                  <span key={w.week.start} className="tabular rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                    {t('warnings.week', {
                      date: f.dayMonth(`${w.week.start}T12:00:00Z`),
                      demand: f.number(Math.round(w.demand)),
                      capacity: f.number(Math.round(w.capacity)),
                    })}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

function HoursInput({ userId, value, disabled }: { userId: string; value: number; disabled: boolean }) {
  const t = useTranslations('capacity');
  const [v, setV] = useState(String(value));
  const save = useAction(saveMemberHoursAction, { successMessage: t('saved') });
  return (
    <Input
      aria-label={t('team.hours')}
      type="number"
      dir="ltr"
      min={0}
      max={80}
      step="1"
      className="h-8 w-20"
      value={v}
      disabled={disabled || save.pending}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (Number(v) !== value && v !== '') void save.run({ userId, hoursPerWeek: Number(v) });
      }}
      data-testid="member-hours"
    />
  );
}

function TeamTab({ data }: { data: CapacityData }) {
  const t = useTranslations('capacity');
  const f = useFormat();
  const locale = useLocale() as Locale;
  const [userId, setUserId] = useState(data.people[0]?.id ?? '');
  const [from, setFrom] = useState(data.today);
  const [to, setTo] = useState(data.today);
  const [kind, setKind] = useState<'annual' | 'sick' | 'other'>('annual');
  const add = useAction(addTimeOffAction, { successMessage: t('saved') });
  const remove = useAction(deleteTimeOffAction);
  const dept = (id: string) => localized(data.departments.find((d) => d.id === id)?.name ?? {}, locale);
  return (
    <div className="grid gap-6">
      <section>
        <SectionTitle title={t('team.title')} />
        <Card className="divide-y divide-border" data-testid="capacity-members">
          {data.people.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <Avatar size="sm" name={p.name} src={publicAssetUrl(p.avatarPath) ?? undefined} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="truncate text-xs text-subtle-foreground">
                  {p.departmentIds.length ? f.list(p.departmentIds.map(dept)) : t('team.noDepartment')}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <HoursInput userId={p.id} value={p.hoursPerWeek} disabled={!data.canManage} />
                {t('team.perWeek')}
              </label>
            </div>
          ))}
        </Card>
      </section>
      <section>
        <SectionTitle title={t('timeOff.title')} />
        {data.canManage ? (
          <Card className="mb-3 p-4">
            <form
              className="grid gap-4 sm:grid-cols-[1fr_10rem_10rem_9rem_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                void add.run({ userId, startDate: from, endDate: to, kind, note: '' });
              }}
              data-testid="time-off-form"
            >
              <Field label={t('timeOff.member')}>
                {(p) => (
                  <NativeSelect {...p} value={userId} onChange={(e) => setUserId(e.target.value)}>
                    {data.people.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('timeOff.from')}>
                {(p) => <Input {...p} type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />}
              </Field>
              <Field label={t('timeOff.to')}>
                {(p) => <Input {...p} type="date" dir="ltr" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}
              </Field>
              <Field label={t('timeOff.kind')}>
                {(p) => (
                  <NativeSelect {...p} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                    {(['annual', 'sick', 'other'] as const).map((k) => (
                      <option key={k} value={k}>
                        {t(`timeOff.kinds.${k}`)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Button type="submit" loading={add.pending} disabled={!userId || to < from} data-testid="time-off-add">
                {t('timeOff.add')}
              </Button>
            </form>
          </Card>
        ) : null}
        {data.timeOff.length === 0 ? (
          <EmptyState compact icon={CalendarOff} title={t('timeOff.empty')} description={t('timeOff.emptyBody')} />
        ) : (
          <Card className="divide-y divide-border" data-testid="time-off-list">
            {data.timeOff.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{data.people.find((p) => p.id === o.userId)?.name ?? ''}</span>
                <span className="text-muted-foreground">
                  {f.date(`${o.startDate}T12:00:00Z`)} – {f.date(`${o.endDate}T12:00:00Z`)}
                </span>
                <span className="text-xs text-subtle-foreground">{t(`timeOff.kinds.${o.kind as 'annual'}`)}</span>
                {data.canManage ? (
                  <Button variant="ghost" size="icon-sm" aria-label={t('timeOff.remove')} onClick={() => remove.run({ id: o.id })}>
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

function EffortsTab({ data }: { data: CapacityData }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const initial = () => {
    const m: Record<string, string> = {};
    for (const e of data.efforts) m[`${e.itemType}:${e.departmentId}`] = String(e.hours);
    return m;
  };
  const [values, setValues] = useState(initial);
  const save = useAction(saveEffortsAction, { successMessage: t('capacity.saved') });
  return (
    <section className="grid min-w-0 grid-cols-1 gap-3">
      <p className="text-sm text-muted-foreground">{t('capacity.efforts.body')}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const efforts = Object.entries(values)
            .filter(([, v]) => v !== '' && Number(v) > 0)
            .map(([k, v]) => {
              const [itemType, departmentId] = k.split(':') as [PackageItemType, string];
              return { itemType, departmentId, hours: Number(v) };
            });
          void save.run({ efforts });
        }}
        className="grid min-w-0 grid-cols-1 gap-3"
        data-testid="efforts-form"
      >
        <div className="min-w-0 overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-start font-medium text-muted-foreground">{t('capacity.efforts.item')}</th>
                {data.departments.map((d) => (
                  <th key={d.id} className="px-2 py-2 text-center font-medium whitespace-nowrap text-muted-foreground">
                    {localized(d.name, locale)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {packageItemTypes.map((it) => (
                <tr key={it}>
                  <th scope="row" className="px-3 py-1.5 text-start font-medium whitespace-nowrap">
                    {t(`clients.itemTypes.${it}`)}
                  </th>
                  {data.departments.map((d) => {
                    const k = `${it}:${d.id}`;
                    return (
                      <td key={d.id} className="px-2 py-1.5 text-center">
                        <Input
                          aria-label={`${t(`clients.itemTypes.${it}`)} · ${localized(d.name, locale)}`}
                          type="number"
                          dir="ltr"
                          min={0}
                          max={200}
                          step="0.5"
                          className="mx-auto h-8 w-20 text-center"
                          value={values[k] ?? ''}
                          disabled={!data.canManage}
                          onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                          data-testid={`effort-${it}-${d.id}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.canManage ? (
          <div>
            <Button type="submit" loading={save.pending} data-testid="efforts-save">
              {t('common.save')}
            </Button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

export function CapacityPlanner({ data }: { data: CapacityData }) {
  const t = useTranslations('capacity');
  if (!data.departments.length) return <EmptyState icon={Gauge} title={t('emptyTitle')} description={t('emptyBody')} />;
  return (
    <Tabs defaultValue="plan" className="grid min-w-0 grid-cols-1 gap-4">
      <TabsList>
        <TabsTrigger value="plan" data-testid="capacity-tab-plan">
          {t('tabs.plan')}
        </TabsTrigger>
        <TabsTrigger value="team" data-testid="capacity-tab-team">
          {t('tabs.team')}
        </TabsTrigger>
        <TabsTrigger value="efforts" data-testid="capacity-tab-efforts">
          {t('tabs.efforts')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="plan" className="grid min-w-0 grid-cols-1 gap-8">
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">{t('explain')}</p>
          <Legend />
        </div>
        <Simulator data={data} />
        <MemberWarnings data={data} />
      </TabsContent>
      <TabsContent value="team">
        <TeamTab data={data} />
      </TabsContent>
      <TabsContent value="efforts">
        <EffortsTab data={data} />
      </TabsContent>
    </Tabs>
  );
}
