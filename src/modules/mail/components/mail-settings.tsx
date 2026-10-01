'use client';

import { AlertTriangle, CheckCircle2, ExternalLink, Mail, PlugZap, Save, Send, Trash2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/overlays';
import { Badge, Card, CardContent, CardHeader, CardTitle, NativeSelect, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import {
  mailPresets,
  mailSecurities,
  presetDefaults,
  type MailErrorCode,
  type MailPreset,
  type MailSecurity,
} from '@/modules/mail/constants';
import { fromMismatch, type MailSettingsInput } from '@/modules/mail/schemas';
import {
  deleteMailSettingsAction,
  saveMailSettingsAction,
  sendTestEmailAction,
  testMailConnectionAction,
} from '@/modules/mail/server/actions';
import type { MailOverview } from '@/modules/mail/server/queries';

type Form = {
  preset: MailPreset;
  host: string;
  port: string;
  security: MailSecurity;
  username: string;
  secret: string;
  fromNameAr: string;
  fromNameEn: string;
  fromEmail: string;
  replyTo: string;
  dailyLimit: string;
  isActive: boolean;
};

function initialForm(o: MailOverview): Form {
  const s = o.settings;
  const preset = s?.preset ?? 'gmail';
  const d = presetDefaults[preset];
  return {
    preset,
    host: s?.host ?? d.host ?? '',
    port: String(s?.port ?? d.port ?? ''),
    security: s?.security ?? d.security,
    username: s?.username ?? '',
    secret: '',
    fromNameAr: s?.fromName.ar ?? '',
    fromNameEn: s?.fromName.en ?? '',
    fromEmail: s?.fromEmail ?? '',
    replyTo: s?.replyTo ?? '',
    dailyLimit: String(s?.dailyLimit ?? d.dailyLimit ?? ''),
    isActive: s?.isActive ?? true,
  };
}

const toInput = (f: Form): MailSettingsInput => ({
  preset: f.preset,
  host: f.host,
  port: f.port ? Number(f.port) : null,
  security: f.security,
  username: f.username,
  secret: f.secret,
  fromNameAr: f.fromNameAr,
  fromNameEn: f.fromNameEn,
  fromEmail: f.fromEmail,
  replyTo: f.replyTo,
  dailyLimit: f.dailyLimit ? Number(f.dailyLimit) : null,
  isActive: f.isActive,
});

/** Settings → Mail (FR2.1 / ADR-088): the organization's sender, its tests and its health. */
export function MailSettings({ overview, me }: { overview: MailOverview; me: string }) {
  const t = useTranslations('mail');
  const tv = useTranslations('validation');
  const [form, setForm] = useState<Form>(() => initialForm(overview));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ ok: boolean; code: MailErrorCode | null } | null>(null);
  const [testTo, setTestTo] = useState(me);
  const [removing, setRemoving] = useState(false);
  const save = useAction(saveMailSettingsAction, { successMessage: t('saved') });
  const test = useAction(testMailConnectionAction);
  const sendTest = useAction(sendTestEmailAction);
  const remove = useAction(deleteMailSettingsAction, { successMessage: t('removed') });
  const d = presetDefaults[form.preset];
  const saved = overview.settings;
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const mismatch = fromMismatch({ preset: form.preset, username: form.username, fromEmail: form.fromEmail });

  const pickPreset = (preset: MailPreset) => {
    const p = presetDefaults[preset];
    set({
      preset,
      host: p.host ?? (preset === form.preset ? form.host : ''),
      port: String(p.port ?? ''),
      security: p.security,
      dailyLimit: String(p.dailyLimit ?? ''),
    });
    setTestResult(null);
  };

  const fieldErrors = (fe?: Record<string, string[]>) =>
    setErrors(Object.fromEntries(Object.entries(fe ?? {}).map(([k, v]) => [k, tv(v[0] as 'required')])));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card data-testid="mail-settings">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="size-4" aria-hidden />
            {t('tabs.settings')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-5"
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await save.run(toInput(form));
              if (res.ok) {
                setErrors({});
                set({ secret: '' });
              } else fieldErrors(res.error.fieldErrors);
            }}
          >
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">{t('fields.preset')}</legend>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('fields.preset')}>
                {mailPresets.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={form.preset === p}
                    onClick={() => pickPreset(p)}
                    className={
                      'rounded-lg border p-3 text-start transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ' +
                      (form.preset === p ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-muted')
                    }
                    data-testid={`mail-preset-${p}`}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {t(`presets.${p}.name`)}
                      {p === 'resend' ? <Badge tone="brand">{t('recommended')}</Badge> : null}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">{t(`presets.${p}.hint`)}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {form.preset === 'gmail' || form.preset === 'google_workspace' ? (
              <div className="rounded-lg border border-border bg-surface-muted/50 p-4 text-sm" data-testid="mail-gmail-steps">
                <p className="font-medium">{t('gmailSteps.title')}</p>
                <ol className="mt-2 list-decimal space-y-1 ps-5 text-muted-foreground">
                  <li>{t('gmailSteps.step1')}</li>
                  <li>{t('gmailSteps.step2')}</li>
                  <li>{t('gmailSteps.step3')}</li>
                </ol>
                <a
                  href={d.helpUrl ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 font-medium text-primary underline"
                >
                  {t('gmailSteps.link')}
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
                {form.preset === 'gmail' ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {t('gmailSteps.limit')}
                  </p>
                ) : null}
              </div>
            ) : form.preset === 'microsoft365' ? (
              <p className="rounded-lg border border-border bg-surface-muted/50 p-3 text-sm text-muted-foreground">{t('outlookNote')}</p>
            ) : null}

            {!d.api ? (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_11rem]">
                <Field label={t('fields.host')} required error={errors.host}>
                  {(p) => (
                    <Input {...p} dir="ltr" value={form.host} onChange={(e) => set({ host: e.target.value })} data-testid="mail-host" />
                  )}
                </Field>
                <Field label={t('fields.port')} required>
                  {(p) => (
                    <Input
                      {...p}
                      dir="ltr"
                      type="number"
                      min={1}
                      max={65535}
                      value={form.port}
                      onChange={(e) => set({ port: e.target.value })}
                      data-testid="mail-port"
                    />
                  )}
                </Field>
                <Field label={t('fields.security')}>
                  {(p) => (
                    <NativeSelect
                      {...p}
                      value={form.security}
                      onChange={(e) => set({ security: e.target.value as MailSecurity })}
                      data-testid="mail-security"
                    >
                      {mailSecurities.map((s) => (
                        <option key={s} value={s}>
                          {t(`security.${s}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              {!d.api ? (
                <Field label={t('fields.username')} required={form.preset !== 'smtp'} error={errors.username}>
                  {(p) => (
                    <Input
                      {...p}
                      dir="ltr"
                      type="email"
                      autoComplete="off"
                      value={form.username}
                      onChange={(e) => set({ username: e.target.value })}
                      data-testid="mail-username"
                    />
                  )}
                </Field>
              ) : null}
              <Field
                label={d.api ? t('fields.apiKey') : t('fields.password')}
                required={!saved}
                hint={saved?.secretHint ? t('fields.secretKeep', { hint: saved.secretHint }) : undefined}
                error={errors.secret}
              >
                {(p) => (
                  <Input
                    {...p}
                    dir="ltr"
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    value={form.secret}
                    onChange={(e) => set({ secret: e.target.value })}
                    data-testid="mail-secret"
                  />
                )}
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('fields.fromNameAr')}>
                {(p) => <Input {...p} dir="rtl" value={form.fromNameAr} onChange={(e) => set({ fromNameAr: e.target.value })} />}
              </Field>
              <Field label={t('fields.fromNameEn')}>
                {(p) => <Input {...p} dir="ltr" value={form.fromNameEn} onChange={(e) => set({ fromNameEn: e.target.value })} />}
              </Field>
              <Field label={t('fields.fromEmail')} required error={errors.fromEmail}>
                {(p) => (
                  <Input
                    {...p}
                    dir="ltr"
                    type="email"
                    value={form.fromEmail}
                    onChange={(e) => set({ fromEmail: e.target.value })}
                    data-testid="mail-from"
                  />
                )}
              </Field>
              <Field label={t('fields.replyTo')} optional error={errors.replyTo}>
                {(p) => <Input {...p} dir="ltr" type="email" value={form.replyTo} onChange={(e) => set({ replyTo: e.target.value })} />}
              </Field>
            </div>
            {mismatch ? (
              <p
                className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
                role="alert"
                data-testid="mail-from-mismatch"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <span>
                  {t('fromMismatch', { provider: t(`presets.${form.preset}.name`), username: form.username, from: form.fromEmail })}
                </span>
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('fields.dailyLimit')} hint={t('fields.dailyLimitHint')} optional>
                {(p) => (
                  <Input
                    {...p}
                    dir="ltr"
                    type="number"
                    min={1}
                    value={form.dailyLimit}
                    onChange={(e) => set({ dailyLimit: e.target.value })}
                    data-testid="mail-limit"
                  />
                )}
              </Field>
              <label className="flex items-center justify-between gap-3 self-center text-sm">
                {t('fields.active')}
                <Switch checked={form.isActive} onCheckedChange={(v) => set({ isActive: v })} />
              </label>
            </div>

            {testResult ? (
              <p
                className={'flex items-start gap-2 text-sm ' + (testResult.ok ? 'text-success' : 'text-danger')}
                role="status"
                data-testid="mail-test-result"
              >
                {testResult.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                )}
                {testResult.ok ? t('testOk') : t('testFailed', { reason: t(`errors.${testResult.code ?? 'unknown'}`) })}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {saved ? (
                <Button type="button" variant="ghost" className="me-auto text-danger" onClick={() => setRemoving(true)}>
                  <Trash2 />
                  {t('remove')}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                loading={test.pending}
                onClick={async () => {
                  setTestResult(null);
                  const res = await test.run(toInput(form));
                  if (res.ok) setTestResult({ ok: res.data.ok, code: res.data.code });
                  else fieldErrors(res.error.fieldErrors);
                }}
                data-testid="mail-test"
              >
                <PlugZap />
                {t('test')}
              </Button>
              <Button type="submit" loading={save.pending} data-testid="mail-save">
                <Save />
                {t('save')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid content-start gap-6">
        <MailStatus overview={overview} />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('testSend')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const res = await sendTest.run({ to: testTo });
                if (!res.ok) return;
                if (res.data.status === 'sent') toast.success(res.data.sender === 'dev' ? t('testSentDev') : t('testSent'));
                else toast.error(t('testFailed', { reason: t(`errors.${res.data.code ?? 'unknown'}`) }));
              }}
            >
              <Field label={t('testSendTo')}>
                {(p) => (
                  <Input
                    {...p}
                    dir="ltr"
                    type="email"
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    data-testid="mail-test-to"
                  />
                )}
              </Field>
              <Button type="submit" variant="outline" loading={sendTest.pending} disabled={!testTo} data-testid="mail-test-send">
                <Send />
                {t('testSend')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('removeTitle')}
        description={t('removeBody')}
        confirmLabel={t('remove')}
        cancelLabel={t('cancel')}
        destructive
        onConfirm={async () => {
          const res = await remove.run({});
          setRemoving(false);
          if (res.ok) setForm(initialForm({ ...overview, settings: null }));
        }}
      />
    </div>
  );
}

function MailStatus({ overview: o }: { overview: MailOverview }) {
  const t = useTranslations('mail');
  const f = useFormat();
  const s = o.settings;
  const limit = s?.dailyLimit ?? null;
  const near = limit ? o.sentToday >= Math.ceil(limit * 0.8) : false;
  return (
    <Card data-testid="mail-status">
      <CardHeader>
        <CardTitle className="text-base">{t('status.title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {s?.fallbackSince ? (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-danger" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('status.fallbackAlert', { when: f.relative(s.fallbackSince) })}
          </p>
        ) : null}
        <dl className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{t('status.active')}</dt>
            <dd>
              <Badge
                tone={o.activeSender === 'configured' ? 'success' : o.activeSender === 'fallback' ? 'danger' : 'neutral'}
                data-testid="mail-active-sender"
              >
                {t(`senders.${o.activeSender}`)}
              </Badge>
            </dd>
          </div>
          {s ? (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{t('fields.fromEmail')}</dt>
              <dd className="truncate">
                <bdi dir="ltr">{s.fromEmail}</bdi>
              </dd>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{t('status.lastSuccess')}</dt>
            <dd>{s?.lastSuccessAt ? f.relative(s.lastSuccessAt) : t('status.never')}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{t('status.today')}</dt>
            <dd className={near ? 'font-medium text-warning' : undefined} data-testid="mail-sent-today">
              {limit ? t('status.todayOf', { sent: f.number(o.sentToday), limit: f.number(limit) }) : f.number(o.sentToday)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{t('status.failedToday')}</dt>
            <dd className={o.failedToday ? 'text-danger' : undefined}>{f.number(o.failedToday)}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">{t('status.queued')}</dt>
            <dd>{f.number(o.queued)}</dd>
          </div>
          {s?.lastTestedAt ? (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{t('status.lastTest')}</dt>
              <dd className={s.lastTestOk ? 'text-success' : 'text-danger'}>
                {s.lastTestOk
                  ? t('status.testOk', { when: f.relative(s.lastTestedAt) })
                  : t('status.testFailed', { when: f.relative(s.lastTestedAt) })}
              </dd>
            </div>
          ) : null}
        </dl>
        {near ? <p className="text-xs text-warning">{t('status.limitWarning')}</p> : null}
        <p className="text-xs text-muted-foreground">
          <bdi dir="ltr">{t('status.environment', { provider: o.environment.provider, from: o.environment.from })}</bdi>
        </p>
      </CardContent>
    </Card>
  );
}
