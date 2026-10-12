'use client';

import { CheckCircle2, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Badge, Card, Checkbox, Label, NativeSelect } from '@/components/ui/primitives';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { useAction } from '@/lib/actions/use-action';
import type { KpiKey } from '@/modules/executive/catalog';
import { viewSearch } from '@/modules/executive/config';
import { addNoteAction, resolveNoteAction } from '@/modules/executive/server/actions';
import type { NoteRow } from '@/modules/executive/server/queries';
import { nameText, type ExecKit } from '@/modules/executive/text';
import type { ExecutiveViewConfig } from '@/modules/executive/types';

export function NoteDialog({
  kit,
  kpi,
  config,
  people,
  clients,
  onClose,
}: {
  kit: ExecKit;
  kpi: KpiKey | null;
  config: ExecutiveViewConfig;
  people: { id: string; name: string }[];
  clients: { id: string; name: unknown }[];
  onClose: () => void;
}) {
  const { t } = kit;
  const tc = useTranslations('common');
  const [body, setBody] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [asTask, setAsTask] = useState(false);
  const [clientId, setClientId] = useState(config.filters.clientId ?? '');
  const [dueDate, setDueDate] = useState('');
  const { run, pending } = useAction(addNoteAction, { successMessage: t('notes.sent'), onSuccess: onClose });
  const kpiName = kpi ? t(`kpi.${kpi}.name`) : '';
  const taskReady = !asTask || (ownerId && clientId);

  return (
    <Dialog open={kpi !== null} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent closeLabel={tc('close')}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!kpi) return;
            void run({
              kpi,
              body: body.trim(),
              context: config,
              ownerId: ownerId || null,
              asTask: asTask && Boolean(ownerId),
              clientId: asTask ? clientId || null : null,
              dueDate: asTask && dueDate ? dueDate : null,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('notes.title', { kpi: kpiName })}</DialogTitle>
            <DialogDescription>{t('notes.description')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid gap-1.5">
              <Label htmlFor="note-body">{t('notes.body')}</Label>
              <Textarea
                id="note-body"
                value={body}
                maxLength={2000}
                rows={4}
                required
                onChange={(e) => setBody(e.target.value)}
                data-testid="note-body"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="note-owner">{t('notes.owner')}</Label>
              <NativeSelect id="note-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} data-testid="note-owner">
                <option value="">{t('notes.noOwner')}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {ownerId ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={asTask} onCheckedChange={(v) => setAsTask(v === true)} data-testid="note-as-task" />
                {t('notes.asTask')}
              </label>
            ) : null}
            {ownerId && asTask ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="note-client">{t('notes.client')}</Label>
                  <NativeSelect
                    id="note-client"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    required
                    data-testid="note-client"
                  >
                    <option value="">—</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {nameText(kit, c.name)}
                      </option>
                    ))}
                  </NativeSelect>
                  <p className="text-xs text-subtle-foreground">{t('notes.clientHint')}</p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="note-due">{t('notes.dueDate')}</Label>
                  <Input id="note-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('notes.cancel')}
            </Button>
            <Button type="submit" disabled={pending || !body.trim() || !taskReady} data-testid="note-send">
              {t('notes.send')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function NotesPanel({ kit, notes, names, me }: { kit: ExecKit; notes: NoteRow[]; names: Record<string, string>; me: string }) {
  const { t, f } = kit;
  const resolve = useAction(resolveNoteAction);
  return (
    <Card className="space-y-2 p-5" data-testid="notes-panel">
      <h3 className="text-sm font-semibold">{t('notes.list')}</h3>
      {notes.length === 0 ? (
        <EmptyState compact icon={MessageSquare} title={t('notes.empty')} />
      ) : (
        <ul className="divide-y divide-border">
          {notes.map((n) => {
            const author = (n.authorId && names[n.authorId]) || '—';
            const owner = n.ownerId ? names[n.ownerId] : null;
            return (
              <li key={n.id} className="space-y-1 py-2.5" data-testid="note-item">
                <div className="flex flex-wrap items-center gap-2 text-xs text-subtle-foreground">
                  <Badge tone="brand">{t(`kpi.${n.kpi}.name`)}</Badge>
                  <span>{owner ? t('notes.by', { author, owner }) : t('notes.byNoOwner', { author })}</span>
                  <span>{f.relative(n.createdAt)}</span>
                  {n.resolvedAt ? (
                    <Badge tone="success">
                      <CheckCircle2 />
                      {t('notes.resolved')}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm whitespace-pre-line">{n.body}</p>
                <div className="flex flex-wrap gap-3 text-xs">
                  <Link href={`/executive${viewSearch(n.context)}`} className="text-primary hover:underline">
                    {t('notes.open')}
                  </Link>
                  {n.taskId ? (
                    <Link href={`/tasks?task=${n.taskId}`} className="text-primary hover:underline">
                      {t('notes.taskLink')}
                    </Link>
                  ) : null}
                  {!n.resolvedAt && (n.authorId === me || n.ownerId === me) ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => resolve.run({ id: n.id })}
                      disabled={resolve.pending}
                    >
                      {t('notes.resolve')}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
