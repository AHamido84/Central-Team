'use client';

import { RotateCcw, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Badge, Card, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { can } from '@/lib/permissions/can';
import { purgePermission, trashTypes, type TrashType } from '@/modules/data/constants';
import { emptyTrashAction, trashPurgeAction, trashRestoreAction } from '@/modules/data/server/actions';
import type { TrashListItem } from '@/modules/data/server/queries';

/** The Trash (ADR-080): restore any entry you can see; delete for good what your role may purge. */
export function TrashList({ items, permissions }: { items: TrashListItem[]; permissions: string[] }) {
  const t = useTranslations('data.trash');
  const td = useTranslations('data.delete');
  const tc = useTranslations('common');
  const f = useFormat();
  const locale = useLocale() as Locale;
  const [type, setType] = useState<TrashType | ''>('');
  const [purging, setPurging] = useState<TrashListItem | null>(null);
  const [emptying, setEmptying] = useState(false);
  const restore = useAction(trashRestoreAction, { successMessage: t('restored') });
  const purge = useAction(trashPurgeAction, { successMessage: t('purged') });
  const empty = useAction(emptyTrashAction, { onSuccess: (d) => toast.success(t('emptied', { count: d.purged })) });

  const present = useMemo(() => trashTypes.filter((k) => items.some((i) => i.entityType === k)), [items]);
  const shown = type ? items.filter((i) => i.entityType === type) : items;
  const purgeable = items.filter((i) => can(permissions, purgePermission(i.entityType)));

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState icon={Trash2} title={t('empty')} description={t('emptyHint')} />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('filterType')}
          <NativeSelect value={type} onChange={(e) => setType(e.target.value as TrashType | '')} className="w-56" data-testid="trash-type">
            <option value="">{t('all')}</option>
            {present.map((k) => (
              <option key={k} value={k}>
                {t(`types.${k}`)}
              </option>
            ))}
          </NativeSelect>
        </label>
        {purgeable.length ? (
          <Button variant="outline" onClick={() => setEmptying(true)} data-testid="trash-empty">
            <Trash2 aria-hidden />
            {t('emptyTrash')}
          </Button>
        ) : null}
      </div>
      <Card className="divide-y divide-border p-0">
        <ul className="divide-y divide-border">
          {shown.map((item) => {
            const withItems = Object.entries(item.counts)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => td(`count.${k}` as 'count.tasks', { count: n }));
            return (
              <li key={item.batch} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-testid="trash-item">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{t(`types.${item.entityType}`)}</Badge>
                    <bdi className="truncate font-medium">{item.title}</bdi>
                    {item.client ? (
                      <span className="text-sm text-muted-foreground">
                        · <bdi>{localized(item.client.name, locale)}</bdi>
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.deletedBy
                      ? t('deletedBy', { name: item.deletedBy, when: f.relative(item.deletedAt) })
                      : t('deletedWhen', { when: f.relative(item.deletedAt) })}
                  </p>
                  {withItems.length ? (
                    <p className="mt-1 text-xs text-muted-foreground">{t('with', { items: f.list(withItems) })}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    loading={restore.pending}
                    onClick={() => void restore.run({ batch: item.batch })}
                    data-testid="trash-restore"
                  >
                    <RotateCcw aria-hidden />
                    {t('restore')}
                  </Button>
                  {can(permissions, purgePermission(item.entityType)) ? (
                    <Button size="sm" variant="destructive" onClick={() => setPurging(item)} data-testid="trash-purge">
                      <Trash2 aria-hidden />
                      {t('purge')}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      <ConfirmDialog
        open={Boolean(purging)}
        onOpenChange={(o) => !o && setPurging(null)}
        title={t('purgeTitle')}
        description={
          <>
            <bdi className="font-medium text-foreground">{purging?.title}</bdi> — {t('purgeBody')}
          </>
        }
        confirmLabel={t('purge')}
        cancelLabel={tc('cancel')}
        destructive
        onConfirm={() => purging && purge.run({ batch: purging.batch }).then(() => setPurging(null))}
      />
      <ConfirmDialog
        open={emptying}
        onOpenChange={setEmptying}
        title={t('emptyTrashTitle')}
        description={t('emptyTrashBody')}
        confirmLabel={t('emptyTrash')}
        cancelLabel={tc('cancel')}
        destructive
        onConfirm={() => empty.run({ batches: purgeable.map((i) => i.batch).slice(0, 500) })}
      />
    </div>
  );
}
