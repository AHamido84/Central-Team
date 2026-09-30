'use client';

import { CheckCircle2, Download, Lock, LockOpen, TriangleAlert, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useFormat } from '@/components/providers';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  Switch,
} from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { cn } from '@/lib/utils/cn';
import { RESET_PHRASE, resetModes, type ResetMode } from '@/modules/data/constants';
import { dataResetPreviewAction, resetJobAction, setResetLockAction, startDataResetAction } from '@/modules/data/server/actions';
import type { ResetJob } from '@/modules/data/server/queries';

type Counts = Record<string, number>;

/** Data management (ADR-081): backup, three reset scopes with live counts, a guarded run with progress, and a lock. */
export function DataManagement({ lockedAt, jobs }: { lockedAt: string | null; jobs: ResetJob[] }) {
  const t = useTranslations('data.reset');
  const f = useFormat();
  const router = useRouter();
  const [mode, setMode] = useState<ResetMode>('demo');
  const [previews, setPreviews] = useState<Partial<Record<ResetMode, Counts>>>({});
  const [confirming, setConfirming] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const running = jobs.find((j) => j.status === 'queued' || j.status === 'running');
  const [job, setJob] = useState<ResetJob | null>(running ?? null);
  const lock = useAction(setResetLockAction, {
    onSuccess: (d) => toast.success(d.locked ? t('lockedToast') : t('unlocked')),
  });

  useEffect(() => {
    if (previews[mode]) return;
    let live = true;
    void dataResetPreviewAction({ mode }).then((res) => {
      if (live && res.ok) setPreviews((p) => ({ ...p, [mode]: res.data }));
    });
    return () => {
      live = false;
    };
  }, [mode, previews]);

  // Poll the job until it settles; the wipe runs on the server after the request returned.
  useEffect(() => {
    if (!job || job.status === 'succeeded' || job.status === 'failed') return;
    const timer = setTimeout(() => {
      void resetJobAction({ jobId: job.id }).then((res) => {
        if (!res.ok) return;
        setJob(res.data);
        if (res.data.status === 'succeeded' || res.data.status === 'failed') {
          setPreviews({});
          router.refresh();
        }
      });
    }, 1200);
    return () => clearTimeout(timer);
  }, [job, router]);

  const counts = previews[mode];
  const locked = Boolean(lockedAt);
  const busy = Boolean(job && (job.status === 'queued' || job.status === 'running'));

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('backup')}</CardTitle>
          <CardDescription>{t('backupHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <a href="/api/admin/data-export" download className={buttonVariants({ variant: 'outline' })} data-testid="data-backup">
            <Download aria-hidden />
            {t('backupButton')}
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              {locked ? <Lock className="size-4" aria-hidden /> : <LockOpen className="size-4" aria-hidden />}
              {t('lock')}
            </CardTitle>
            <CardDescription>{locked ? t('lockedSince', { date: f.dateTime(lockedAt!) }) : t('lockHint')}</CardDescription>
          </div>
          <Switch
            checked={locked}
            aria-label={t('lock')}
            disabled={lock.pending}
            onCheckedChange={(on) => (on ? void lock.run({ locked: true }) : setUnlocking(true))}
            data-testid="data-lock"
          />
        </CardHeader>
      </Card>

      {job ? <JobStatus job={job} /> : null}

      <Card aria-disabled={locked}>
        <CardHeader>
          <CardTitle>{t('resetTitle')}</CardTitle>
          {locked ? (
            <p className="flex items-center gap-2 text-sm font-medium text-warning" role="status">
              <Lock className="size-4" aria-hidden />
              {t('locked')}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className={cn('flex flex-col gap-5', locked && 'pointer-events-none opacity-60')}>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as ResetMode)} className="grid gap-3 lg:grid-cols-3">
            {resetModes.map((m) => (
              <label
                key={m}
                className={cn(
                  'flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors',
                  mode === m ? 'border-primary bg-primary-soft/40' : 'hover:bg-muted/40 border-border',
                )}
              >
                <RadioGroupItem value={m} className="mt-0.5" data-testid={`reset-mode-${m}`} disabled={locked} />
                <span>
                  <span className="block font-medium">{t(`modes.${m}.title`)}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{t(`modes.${m}.body`)}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
          <div>
            <p className="text-sm font-medium">{t('willDelete')}</p>
            {counts ? (
              <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-4" data-testid="reset-counts">
                {Object.entries(counts)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => (
                    <li key={k} className="flex justify-between gap-2 border-b border-border/60 py-1">
                      <span className="text-muted-foreground">{t(`category.${k}` as 'category.clients')}</span>
                      <span className="font-medium tabular-nums" data-testid={`reset-count-${k}`}>
                        {f.number(n)}
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-busy aria-label={t('loadingCounts')}>
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-5" />
                ))}
              </div>
            )}
          </div>
          <div>
            <Button variant="destructive" disabled={locked || busy} onClick={() => setConfirming(true)} data-testid="reset-start">
              <TriangleAlert aria-hidden />
              {t('start')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {jobs.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('history')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-border text-sm">
              {jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{t(`modes.${j.mode}.title`)}</span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {f.dateTime(j.createdAt)}
                    <Badge tone={j.status === 'succeeded' ? 'success' : j.status === 'failed' ? 'danger' : 'info'}>
                      {t(`step.${j.status === 'succeeded' ? 'done' : j.status === 'failed' ? 'failed' : 'queued'}`)}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmReset
        open={confirming}
        onOpenChange={setConfirming}
        mode={mode}
        onStarted={(j) => {
          setJob(j);
          setConfirming(false);
        }}
      />
      <UnlockDialog open={unlocking} onOpenChange={setUnlocking} onUnlock={(password) => lock.run({ locked: false, password })} />
    </div>
  );
}

function JobStatus({ job }: { job: ResetJob }) {
  const t = useTranslations('data.reset');
  const step = (job.step ?? 'queued') as 'queued';
  return (
    <Card data-testid="reset-job" data-status={job.status}>
      <CardContent className="flex flex-col gap-3 pt-5">
        {job.status === 'succeeded' ? (
          <p className="flex items-center gap-2 font-medium text-success" role="status">
            <CheckCircle2 className="size-5" aria-hidden />
            {t('succeeded', { files: job.filesRemoved })}
          </p>
        ) : job.status === 'failed' ? (
          <p className="flex items-center gap-2 font-medium text-danger" role="alert">
            <XCircle className="size-5" aria-hidden />
            {t('failed', { error: job.error ?? '' })}
          </p>
        ) : (
          <>
            <p className="text-sm font-medium" role="status">
              {t('progress')} {t(`step.${step}`)}
            </p>
            <Progress value={job.progress} aria-label={t('progress')} />
          </>
        )}
        {job.status === 'succeeded' ? (
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            {Object.entries(job.counts)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => (
                <li key={k} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{t(`category.${k}` as 'category.clients')}</span>
                  <span className="tabular-nums">{n}</span>
                </li>
              ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ConfirmReset({
  open,
  onOpenChange,
  mode,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ResetMode;
  onStarted: (job: ResetJob) => void;
}) {
  const t = useTranslations('data.reset');
  const tc = useTranslations('common');
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const start = useAction(startDataResetAction, { refresh: false, onSuccess: onStarted });
  const close = (o: boolean) => {
    if (!o) {
      setPassword('');
      setPhrase('');
    }
    onOpenChange(o);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent closeLabel={tc('close')} data-testid="reset-dialog">
        <DialogHeader>
          <DialogTitle>{t(`modes.${mode}.title`)}</DialogTitle>
          <DialogDescription>{t(`modes.${mode}.body`)}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <p className="flex items-center gap-2 text-sm">
            <Download className="size-4 shrink-0" aria-hidden />
            <a href="/api/admin/data-export" download className="font-medium text-primary underline-offset-4 hover:underline">
              {t('backupFirst')}
            </a>
          </p>
          <Field label={t('password')} required>
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="reset-password"
              />
            )}
          </Field>
          <Field
            label={
              <>
                {t('phrase')}
                <bdi dir="ltr" className="font-mono font-semibold">
                  {RESET_PHRASE}
                </bdi>
              </>
            }
            required
          >
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                autoComplete="off"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                data-testid="reset-phrase"
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {tc('cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={!password || phrase.trim() !== RESET_PHRASE}
            loading={start.pending}
            onClick={() => void start.run({ mode, password, phrase })}
            data-testid="reset-run"
          >
            {t('run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnlockDialog({
  open,
  onOpenChange,
  onUnlock,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnlock: (password: string) => Promise<{ ok: boolean }>;
}) {
  const t = useTranslations('data.reset');
  const tc = useTranslations('common');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const close = (o: boolean) => {
    if (!o) setPassword('');
    onOpenChange(o);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('unlockTitle')}</DialogTitle>
          <DialogDescription>{t('lockHint')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field label={t('password')} required>
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="unlock-password"
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            {tc('cancel')}
          </Button>
          <Button
            disabled={!password}
            loading={pending}
            onClick={async () => {
              setPending(true);
              const res = await onUnlock(password);
              setPending(false);
              if (res.ok) close(false);
            }}
            data-testid="unlock-confirm"
          >
            {t('unlock')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
