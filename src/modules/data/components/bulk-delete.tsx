'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import type { TrashType } from '@/modules/data/constants';
import { trashDeleteManyAction } from '@/modules/data/server/actions';

/**
 * Bulk delete for list and table views: lists what's selected and asks to type the number of items. Each row goes
 * to the Trash as its own entry, so they can be restored one by one.
 */
export function BulkDeleteButton({ type, items, onDone }: { type: TrashType; items: { id: string; name: string }[]; onDone?: () => void }) {
  const t = useTranslations('data.bulk');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const count = String(items.length);
  const run = async () => {
    setPending(true);
    const res = await trashDeleteManyAction({ type, ids: items.map((i) => i.id) });
    setPending(false);
    if (!res.ok) {
      toast.error(te(res.error.code));
      return;
    }
    toast.success(t('done', { count: res.data.count }));
    setOpen(false);
    setTyped('');
    onDone?.();
    router.refresh();
  };
  return (
    <>
      <Button size="sm" variant="destructive" onClick={() => setOpen(true)} data-testid="bulk-delete">
        <Trash2 aria-hidden />
        {t('button', { count: items.length })}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={tc('close')}>
          <DialogHeader>
            <DialogTitle>{t('title', { count: items.length })}</DialogTitle>
            <DialogDescription>{t('body')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <ul className="max-h-40 overflow-y-auto rounded-md border border-border p-2 text-sm">
              {items.slice(0, 50).map((i) => (
                <li key={i.id} className="truncate">
                  <bdi>{i.name}</bdi>
                </li>
              ))}
              {items.length > 50 ? <li className="text-subtle-foreground">{t('more', { count: items.length - 50 })}</li> : null}
            </ul>
            <Field label={t('typeCount', { count: items.length })}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  dir="ltr"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  data-testid="bulk-delete-count"
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={typed.trim() !== count}
              loading={pending}
              onClick={() => void run()}
              data-testid="bulk-delete-confirm"
            >
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
