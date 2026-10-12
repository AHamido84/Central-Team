'use client';

import { CalendarClock, FileSpreadsheet, FileText, Pencil, Plus, Presentation, Send, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Badge, Card, Label, NativeSelect, Switch } from '@/components/ui/primitives';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import { useAction } from '@/lib/actions/use-action';
import { useExecKit } from '@/modules/executive/components/use-kit';
import { deleteScheduleAction, saveScheduleAction, sendScheduleNowAction } from '@/modules/executive/server/actions';
import type { ScheduleRow } from '@/modules/executive/server/queries';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function BoardReports({
  schedules,
  canExport,
  canSchedule,
}: {
  schedules: ScheduleRow[];
  canExport: boolean;
  canSchedule: boolean;
}) {
  const kit = useExecKit();
  const { t, f } = kit;
  const tc = useTranslations('common');
  const [editing, setEditing] = useState<ScheduleRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ScheduleRow | null>(null);
  const remove = useAction(deleteScheduleAction, { successMessage: t('reports.deleted') });
  const sendNow = useAction(sendScheduleNowAction, { onSuccess: (d) => toast.success(t('reports.queued', { count: d.recipients })) });

  return (
    <div className="space-y-6">
      {canExport ? (
        <Card className="space-y-3 p-5">
          <h2 className="text-sm font-semibold">{t('reports.download')}</h2>
          <p className="text-sm text-muted-foreground">{t('reports.downloadHint')}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href="/api/executive/export?format=pdf" download data-testid="reports-pdf">
                <FileText />
                {t('export.pdf')}
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href="/api/executive/export?format=pptx" download data-testid="reports-pptx">
                <Presentation />
                {t('export.pptx')}
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href="/api/executive/export?format=xlsx" download data-testid="reports-xlsx">
                <FileSpreadsheet />
                {t('export.xlsx')}
              </a>
            </Button>
          </div>
        </Card>
      ) : null}

      {canSchedule ? (
        <Card className="space-y-4 p-5" data-testid="schedules">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">{t('reports.schedules')}</h2>
              <p className="text-xs text-subtle-foreground">{t('reports.mailNote')}</p>
            </div>
            <Button onClick={() => setEditing('new')} data-testid="schedule-new">
              <Plus />
              {t('reports.new')}
            </Button>
          </div>
          {schedules.length === 0 ? (
            <EmptyState compact icon={CalendarClock} title={t('reports.empty')} description={t('reports.emptyBody')} />
          ) : (
            <ul className="divide-y divide-border">
              {schedules.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-3" data-testid="schedule-row">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t(`reports.cadenceShort.${s.cadence}`)}</span>
                      <Badge tone="neutral">{s.locale === 'ar' ? tc('arabic') : tc('english')}</Badge>
                      <Badge tone={s.isActive ? 'success' : 'neutral'}>{s.isActive ? t('reports.active') : t('reports.paused')}</Badge>
                    </div>
                    <p className="truncate text-sm text-muted-foreground" dir="ltr">
                      {s.recipients.join(', ')}
                    </p>
                    <p className="text-xs text-subtle-foreground">
                      {s.isActive ? t('reports.nextRun', { date: f.date(`${s.nextRunOn}T12:00:00Z`) }) : null}
                      {s.isActive ? ' · ' : null}
                      {s.lastRunAt ? t('reports.lastRun', { time: f.dateTime(s.lastRunAt) }) : t('reports.never')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => sendNow.run({ id: s.id })}
                      disabled={sendNow.pending}
                      data-testid="schedule-send-now"
                    >
                      <Send />
                      {t('reports.sendNow')}
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={t('reports.edit')} onClick={() => setEditing(s)}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={t('reports.delete')} onClick={() => setDeleting(s)}>
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {editing ? (
        <ScheduleDialog
          key={editing === 'new' ? 'new' : editing.id}
          schedule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => (o ? null : setDeleting(null))}
        title={t('reports.delete')}
        description={t('reports.deleteBody')}
        confirmLabel={t('reports.delete')}
        cancelLabel={t('reports.cancel')}
        destructive
        onConfirm={async () => {
          if (deleting) await remove.run({ id: deleting.id });
          setDeleting(null);
        }}
      />
    </div>
  );
}

function ScheduleDialog({ schedule, onClose }: { schedule: ScheduleRow | null; onClose: () => void }) {
  const kit = useExecKit();
  const { t } = kit;
  const tc = useTranslations('common');
  const [cadence, setCadence] = useState<'weekly' | 'monthly'>(schedule?.cadence ?? 'monthly');
  const [locale, setLocale] = useState<'ar' | 'en'>(schedule?.locale ?? kit.locale);
  const [recipients, setRecipients] = useState((schedule?.recipients ?? []).join('\n'));
  const [isActive, setIsActive] = useState(schedule?.isActive ?? true);
  const [invalid, setInvalid] = useState<string[]>([]);
  const { run, pending } = useAction(saveScheduleAction, { successMessage: t('reports.saved'), onSuccess: onClose });

  const submit = () => {
    const list = [
      ...new Set(
        recipients
          .split(/[\s,;،]+/)
          .map((r) => r.trim())
          .filter(Boolean),
      ),
    ];
    const bad = list.filter((r) => !EMAIL.test(r));
    setInvalid(bad);
    if (bad.length || list.length === 0 || list.length > 20) return;
    void run({ id: schedule?.id ?? null, cadence, locale, recipients: list, isActive });
  };

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent closeLabel={tc('close')}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{schedule ? t('reports.edit') : t('reports.new')}</DialogTitle>
            <DialogDescription>{t('reports.mailNote')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid gap-1.5">
              <Label htmlFor="schedule-cadence">{t('reports.cadence')}</Label>
              <NativeSelect
                id="schedule-cadence"
                value={cadence}
                onChange={(e) => setCadence(e.target.value as 'weekly' | 'monthly')}
                data-testid="schedule-cadence"
              >
                <option value="weekly">{t('reports.cadences.weekly')}</option>
                <option value="monthly">{t('reports.cadences.monthly')}</option>
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="schedule-locale">{t('reports.language')}</Label>
              <NativeSelect id="schedule-locale" value={locale} onChange={(e) => setLocale(e.target.value as 'ar' | 'en')}>
                <option value="ar">{tc('arabic')}</option>
                <option value="en">{tc('english')}</option>
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="schedule-recipients">{t('reports.recipients')}</Label>
              <Textarea
                id="schedule-recipients"
                dir="ltr"
                rows={3}
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                aria-invalid={invalid.length ? true : undefined}
                data-testid="schedule-recipients"
              />
              <p
                className={invalid.length ? 'text-xs text-danger' : 'text-xs text-subtle-foreground'}
                role={invalid.length ? 'alert' : undefined}
              >
                {invalid.length ? t('reports.invalidEmails', { list: invalid.join(', ') }) : t('reports.recipientsHint')}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              {t('reports.active')}
            </label>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('reports.cancel')}
            </Button>
            <Button type="submit" disabled={pending} data-testid="schedule-save">
              {t('reports.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
