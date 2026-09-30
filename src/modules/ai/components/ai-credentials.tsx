'use client';

import { CheckCircle2, KeyRound, Pencil, PlugZap, Plus, Trash2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
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
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, NativeSelect, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import {
  createAiCredentialAction,
  deleteAiCredentialAction,
  testAiCredentialAction,
  updateAiCredentialAction,
} from '@/modules/ai/server/actions';
import type { AiCredentialView } from '@/modules/ai/server/queries';

type Provider = AiCredentialView['provider'];
const providers: Provider[] = ['anthropic', 'voyage'];

/**
 * Provider keys for this organization (FR1.5 / ADR-085): add, rotate, limit, switch on/off, test. Keys are sent once
 * and stored in Vault; the page only ever shows the masked hint.
 */
export function AiCredentials({ credentials, sources }: { credentials: AiCredentialView[]; sources: Record<Provider, boolean> }) {
  const t = useTranslations('ai.admin.credentials');
  const te = useTranslations('errors');
  const f = useFormat();
  const [editing, setEditing] = useState<AiCredentialView | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AiCredentialView | null>(null);
  const test = useAction(testAiCredentialAction);
  const remove = useAction(deleteAiCredentialAction, { successMessage: t('deleted') });
  const toggle = useAction(updateAiCredentialAction, { successMessage: t('saved') });

  return (
    <Card data-testid="ai-credentials">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" aria-hidden />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing('new')} data-testid="ai-key-add">
          <Plus />
          {t('add')}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          {providers.map((p) => (
            <Badge key={p} tone={sources[p] ? 'success' : 'neutral'} data-testid={`ai-source-${p}`}>
              {t(`providers.${p}`)} · {sources[p] ? t('orgKey') : t('envFallback')}
            </Badge>
          ))}
        </div>
        {credentials.length === 0 ? (
          <EmptyState compact icon={KeyRound} title={t('empty')} />
        ) : (
          <ul className="grid gap-2">
            {credentials.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center"
                data-testid="ai-key-row"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {c.displayName}
                    <Badge tone="outline">{t(`providers.${c.provider}`)}</Badge>
                    {c.lastTestOk === true ? (
                      <Badge tone="success">
                        <CheckCircle2 />
                        {t('testOk')}
                      </Badge>
                    ) : c.lastTestOk === false ? (
                      <Badge tone="danger">
                        <XCircle />
                        {t('testFailed')}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('masked')}:{' '}
                    <bdi dir="ltr" className="font-mono" data-testid="ai-key-hint">
                      {c.keyHint}
                    </bdi>
                    {c.defaultModel ? (
                      <>
                        {' · '}
                        <bdi dir="ltr">{c.defaultModel}</bdi>
                      </>
                    ) : null}
                    {' · '}
                    {c.monthlyTokenLimit != null
                      ? t('used', { used: f.number(c.usedThisMonth), limit: f.number(c.monthlyTokenLimit) })
                      : t('usedNoLimit', { used: f.number(c.usedThisMonth) })}
                    {' · '}
                    {c.lastTestedAt ? t('testedAt', { when: f.relative(c.lastTestedAt) }) : t('never')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch
                      checked={c.isActive}
                      aria-label={t('active')}
                      onCheckedChange={(on) =>
                        void toggle.run({
                          id: c.id,
                          displayName: c.displayName,
                          defaultModel: c.defaultModel,
                          monthlyTokenLimit: c.monthlyTokenLimit,
                          isActive: on,
                        })
                      }
                      data-testid="ai-key-active"
                    />
                    {t('active')}
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={test.pending}
                    onClick={async () => {
                      const res = await test.run({ id: c.id });
                      if (res.ok) {
                        if (res.data.ok) toast.success(t('testOk'));
                        else toast.error(te(res.data.code));
                      }
                    }}
                    data-testid="ai-key-test"
                  >
                    <PlugZap />
                    {t('test')}
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label={t('edit')} onClick={() => setEditing(c)} data-testid="ai-key-edit">
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-danger"
                    aria-label={t('delete')}
                    onClick={() => setDeleting(c)}
                    data-testid="ai-key-delete"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent closeLabel={t('cancel')}>
          {editing ? (
            <CredentialForm
              key={editing === 'new' ? 'new' : editing.id}
              credential={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('deleteTitle')}
        description={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        destructive
        onConfirm={() => deleting && remove.run({ id: deleting.id }).then(() => setDeleting(null))}
      />
    </Card>
  );
}

function CredentialForm({ credential, onDone }: { credential: AiCredentialView | null; onDone: () => void }) {
  const t = useTranslations('ai.admin.credentials');
  const te = useTranslations('errors');
  const tv = useTranslations('validation');
  const [provider, setProvider] = useState<Provider>(credential?.provider ?? 'anthropic');
  const [displayName, setName] = useState(credential?.displayName ?? '');
  const [key, setKey] = useState('');
  const [model, setModel] = useState(credential?.defaultModel ?? '');
  const [models, setModels] = useState<string[] | null>(null);
  const [limit, setLimit] = useState(credential?.monthlyTokenLimit != null ? String(credential.monthlyTokenLimit) : '');
  const [active, setActive] = useState(credential?.isActive ?? true);
  const create = useAction(createAiCredentialAction, { successMessage: t('saved') });
  const update = useAction(updateAiCredentialAction, { successMessage: t('saved') });
  const test = useAction(testAiCredentialAction, { refresh: false });
  const keyValid = credential ? key.trim() === '' || key.trim().length >= 8 : key.trim().length >= 8;

  const loadModels = async () => {
    const res = key.trim()
      ? await test.run({ provider, apiKey: key.trim(), model: model || null })
      : credential
        ? await test.run({ id: credential.id })
        : null;
    if (!res?.ok) return;
    if (res.data.ok) {
      setModels(res.data.models);
      if (!model && res.data.models[0]) setModel(res.data.models[0]);
      toast.success(t('testOk'));
    } else toast.error(te(res.data.code));
  };

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const fields = {
          displayName: displayName.trim(),
          defaultModel: model.trim() || null,
          monthlyTokenLimit: limit.trim() === '' ? null : Math.max(0, Math.round(Number(limit))),
          isActive: active,
        };
        const res = credential
          ? await update.run({ id: credential.id, ...fields, apiKey: key.trim() || undefined })
          : await create.run({ provider, apiKey: key.trim(), ...fields });
        if (res.ok) onDone();
      }}
      data-testid="ai-key-form"
    >
      <DialogHeader>
        <DialogTitle>{credential ? t('edit') : t('add')}</DialogTitle>
        <DialogDescription>{t('apiKeyHint')}</DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-4">
        <Field label={t('provider')}>
          {(p) => (
            <NativeSelect
              {...p}
              value={provider}
              disabled={Boolean(credential)}
              onChange={(e) => {
                setProvider(e.target.value as Provider);
                setModels(null);
                setModel('');
              }}
              data-testid="ai-key-provider"
            >
              {providers.map((x) => (
                <option key={x} value={x}>
                  {t(`providers.${x}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label={t('name')} required>
          {(p) => <Input {...p} value={displayName} maxLength={80} onChange={(e) => setName(e.target.value)} data-testid="ai-key-name" />}
        </Field>
        <Field
          label={credential ? t('apiKeyReplace') : t('apiKey')}
          required={!credential}
          error={keyValid ? undefined : tv('invalid_key')}
        >
          {(p) => (
            <Input
              {...p}
              type="password"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              data-testid="ai-key-secret"
            />
          )}
        </Field>
        <Field label={t('model')} hint={models ? t('modelsLoaded', { count: models.length }) : undefined}>
          {(p) => (
            <div className="flex gap-2">
              {models ? (
                <NativeSelect {...p} value={model} onChange={(e) => setModel(e.target.value)} className="flex-1" data-testid="ai-key-model">
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Input
                  {...p}
                  dir="ltr"
                  value={model}
                  placeholder={t('modelManual')}
                  onChange={(e) => setModel(e.target.value)}
                  className="flex-1"
                  data-testid="ai-key-model"
                />
              )}
              <Button
                type="button"
                variant="outline"
                loading={test.pending}
                disabled={!key.trim() && !credential}
                onClick={() => void loadModels()}
                data-testid="ai-key-load-models"
              >
                {t('loadModels')}
              </Button>
            </div>
          )}
        </Field>
        <Field label={t('limit')} hint={t('limitHint')} optional>
          {(p) => (
            <Input
              {...p}
              type="number"
              dir="ltr"
              min={0}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              data-testid="ai-key-limit"
            />
          )}
        </Field>
        <label className="flex items-center justify-between gap-3 text-sm">
          {t('active')}
          <Switch checked={active} onCheckedChange={setActive} />
        </label>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button
          type="submit"
          disabled={!displayName.trim() || !keyValid}
          loading={create.pending || update.pending}
          data-testid="ai-key-save"
        >
          {t('save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
