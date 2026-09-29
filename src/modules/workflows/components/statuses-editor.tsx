'use client';

import { ArrowDown, ArrowUp, Plus, Star, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Card, NativeSelect, Tooltip } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { cn } from '@/lib/utils/cn';
import { statusDot, TaskStatusBadge } from '@/modules/tasks/components/badges';
import { statusCategories, statusColors, type StatusCategory, type StatusColor } from '@/modules/tasks/constants';
import { saveStatusesSchema } from '@/modules/workflows/schemas';
import { saveTaskStatusesAction } from '@/modules/workflows/server/actions';
import type { TaskStatusItem } from '@/modules/workflows/server/queries';

type Row = {
  id: string | null;
  key: string;
  ar: string;
  en: string;
  category: StatusCategory;
  color: StatusColor;
  isDefault: boolean;
  taskCount: number;
};

/** Organization task statuses: names (AR/EN), what they mean (category), color, order and the default for new tasks. */
export function StatusesEditor({ statuses }: { statuses: TaskStatusItem[] }) {
  const t = useTranslations();
  const [rows, setRows] = useState<Row[]>(() =>
    statuses.map((s) => ({
      id: s.id,
      key: s.id,
      ar: s.name.ar ?? '',
      en: s.name.en ?? '',
      category: s.category,
      color: s.color,
      isDefault: s.isDefault,
      taskCount: s.taskCount,
    })),
  );
  const [dirty, setDirty] = useState(false);
  const save = useAction(saveTaskStatusesAction, { successMessage: t('workflows.statuses.saved'), onSuccess: () => setDirty(false) });
  const update = (next: Row[]) => {
    setRows(next);
    setDirty(true);
  };
  const set = (key: string, patch: Partial<Row>) => update(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const payload = {
    statuses: rows.map((r) => ({ id: r.id, name: { ar: r.ar, en: r.en }, category: r.category, color: r.color, isDefault: r.isDefault })),
  };
  const parsed = saveStatusesSchema.safeParse(payload);
  const problem = parsed.success ? null : parsed.error.issues[0]?.message;
  const problemKey = `validation.${problem}` as Parameters<typeof t>[0];

  return (
    <Card className="p-4 sm:p-5" data-testid="statuses-editor">
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t('workflows.statuses.hint')}</p>
      <ul className="grid gap-2">
        {rows.map((r, i) => (
          <li
            key={r.key}
            className="grid items-center gap-2 rounded-lg border border-border p-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_10rem_8rem_auto]"
            data-testid="status-row"
          >
            <span className={cn('ms-1 size-2.5 rounded-full', statusDot[r.color])} aria-hidden />
            <Input dir="rtl" lang="ar" aria-label={t('admin.nameAr')} value={r.ar} onChange={(e) => set(r.key, { ar: e.target.value })} />
            <Input dir="ltr" lang="en" aria-label={t('admin.nameEn')} value={r.en} onChange={(e) => set(r.key, { en: e.target.value })} />
            <NativeSelect
              aria-label={t('workflows.statuses.category')}
              value={r.category}
              onChange={(e) => set(r.key, { category: e.target.value as StatusCategory })}
            >
              {statusCategories.map((c) => (
                <option key={c} value={c}>
                  {t(`workflows.categories.${c}`)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label={t('workflows.statuses.color')}
              value={r.color}
              onChange={(e) => set(r.key, { color: e.target.value as StatusColor })}
            >
              {statusColors.map((c) => (
                <option key={c} value={c}>
                  {t(`workflows.colors.${c}`)}
                </option>
              ))}
            </NativeSelect>
            <div className="flex items-center justify-end gap-0.5">
              <Tooltip content={t('workflows.statuses.makeDefault')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-pressed={r.isDefault}
                  aria-label={t('workflows.statuses.makeDefault')}
                  onClick={() => update(rows.map((x) => ({ ...x, isDefault: x.key === r.key })))}
                >
                  <Star className={cn(r.isDefault && 'fill-warning text-warning')} />
                </Button>
              </Tooltip>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={i === 0}
                aria-label={t('workflows.builder.moveUp')}
                onClick={() => {
                  const next = [...rows];
                  [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                  update(next);
                }}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={i === rows.length - 1}
                aria-label={t('workflows.builder.moveDown')}
                onClick={() => {
                  const next = [...rows];
                  [next[i + 1], next[i]] = [next[i]!, next[i + 1]!];
                  update(next);
                }}
              >
                <ArrowDown />
              </Button>
              <Tooltip content={r.taskCount ? t('workflows.statuses.inUse', { count: r.taskCount }) : t('workflows.statuses.remove')}>
                <span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={r.taskCount > 0 || r.isDefault}
                    aria-label={t('workflows.statuses.remove')}
                    onClick={() => update(rows.filter((x) => x.key !== r.key))}
                  >
                    <Trash2 />
                  </Button>
                </span>
              </Tooltip>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="soft"
          size="sm"
          disabled={rows.length >= 15}
          onClick={() =>
            update([
              ...rows,
              { id: null, key: crypto.randomUUID(), ar: '', en: '', category: 'active', color: 'info', isDefault: false, taskCount: 0 },
            ])
          }
          data-testid="add-status"
        >
          <Plus />
          {t('workflows.statuses.add')}
        </Button>
        <div className="ms-auto flex flex-wrap items-center gap-3">
          <div className="hidden flex-wrap gap-1 lg:flex" aria-hidden>
            {rows.map((r) => (
              <TaskStatusBadge key={r.key} status={{ id: r.key, name: { ar: r.ar, en: r.en }, category: r.category, color: r.color }} />
            ))}
          </div>
          {problem ? <Badge tone="danger">{t.has(problemKey) ? t(problemKey) : problem}</Badge> : null}
          <Button
            onClick={() => parsed.success && void save.run(parsed.data)}
            disabled={!dirty || !parsed.success}
            loading={save.pending}
            data-testid="save-statuses"
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
      <p className="mt-3 text-xs text-subtle-foreground">{t('workflows.statuses.categoryHint')}</p>
    </Card>
  );
}
