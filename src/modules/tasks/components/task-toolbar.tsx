'use client';

import { Bookmark, CalendarDays, Check, Columns3, Filter, List, Plus, Search, Share2, Table2, Trash2, User } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { Badge, Checkbox, NativeSelect, Popover, PopoverContent, PopoverTrigger, Switch } from '@/components/ui/primitives';
import { localized, type Locale, type LocalizedText } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils/cn';
import type { StatusOption } from '@/modules/tasks/components/badges';
import {
  dueFilters,
  groupings,
  sortKeys,
  swimlanes,
  taskPriorities,
  type SavedViewConfig,
  type TaskLayout,
} from '@/modules/tasks/constants';
import { activeFilterCount, showsDone } from '@/modules/tasks/filter';
import type { SavedViewItem } from '@/modules/tasks/server/queries';

const layoutIcon = { board: Columns3, list: List, table: Table2, calendar: CalendarDays } as const;

function CheckList<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: { value: T; label: string }[];
  value: T[] | undefined;
  onChange: (v: T[]) => void;
}) {
  const current = value ?? [];
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 text-xs font-semibold text-muted-foreground">{legend}</legend>
      <div className="grid max-h-40 gap-0.5 overflow-y-auto">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface-muted">
            <Checkbox
              checked={current.includes(o.value)}
              onCheckedChange={(v) => onChange(v === true ? [...current, o.value] : current.filter((x) => x !== o.value))}
            />
            <span className="truncate">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function TaskToolbar({
  layout,
  onLayout,
  config,
  onConfig,
  statuses,
  clients,
  people,
  departments,
  views,
  activeViewId,
  onApplyView,
  onSaveView,
  onDeleteView,
  onNew,
  canCreate,
}: {
  layout: TaskLayout;
  onLayout: (l: TaskLayout) => void;
  config: SavedViewConfig;
  onConfig: (c: SavedViewConfig) => void;
  statuses: StatusOption[];
  clients: { id: string; name: LocalizedText }[];
  people: { id: string; name: string }[];
  departments: { id: string; name: LocalizedText }[];
  views: SavedViewItem[];
  activeViewId: string | null;
  onApplyView: (view: SavedViewItem | null) => void;
  onSaveView: (input: { name: string; isShared: boolean; viewId?: string }) => Promise<boolean>;
  onDeleteView: (viewId: string) => void;
  onNew: () => void;
  canCreate: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const active = views.find((v) => v.id === activeViewId) ?? null;
  const count = activeFilterCount(config);
  const set = (patch: Partial<SavedViewConfig>) => onConfig({ ...config, ...patch });

  const submitView = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (await onSaveView({ name: name.trim(), isShared: shared })) setSaveOpen(false);
  };

  return (
    <div className="grid gap-3" data-testid="task-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5" role="tablist" aria-label={t('tasks.layouts.label')}>
          {(['board', 'list', 'table', 'calendar'] as const).map((l) => {
            const Icon = layoutIcon[l];
            return (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={layout === l}
                onClick={() => onLayout(l)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  layout === l ? 'bg-primary-soft text-primary-soft-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
                data-testid={`layout-${l}`}
              >
                <Icon className="size-4" aria-hidden />
                <span className="hidden sm:inline">{t(`tasks.layouts.${l}`)}</span>
              </button>
            );
          })}
        </div>
        <div className="relative min-w-48 flex-1 sm:max-w-72">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input
            value={config.q ?? ''}
            onChange={(e) => set({ q: e.target.value })}
            placeholder={t('tasks.search')}
            aria-label={t('tasks.search')}
            className="ps-9"
            data-testid="task-search"
          />
        </div>
        <Button
          variant={config.mine ? 'soft' : 'outline'}
          size="sm"
          aria-pressed={Boolean(config.mine)}
          onClick={() => set({ mine: !config.mine })}
          data-testid="filter-mine"
        >
          <User />
          {t('tasks.filters.mine')}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" data-testid="filters-button">
              <Filter />
              {t('tasks.filters.label')}
              {count ? <Badge tone="brand">{count}</Badge> : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="grid w-[min(92vw,34rem)] gap-4 p-4 sm:grid-cols-2">
            <CheckList
              legend={t('tasks.fields.status')}
              options={statuses.map((s) => ({ value: s.id, label: localized(s.name, locale) }))}
              value={config.statusIds}
              onChange={(v) => set({ statusIds: v })}
            />
            <CheckList
              legend={t('tasks.fields.client')}
              options={clients.map((c) => ({ value: c.id, label: localized(c.name, locale) }))}
              value={config.clientIds}
              onChange={(v) => set({ clientIds: v })}
            />
            <CheckList
              legend={t('tasks.fields.assignees')}
              options={[{ value: 'none', label: t('tasks.unassigned') }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
              value={config.assigneeIds}
              onChange={(v) => set({ assigneeIds: v })}
            />
            <div className="grid content-start gap-4">
              <CheckList
                legend={t('tasks.fields.priority')}
                options={taskPriorities.map((p) => ({ value: p, label: t(`requests.priorities.${p}`) }))}
                value={config.priorities}
                onChange={(v) => set({ priorities: v })}
              />
              {departments.length ? (
                <CheckList
                  legend={t('tasks.fields.department')}
                  options={departments.map((d) => ({ value: d.id, label: localized(d.name, locale) }))}
                  value={config.departmentIds}
                  onChange={(v) => set({ departmentIds: v })}
                />
              ) : null}
            </div>
            <Field label={t('tasks.fields.dueDate')}>
              {(p) => (
                <NativeSelect
                  {...p}
                  value={config.due ?? 'any'}
                  onChange={(e) => set({ due: e.target.value as SavedViewConfig['due'] })}
                  data-testid="filter-due"
                >
                  {dueFilters.map((d) => (
                    <option key={d} value={d}>
                      {t(`tasks.filters.due.${d}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <label className="flex items-center justify-between gap-3 self-end rounded-lg border border-border p-2.5 text-sm">
              {t('tasks.filters.showDone')}
              <Switch checked={showsDone(config)} onCheckedChange={(v) => set({ showDone: v })} />
            </label>
            <div className="flex justify-end sm:col-span-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onConfig({ q: config.q, swimlane: config.swimlane, groupBy: config.groupBy, sort: config.sort, sortDir: config.sortDir })
                }
              >
                {t('tasks.filters.clear')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        {layout === 'board' ? (
          <NativeSelect
            value={config.swimlane ?? 'none'}
            onChange={(e) => set({ swimlane: e.target.value as SavedViewConfig['swimlane'] })}
            aria-label={t('tasks.swimlanes.label')}
            className="h-8 w-auto text-sm"
            data-testid="swimlane-select"
          >
            {swimlanes.map((s) => (
              <option key={s} value={s}>
                {t(`tasks.swimlanes.${s}`)}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        {layout === 'list' || layout === 'table' ? (
          <>
            <NativeSelect
              value={config.groupBy ?? (layout === 'list' ? 'status' : 'none')}
              onChange={(e) => set({ groupBy: e.target.value as SavedViewConfig['groupBy'] })}
              aria-label={t('tasks.grouping.label')}
              className="h-8 w-auto text-sm"
              data-testid="group-select"
            >
              {groupings.map((g) => (
                <option key={g} value={g}>
                  {t(`tasks.grouping.${g}`)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              value={config.sort ?? 'due'}
              onChange={(e) => set({ sort: e.target.value as SavedViewConfig['sort'] })}
              aria-label={t('tasks.sorting.label')}
              className="h-8 w-auto text-sm"
            >
              {sortKeys.map((k) => (
                <option key={k} value={k}>
                  {t(`tasks.sorting.${k}`)}
                </option>
              ))}
            </NativeSelect>
          </>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="views-button">
              <Bookmark />
              <span className="max-w-32 truncate">{active ? active.name : t('tasks.views.label')}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onSelect={() => onApplyView(null)}>
              {!active ? <Check /> : <span className="size-4" />}
              {t('tasks.views.default')}
            </DropdownMenuItem>
            {views.length ? <DropdownMenuSeparator /> : null}
            {views.length ? <DropdownMenuLabel>{t('tasks.views.saved')}</DropdownMenuLabel> : null}
            {views.map((v) => (
              <DropdownMenuItem key={v.id} onSelect={() => onApplyView(v)} data-testid="saved-view">
                {active?.id === v.id ? <Check /> : <span className="size-4" />}
                <span className="min-w-0 flex-1 truncate">{v.name}</span>
                {v.isShared ? <Share2 className="text-subtle-foreground" aria-label={t('tasks.views.shared')} /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setName('');
                setShared(false);
                setSaveOpen(true);
              }}
              data-testid="save-view"
            >
              <Plus />
              {t('tasks.views.saveAs')}
            </DropdownMenuItem>
            {active?.mine ? (
              <>
                <DropdownMenuItem onSelect={() => void onSaveView({ name: active.name, isShared: active.isShared, viewId: active.id })}>
                  <Bookmark />
                  {t('tasks.views.update', { name: active.name })}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onDeleteView(active.id)} className="text-danger">
                  <Trash2 />
                  {t('tasks.views.delete')}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {canCreate ? (
          <Button size="sm" onClick={onNew} className="ms-auto" data-testid="new-task">
            <Plus />
            {t('tasks.new')}
          </Button>
        ) : null}
      </div>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent closeLabel={t('common.close')} size="sm">
          <form onSubmit={submitView} className="flex min-h-0 flex-col">
            <DialogHeader>
              <DialogTitle>{t('tasks.views.saveAs')}</DialogTitle>
            </DialogHeader>
            <DialogBody className="grid gap-4">
              <Field label={t('tasks.views.name')}>
                {(p) => (
                  <Input
                    {...p}
                    dir="auto"
                    value={name}
                    maxLength={60}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                    data-testid="view-name"
                  />
                )}
              </Field>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <span>
                  <span className="block text-sm font-medium">{t('tasks.views.shareWithTeam')}</span>
                  <span className="block text-xs text-muted-foreground">{t('tasks.views.shareHint')}</span>
                </span>
                <Switch checked={shared} onCheckedChange={setShared} data-testid="view-shared" />
              </label>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setSaveOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!name.trim()} data-testid="view-save">
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
