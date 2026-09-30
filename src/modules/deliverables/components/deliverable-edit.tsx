'use client';

import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { updateDeliverableAction } from '@/modules/deliverables/server/actions';
import type { DeliverableDetail } from '@/modules/deliverables/server/queries';

/** Edits a deliverable's title, date and review steps (agency, `deliverables:manage`). */
export function EditDeliverableButton({ d, onSaved }: { d: DeliverableDetail; onSaved: () => void }) {
  const t = useTranslations('deliverables.edit');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="deliverable-edit">
        <Pencil aria-hidden />
        {t('button')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={tc('close')}>
          {open ? <EditForm d={d} onDone={() => (setOpen(false), onSaved())} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditForm({ d, onDone }: { d: DeliverableDetail; onDone: () => void }) {
  const t = useTranslations('deliverables.edit');
  const tc = useTranslations('common');
  const [title, setTitle] = useState(d.title);
  const [scheduledFor, setScheduledFor] = useState(d.scheduledFor ?? '');
  const [internal, setInternal] = useState(d.requiresInternalReview);
  const [client, setClient] = useState(d.requiresClientApproval);
  const save = useAction(updateDeliverableAction, { successMessage: tc('saved') });
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await save.run({
          deliverableId: d.id,
          title: title.trim(),
          scheduledFor: scheduledFor || null,
          requiresInternalReview: internal,
          requiresClientApproval: client,
        });
        if (res.ok) onDone();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
      </DialogHeader>
      <DialogBody className="grid gap-4">
        <Field label={t('name')} required>
          {(p) => (
            <Input
              {...p}
              value={title}
              maxLength={200}
              dir="auto"
              onChange={(e) => setTitle(e.target.value)}
              data-testid="deliverable-title-input"
            />
          )}
        </Field>
        <Field label={t('scheduledFor')} optional>
          {(p) => <Input {...p} type="date" dir="ltr" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />}
        </Field>
        <label className="flex items-center justify-between gap-3 text-sm">
          {t('internalReview')}
          <Switch checked={internal} onCheckedChange={setInternal} />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          {t('clientApproval')}
          <Switch checked={client} onCheckedChange={setClient} />
        </label>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {tc('cancel')}
        </Button>
        <Button type="submit" disabled={!title.trim()} loading={save.pending} data-testid="deliverable-save">
          {tc('save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
