'use client';

import { ChevronDown, ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { DirIcon, EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, NativeSelect } from '@/components/ui/primitives';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';

export type AuditEntry = {
  id: number;
  action: 'insert' | 'update' | 'delete';
  tableName: string;
  recordId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedFields: string[] | null;
  createdAt: string;
  actor: { name: string; avatarPath: string | null } | null;
};

const HIDDEN_FIELDS = new Set(['updated_at', 'created_at', 'organization_id']);
const actionTone = { insert: 'success', update: 'info', delete: 'danger' } as const;

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function Diff({ entry }: { entry: AuditEntry }) {
  const t = useTranslations('admin.audit');
  const keys =
    entry.action === 'update'
      ? (entry.changedFields ?? [])
      : Object.keys(entry.after ?? entry.before ?? {}).filter((k) => !HIDDEN_FIELDS.has(k));
  if (keys.length === 0) return <p className="text-sm text-muted-foreground">{t('noFieldChanges')}</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="bg-surface-muted text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-start font-medium">{t('field')}</th>
            {entry.action !== 'insert' ? <th className="px-3 py-2 text-start font-medium">{t('before')}</th> : null}
            {entry.action !== 'delete' ? <th className="px-3 py-2 text-start font-medium">{t('after')}</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border font-mono" dir="ltr">
          {keys.map((k) => (
            <tr key={k}>
              <td className="px-3 py-1.5 text-muted-foreground">{k}</td>
              {entry.action !== 'insert' ? <td className="max-w-xs truncate px-3 py-1.5 text-danger">{formatValue(entry.before?.[k])}</td> : null}
              {entry.action !== 'delete' ? <td className="max-w-xs truncate px-3 py-1.5 text-success">{formatValue(entry.after?.[k])}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditLog({
  entries,
  page,
  hasNext,
  tables,
  actors,
}: {
  entries: AuditEntry[];
  page: number;
  hasNext: boolean;
  tables: string[];
  actors: { id: string; name: string }[];
}) {
  const t = useTranslations('admin.audit');
  const tc = useTranslations('common');
  const f = useFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState<number | null>(null);
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const tableLabel = (name: string) => (t.has(`tables.${name}` as never) ? t(`tables.${name}` as never) : name);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="sm:w-56">
          <NativeSelect aria-label={t('filterTable')} value={params.get('table') ?? ''} onChange={(e) => setParam('table', e.target.value || null)}>
            <option value="">{`${t('filterTable')}: ${tc('all')}`}</option>
            {tables.map((name) => (
              <option key={name} value={name}>
                {tableLabel(name)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="sm:w-56">
          <NativeSelect aria-label={t('filterActor')} value={params.get('actor') ?? ''} onChange={(e) => setParam('actor', e.target.value || null)}>
            <option value="">{`${t('filterActor')}: ${tc('all')}`}</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="sm:w-44">
          <NativeSelect aria-label={t('filterAction')} value={params.get('action') ?? ''} onChange={(e) => setParam('action', e.target.value || null)}>
            <option value="">{`${t('filterAction')}: ${tc('all')}`}</option>
            {(['insert', 'update', 'delete'] as const).map((a) => (
              <option key={a} value={a}>
                {t(`actionsLabel.${a}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <Card className="divide-y divide-border">
        {entries.length === 0 ? (
          <EmptyState icon={ScrollText} title={t('empty')} description={t('emptyHint')} compact />
        ) : (
          entries.map((e) => (
            <div key={e.id}>
              <button
                type="button"
                onClick={() => setOpen(open === e.id ? null : e.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-muted/60"
                aria-expanded={open === e.id}
              >
                <Avatar name={e.actor?.name ?? t('system')} src={publicAssetUrl(e.actor?.avatarPath)} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{e.actor?.name ?? t('system')}</span>{' '}
                    <span className="text-muted-foreground">
                      {t(`actions.${e.action}`)} {tableLabel(e.tableName)}
                    </span>
                  </p>
                  <p className="text-xs text-subtle-foreground">
                    {f.dateTime(e.createdAt)}
                    {e.changedFields?.length ? ` · ${e.changedFields.join(', ')}` : ''}
                  </p>
                </div>
                <Badge tone={actionTone[e.action]}>{t(`actionsLabel.${e.action}`)}</Badge>
                <ChevronDown className={cn('size-4 text-subtle-foreground transition-transform', open === e.id && 'rotate-180')} aria-hidden />
              </button>
              {open === e.id ? (
                <div className="px-4 pb-4">
                  <Diff entry={e} />
                </div>
              ) : null}
            </div>
          ))
        )}
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t('page', { page })}</span>
        <div className="flex gap-1">
          <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))} aria-label={tc('previousPage')}>
            <DirIcon icon={ChevronLeft} />
          </Button>
          <Button variant="outline" size="icon-sm" disabled={!hasNext} onClick={() => setParam('page', String(page + 1))} aria-label={tc('nextPage')}>
            <DirIcon icon={ChevronRight} />
          </Button>
        </div>
      </div>
    </div>
  );
}
