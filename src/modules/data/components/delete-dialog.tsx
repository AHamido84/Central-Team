'use client';

import { AlertTriangle, Ban, Trash2, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { NativeSelect, Skeleton } from '@/components/ui/primitives';
import { alwaysTypeToConfirm, type TrashImpact, type TrashType } from '@/modules/data/constants';
import { trashDeleteAction, trashImpactAction, trashRestoreAction } from '@/modules/data/server/actions';

/** Loads what a delete would take with it when the dialog opens. */
function useImpact(type: TrashType, id: string, open: boolean) {
  const te = useTranslations('errors');
  const [impact, setImpact] = useState<TrashImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void trashImpactAction({ type, id }).then((res) => {
      if (!live) return;
      if (res.ok) setImpact(res.data);
      else setError(te(res.error.code));
    });
    return () => {
      live = false;
    };
  }, [open, type, id, te]);
  return { impact: open ? impact : null, error: open ? error : null };
}

/** Undo from the toast: puts the batch straight back. */
export function useUndoToast() {
  const t = useTranslations('data.delete');
  const te = useTranslations('errors');
  const router = useRouter();
  return (message: string, batch: string) =>
    toast.success(message, {
      action: {
        label: t('undo'),
        onClick: () =>
          void trashRestoreAction({ batch }).then((res) => {
            if (res.ok) {
              toast.success(t('restored'));
              router.refresh();
            } else toast.error(te(res.error.code));
          }),
      },
    });
}

/**
 * The one delete confirmation (no browser `confirm()`): what goes with the item, what blocks it, who takes over a
 * person's open work, and — for deletes that take a lot with them — the item's name typed to confirm. Deleted items
 * go to the Trash (ADR-080).
 */
export function DeleteDialog({
  type,
  id,
  open,
  onOpenChange,
  onDeleted,
  people = [],
  undoable = true,
}: {
  type: TrashType;
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
  /** Candidates to take over a team member's open work. */
  people?: { id: string; name: string }[];
  /** Portal users can't restore from the Trash, so their toast has no Undo. */
  undoable?: boolean;
}) {
  const t = useTranslations('data.delete');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const router = useRouter();
  const undo = useUndoToast();
  const { impact, error } = useImpact(type, id, open);
  const [typed, setTyped] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [pending, setPending] = useState(false);

  const counts = Object.entries(impact?.counts ?? {});
  const blockers = Object.entries(impact?.blockers ?? {});
  const openWork = Object.entries(impact?.openWork ?? {});
  const mustType = Boolean(impact) && (alwaysTypeToConfirm.includes(type) || counts.length > 0);
  const name = impact?.title.trim() ?? '';
  const ready =
    Boolean(impact) && blockers.length === 0 && (!mustType || typed.trim() === name) && (openWork.length === 0 || Boolean(reassignTo));

  const close = (o: boolean) => {
    if (!o) {
      setTyped('');
      setReassignTo('');
    }
    onOpenChange(o);
  };

  const confirm = async () => {
    setPending(true);
    const res = await trashDeleteAction({ type, id, reassignTo: reassignTo || null });
    setPending(false);
    if (!res.ok) {
      toast.error(te(res.error.code));
      return;
    }
    close(false);
    if (undoable) undo(t('deleted', { name }), res.data.batch);
    else toast.success(t('deleted', { name }));
    onDeleted?.();
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent closeLabel={tc('close')} data-testid="delete-dialog">
        <DialogHeader>
          <DialogTitle>{impact ? t('title', { name: `⁨${name}⁩` }) : t('titleLoading')}</DialogTitle>
          <DialogDescription>{t(`body.${type}`)}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : !impact ? (
            <div className="flex flex-col gap-2" aria-busy>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : (
            <>
              {blockers.length ? (
                <div className="rounded-lg border border-danger/40 bg-danger-soft/40 p-3" data-testid="delete-blockers">
                  <p className="flex items-center gap-2 text-sm font-medium text-danger">
                    <Ban className="size-4" aria-hidden />
                    {t('blockedTitle')}
                  </p>
                  <ul className="mt-2 flex flex-col gap-1 text-sm">
                    {blockers.map(([k, n]) => (
                      <li key={k}>{t(`blocker.${k}` as 'blocker.requests', { count: n })}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {counts.length ? (
                <div className="rounded-lg border border-warning/40 bg-warning-soft/40 p-3" data-testid="delete-impact">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <AlertTriangle className="size-4 text-warning" aria-hidden />
                    {t('impactTitle')}
                  </p>
                  <ul className="mt-2 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
                    {counts.map(([k, n]) => (
                      <li key={k} data-testid={`impact-${k}`}>
                        {t(`count.${k}` as 'count.tasks', { count: n })}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {openWork.length ? (
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">{t('openWorkTitle')}</p>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    {openWork.map(([k, n]) => (
                      <li key={k}>{t(`work.${k}` as 'work.tasks', { count: n })}</li>
                    ))}
                  </ul>
                  <Field label={t('reassignLabel')} required>
                    {(p) => (
                      <NativeSelect {...p} value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} data-testid="delete-reassign">
                        <option value="">{t('reassignPick')}</option>
                        {people
                          .filter((x) => x.id)
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                      </NativeSelect>
                    )}
                  </Field>
                </div>
              ) : null}
              {blockers.length === 0 ? (
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Undo2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {t('trashNote')}
                </p>
              ) : null}
              {mustType && blockers.length === 0 ? (
                <Field
                  label={
                    <>
                      {t('typeToConfirm')} <bdi className="font-semibold text-foreground">{name}</bdi>
                    </>
                  }
                >
                  {(p) => (
                    <Input
                      {...p}
                      value={typed}
                      autoComplete="off"
                      dir="auto"
                      onChange={(e) => setTyped(e.target.value)}
                      data-testid="delete-type-name"
                    />
                  )}
                </Field>
              ) : null}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {tc('cancel')}
          </Button>
          <Button variant="destructive" disabled={!ready} loading={pending} onClick={() => void confirm()} data-testid="delete-confirm">
            <Trash2 aria-hidden />
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
