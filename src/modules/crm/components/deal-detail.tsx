'use client';

import { Building2, Download, FileText, Pencil, Plus, Star, Trash2, Upload, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { SectionTitle } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
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
import { Badge, Card, Checkbox, NativeSelect, Switch } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { CRM_FILES_BUCKET } from '@/lib/storage';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { cn } from '@/lib/utils/cn';
import { cities } from '@/modules/clients/constants';
import { ActivityPanel } from '@/modules/crm/components/activity-panel';
import { DealStatusBadge, QuoteStatusBadge } from '@/modules/crm/components/badges';
import { QuoteEditor } from '@/modules/crm/components/quote-editor';
import { leadReference, lostReasons, quoteReference, type LostReason } from '@/modules/crm/constants';
import { weightedValue } from '@/modules/crm/metrics';
import {
  deleteContactAction,
  deleteCrmFileAction,
  deleteDealAction,
  moveDealAction,
  saveContactAction,
  saveDealAction,
} from '@/modules/crm/server/actions';
import {
  convertDealToClientAction,
  finalizeDealFileAction,
  getDealFileUrlAction,
  requestDealFileUploadAction,
} from '@/modules/crm/server/deal-actions';
import type { CrmOptions, DealDetail, PipelineWithStages } from '@/modules/crm/server/queries';

type Contact = DealDetail['contacts'][number];

function StageBar({ deal, pipeline, canWrite }: { deal: DealDetail; pipeline: PipelineWithStages; canWrite: boolean }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const move = useAction(moveDealAction, { successMessage: t('crm.pipeline.moved') });
  const [lostOpen, setLostOpen] = useState(false);
  const [reason, setReason] = useState<LostReason>('price');
  const [note, setNote] = useState('');
  const current = pipeline.stages.find((s) => s.id === deal.stageId);
  const locked = Boolean(deal.convertedAt);
  return (
    <>
      <ol className="flex flex-wrap gap-1" aria-label={t('crm.deal.stage')} data-testid="deal-stage-bar">
        {pipeline.stages.map((s) => {
          const isCurrent = s.id === deal.stageId;
          const passed = current && s.kind === 'open' && current.kind !== 'lost' && s.sortOrder < current.sortOrder;
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={!canWrite || isCurrent || locked || move.pending}
                onClick={() => (s.kind === 'lost' ? setLostOpen(true) : move.run({ dealId: deal.id, stageId: s.id }))}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default',
                  isCurrent
                    ? s.kind === 'won'
                      ? 'border-success bg-success text-white'
                      : s.kind === 'lost'
                        ? 'border-danger bg-danger text-white'
                        : 'border-primary bg-primary text-primary-foreground'
                    : passed
                      ? 'border-primary/40 bg-primary-soft text-primary-soft-foreground'
                      : 'border-border text-muted-foreground enabled:hover:text-foreground',
                )}
                data-testid="stage-step"
                data-kind={s.kind}
                data-current={isCurrent}
              >
                {localized(s.name, locale)}
              </button>
            </li>
          );
        })}
      </ol>
      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent closeLabel={t('common.close')}>
          <form
            className="flex min-h-0 flex-col"
            onSubmit={async (e) => {
              e.preventDefault();
              const lost = pipeline.stages.find((s) => s.kind === 'lost');
              if (!lost) return;
              const res = await move.run({ dealId: deal.id, stageId: lost.id, lostReason: reason, lostNote: note || null });
              if (res.ok) setLostOpen(false);
            }}
            data-testid="lost-form"
          >
            <DialogHeader>
              <DialogTitle>{t('crm.pipeline.lostTitle')}</DialogTitle>
              <DialogDescription>{t('crm.pipeline.lostBody')}</DialogDescription>
            </DialogHeader>
            <DialogBody className="grid gap-4">
              <Field label={t('crm.pipeline.lostReason')}>
                {(p) => (
                  <NativeSelect {...p} value={reason} onChange={(e) => setReason(e.target.value as LostReason)} data-testid="lost-reason">
                    {lostReasons.map((r) => (
                      <option key={r} value={r}>
                        {t(`crm.lostReasons.${r}`)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('crm.pipeline.lostNote')} optional>
                {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLostOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="destructive" loading={move.pending} data-testid="lost-confirm">
                {t('crm.pipeline.markLost')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditDealDialog({
  deal,
  options,
  open,
  onOpenChange,
  canManageAll,
}: {
  deal: DealDetail;
  options: CrmOptions;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canManageAll: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [title, setTitle] = useState(deal.title);
  const [company, setCompany] = useState(deal.company ?? '');
  const [value, setValue] = useState(String(deal.valueMinor / 100));
  const [probability, setProbability] = useState(String(deal.probability));
  const [close, setClose] = useState(deal.expectedCloseDate ?? '');
  const [packageId, setPackageId] = useState(deal.packageId ?? '');
  const [ownerId, setOwnerId] = useState(deal.owner?.id ?? '');
  const save = useAction(saveDealAction, { successMessage: t('common.saved') });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <form
          className="flex min-h-0 flex-col"
          data-testid="deal-edit-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await save.run({
              dealId: deal.id,
              title,
              company: company || null,
              pipelineId: deal.pipelineId,
              valueSar: Number(value || 0),
              probability: Number(probability),
              expectedCloseDate: close || null,
              ownerId: ownerId || null,
              packageId: packageId || null,
            });
            if (res.ok) onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('crm.pipeline.editDeal')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label={t('crm.leads.dealTitle')} required>
              {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('crm.pipeline.company')} optional>
                {(p) => <Input {...p} value={company} onChange={(e) => setCompany(e.target.value)} maxLength={120} />}
              </Field>
              <Field label={t('crm.pipeline.value')}>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    dir="ltr"
                    min={0}
                    step="100"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    data-testid="deal-edit-value"
                  />
                )}
              </Field>
              <Field label={t('crm.pipeline.probability')} hint={t('crm.pipeline.probabilityHint')}>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    dir="ltr"
                    min={0}
                    max={100}
                    value={probability}
                    onChange={(e) => setProbability(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('crm.pipeline.expectedClose')} optional>
                {(p) => <Input {...p} type="date" dir="ltr" value={close} onChange={(e) => setClose(e.target.value)} />}
              </Field>
              <Field label={t('crm.pipeline.package')} optional>
                {(p) => (
                  <NativeSelect {...p} value={packageId} onChange={(e) => setPackageId(e.target.value)} data-testid="deal-edit-package">
                    <option value="">{t('crm.pipeline.noPackage')}</option>
                    {options.packages.map((x) => (
                      <option key={x.id} value={x.id}>
                        {localized(x.name, locale)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('crm.deal.owner')}>
                {(p) => (
                  <NativeSelect {...p} value={ownerId} onChange={(e) => setOwnerId(e.target.value)} disabled={!canManageAll}>
                    <option value="">{t('crm.leads.unassigned')}</option>
                    {options.owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={save.pending} data-testid="deal-edit-save">
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContactDialog({
  dealId,
  contact,
  open,
  onOpenChange,
}: {
  dealId: string;
  contact: Contact | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations();
  const [fullName, setFullName] = useState(contact?.fullName ?? '');
  const [jobTitle, setJobTitle] = useState(contact?.jobTitle ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [isPrimary, setIsPrimary] = useState(contact?.isPrimary ?? false);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const save = useAction(saveContactAction, { successMessage: t('common.saved') });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <form
          className="flex min-h-0 flex-col"
          noValidate
          data-testid="contact-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await save.run({
              contactId: contact?.id,
              dealId,
              fullName,
              jobTitle: jobTitle || null,
              phone: phone || null,
              email: email || null,
              isPrimary,
            });
            if (!res.ok) return setErrors(res.error.fieldErrors);
            onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{contact ? t('crm.deal.editContact') : t('crm.deal.addContact')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <Field label={t('crm.leads.name')} error={errors?.fullName?.[0]} required>
              {(p) => (
                <Input {...p} value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} data-testid="contact-name" />
              )}
            </Field>
            <Field label={t('crm.deal.jobTitle')} optional>
              {(p) => <Input {...p} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={120} />}
            </Field>
            <Field label={t('crm.leads.phone')} error={errors?.phone?.[0]} optional>
              {(p) => <Input {...p} type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />}
            </Field>
            <Field label={t('crm.leads.email')} error={errors?.email?.[0]} optional>
              {(p) => (
                <Input {...p} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="contact-email" />
              )}
            </Field>
            <label className="flex items-start justify-between gap-3 rounded-lg border border-border p-3 sm:col-span-2">
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{t('crm.deal.primary')}</span>
                <span className="text-xs text-subtle-foreground">{t('crm.deal.primaryHint')}</span>
              </span>
              <Switch checked={isPrimary} onCheckedChange={setIsPrimary} />
            </label>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={save.pending} data-testid="contact-save">
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({
  deal,
  options,
  open,
  onOpenChange,
}: {
  deal: DealDetail;
  options: CrmOptions;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const invitable = deal.contacts.filter((c) => c.email);
  const [nameAr, setNameAr] = useState(locale === 'ar' ? (deal.company ?? deal.title) : '');
  const [nameEn, setNameEn] = useState(locale === 'en' ? (deal.company ?? deal.title) : '');
  const [city, setCity] = useState(deal.lead?.city ?? '');
  const [am, setAm] = useState(options.agencyPeople[0]?.id ?? '');
  const [team, setTeam] = useState<string[]>([]);
  const [packageId, setPackageId] = useState(deal.packageId ?? '');
  const [invite, setInvite] = useState(invitable.find((c) => c.isPrimary)?.id ?? invitable[0]?.id ?? '');
  const [inviteLocale, setInviteLocale] = useState<'ar' | 'en'>(locale);
  const [onboarding, setOnboarding] = useState(options.onboardingReady);
  const convert = useAction(convertDealToClientAction, { successMessage: t('crm.convert.done') });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} size="lg">
        <form
          className="flex min-h-0 flex-col"
          data-testid="convert-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await convert.run({
              dealId: deal.id,
              clientName: { ar: nameAr, en: nameEn },
              city: (city || null) as (typeof cities)[number] | null,
              accountManagerId: am,
              teamIds: team,
              packageId: packageId || null,
              inviteContactId: invite || null,
              inviteLocale,
              onboarding,
            });
            if (res.ok) router.push(`/clients/${res.data.clientId}`);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('crm.convert.title')}</DialogTitle>
            <DialogDescription>{t('crm.convert.body')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`${t('crm.convert.clientName')} · ${t('common.arabic')}`}>
                {(p) => (
                  <Input
                    {...p}
                    dir="rtl"
                    lang="ar"
                    value={nameAr}
                    onChange={(e) => setNameAr(e.target.value)}
                    maxLength={120}
                    data-testid="convert-name-ar"
                  />
                )}
              </Field>
              <Field label={`${t('crm.convert.clientName')} · ${t('common.english')}`}>
                {(p) => (
                  <Input
                    {...p}
                    dir="ltr"
                    lang="en"
                    value={nameEn}
                    onChange={(e) => setNameEn(e.target.value)}
                    maxLength={120}
                    data-testid="convert-name-en"
                  />
                )}
              </Field>
              <Field label={t('crm.leads.city')} optional>
                {(p) => (
                  <NativeSelect {...p} value={city} onChange={(e) => setCity(e.target.value)}>
                    <option value="">—</option>
                    {cities.map((c) => (
                      <option key={c} value={c}>
                        {t(`clients.cities.${c}`)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('crm.convert.accountManager')} required>
                {(p) => (
                  <NativeSelect {...p} value={am} onChange={(e) => setAm(e.target.value)} data-testid="convert-am">
                    {options.agencyPeople.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label={t('crm.convert.package')} optional>
                {(p) => (
                  <NativeSelect {...p} value={packageId} onChange={(e) => setPackageId(e.target.value)} data-testid="convert-package">
                    <option value="">{t('crm.pipeline.noPackage')}</option>
                    {options.packages.map((x) => (
                      <option key={x.id} value={x.id}>
                        {localized(x.name, locale)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field
                label={t('crm.convert.invite')}
                hint={invitable.length < deal.contacts.length ? t('crm.convert.inviteNeedsEmail') : undefined}
              >
                {(p) => (
                  <NativeSelect {...p} value={invite} onChange={(e) => setInvite(e.target.value)} data-testid="convert-invite">
                    <option value="">{t('crm.convert.inviteNone')}</option>
                    {invitable.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName} · {c.email}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              {invite ? (
                <Field label={t('crm.convert.inviteLocale')}>
                  {(p) => (
                    <NativeSelect {...p} value={inviteLocale} onChange={(e) => setInviteLocale(e.target.value as 'ar' | 'en')}>
                      <option value="ar">{t('common.arabic')}</option>
                      <option value="en">{t('common.english')}</option>
                    </NativeSelect>
                  )}
                </Field>
              ) : null}
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t('crm.convert.team')}</legend>
              <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
                {options.agencyPeople
                  .filter((p) => p.id !== am)
                  .map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={team.includes(p.id)}
                        onCheckedChange={(v) => setTeam((x) => (v === true ? [...x, p.id] : x.filter((i) => i !== p.id)))}
                      />
                      {p.name}
                    </label>
                  ))}
              </div>
            </fieldset>
            <label className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{t('crm.convert.onboarding')}</span>
                <span className="text-xs text-subtle-foreground">
                  {options.onboardingReady ? t('crm.convert.onboardingHint') : t('crm.convert.onboardingMissing')}
                </span>
              </span>
              <Switch
                checked={onboarding}
                onCheckedChange={setOnboarding}
                disabled={!options.onboardingReady}
                data-testid="convert-onboarding"
              />
            </label>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={convert.pending} disabled={!am || (!nameAr.trim() && !nameEn.trim())} data-testid="convert-run">
              {t('crm.convert.run')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FilesCard({ deal, canWrite }: { deal: DealDetail; canWrite: boolean }) {
  const t = useTranslations();
  const f = useFormat();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const request = useAction(requestDealFileUploadAction, { refresh: false });
  const finalize = useAction(finalizeDealFileAction);
  const download = useAction(getDealFileUrlAction, { refresh: false });
  const remove = useAction(deleteCrmFileAction);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const meta = { dealId: deal.id, name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size };
      const res = await request.run(meta);
      if (!res.ok) return;
      const { error } = await getSupabaseBrowserClient()
        .storage.from(CRM_FILES_BUCKET)
        .uploadToSignedUrl(res.data.path, res.data.token, file, { contentType: meta.mimeType });
      if (error) return void toast.error(t('errors.upload_failed'));
      await finalize.run({ ...meta, fileId: res.data.fileId });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-medium">{t('crm.deal.files')}</p>
        {canWrite ? (
          <>
            <Button size="sm" variant="outline" loading={busy} onClick={() => input.current?.click()} data-testid="deal-file-upload">
              <Upload />
              {t('crm.deal.upload')}
            </Button>
            <input
              ref={input}
              type="file"
              className="sr-only"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              data-testid="deal-file-input"
            />
          </>
        ) : null}
      </div>
      {deal.files.length === 0 ? (
        <p className="text-sm text-subtle-foreground">{t('crm.deal.noFiles')}</p>
      ) : (
        <ul className="grid gap-1" data-testid="deal-files">
          {deal.files.map((file) => (
            <li key={file.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-surface-muted">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">
                <bdi>{file.name}</bdi>
              </span>
              <span className="text-xs text-subtle-foreground">{f.bytes(file.sizeBytes)}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('crm.deal.download')}
                onClick={async () => {
                  const res = await download.run({ id: file.id });
                  if (res.ok) window.location.assign(res.data.url);
                }}
              >
                <Download />
              </Button>
              {canWrite ? (
                <Button variant="ghost" size="icon-sm" aria-label={t('crm.deal.deleteFile')} onClick={() => remove.run({ id: file.id })}>
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function DealDetailView({
  deal,
  pipeline,
  options,
  canManageAll,
  canConvert,
}: {
  deal: DealDetail;
  pipeline: PipelineWithStages;
  options: CrmOptions;
  canManageAll: boolean;
  canConvert: boolean;
}) {
  const t = useTranslations();
  const f = useFormat();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [contact, setContact] = useState<Contact | null | 'new'>(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const removeContact = useAction(deleteContactAction);
  const remove = useAction(deleteDealAction);
  const canWrite = deal.canWrite;
  const stage = pipeline.stages.find((s) => s.id === deal.stageId);
  const pkg = options.packages.find((p) => p.id === deal.packageId);
  const stageName = (id: string | null) => (id ? localized(pipeline.stages.find((s) => s.id === id)?.name ?? {}, locale) : '');
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-6" data-testid="deal-detail">
      <div className="flex flex-wrap items-center gap-3">
        <StageBar deal={deal} pipeline={pipeline} canWrite={canWrite} />
        <div className="flex-1" />
        {canWrite ? (
          <Button variant="outline" onClick={() => setEditing(true)} data-testid="deal-edit">
            <Pencil />
            {t('common.edit')}
          </Button>
        ) : null}
        {deal.status === 'won' && !deal.convertedAt && canConvert ? (
          <Button onClick={() => setConverting(true)} data-testid="deal-convert">
            <Building2 />
            {t('crm.deal.convert')}
          </Button>
        ) : null}
        {canManageAll && !deal.convertedAt ? (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon" aria-label={t('crm.deal.deleteDeal')}>
                <Trash2 />
              </Button>
            }
            title={t('crm.deal.deleteDeal')}
            description={t('crm.deal.deleteConfirm', { title: deal.title })}
            confirmLabel={t('common.delete')}
            cancelLabel={t('common.cancel')}
            destructive
            onConfirm={async () => {
              const res = await remove.run({ id: deal.id });
              if (res.ok) router.push('/crm/pipeline');
            }}
          />
        ) : null}
      </div>

      {deal.convertedAt && deal.clientId ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-success/40 p-4" data-testid="deal-converted">
          <span className="text-sm">{t('crm.deal.convertedTo', { client: localized(deal.clientName ?? {}, locale) })}</span>
          <Button asChild size="sm" variant="outline">
            <Link href={`/clients/${deal.clientId}`}>{t('crm.deal.openClient')}</Link>
          </Button>
        </Card>
      ) : deal.status === 'won' && canConvert ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-success/40 p-4">
          <span className="text-sm text-muted-foreground">{t('crm.deal.convertHint')}</span>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <ActivityPanel items={deal.activities} dealId={deal.id} leadId={deal.leadId} canWrite={canWrite} />

          <section>
            <SectionTitle
              title={t('crm.deal.quotes')}
              action={
                canWrite ? (
                  <Button size="sm" variant="outline" onClick={() => setQuoteOpen(true)} data-testid="quote-new">
                    <Plus />
                    {t('crm.deal.newQuote')}
                  </Button>
                ) : null
              }
            />
            <Card className="divide-y divide-border" data-testid="deal-quotes">
              {deal.quotes.length === 0 ? (
                <p className="px-4 py-3 text-sm text-subtle-foreground">{t('crm.deal.noQuotes')}</p>
              ) : (
                deal.quotes.map((q) => (
                  <Link key={q.id} href={`/crm/quotes/${q.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        <bdi>{q.title}</bdi>
                      </p>
                      <p className="text-xs text-subtle-foreground">
                        <span dir="ltr">{quoteReference(q.number)}</span> · {f.date(q.createdAt)}
                      </p>
                    </div>
                    <span className="tabular text-sm">{f.currency(q.totalMinor)}</span>
                    <QuoteStatusBadge status={q.status} />
                  </Link>
                ))
              )}
            </Card>
          </section>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card className="p-4" data-testid="deal-summary">
            <p className="mb-2 flex items-center justify-between gap-2 font-medium">
              {t('crm.deal.summary')}
              <DealStatusBadge status={deal.status} />
            </p>
            <dl>
              {row(t('crm.pipeline.value'), <span className="tabular font-semibold">{f.currency(deal.valueMinor)}</span>)}
              {row(t('crm.deal.weighted'), <span className="tabular">{f.currency(weightedValue(deal))}</span>)}
              {row(t('crm.pipeline.probability'), <span className="tabular">{deal.probability}%</span>)}
              {row(t('crm.deal.stage'), stage ? localized(stage.name, locale) : '—')}
              {row(t('crm.pipeline.expectedClose'), deal.expectedCloseDate ? f.date(`${deal.expectedCloseDate}T12:00:00`, 'long') : '—')}
              {row(t('crm.deal.owner'), deal.owner?.name ?? t('crm.leads.unassigned'))}
              {row(t('crm.pipeline.package'), pkg ? localized(pkg.name, locale) : t('crm.pipeline.noPackage'))}
              {deal.lead
                ? row(
                    t('crm.deal.lead'),
                    <Link href={`/crm/leads/${deal.lead.id}`} className="text-primary hover:underline">
                      <bdi>{deal.lead.fullName}</bdi> <span dir="ltr">({leadReference(deal.lead.number)})</span>
                    </Link>,
                  )
                : null}
              {deal.source ? row(t('crm.leads.source'), t(`crm.sources.${deal.source as 'manual'}`)) : null}
              {row(t('crm.deal.created'), f.date(deal.createdAt))}
              {deal.wonAt ? row(t('crm.dealStatuses.won'), f.date(deal.wonAt)) : null}
              {deal.lostAt
                ? row(
                    t('crm.dealStatuses.lost'),
                    <span>
                      {f.date(deal.lostAt)} · {deal.lostReason ? t(`crm.lostReasons.${deal.lostReason}`) : ''}
                      {deal.lostNote ? <span className="block text-xs text-muted-foreground">{deal.lostNote}</span> : null}
                    </span>,
                  )
                : null}
            </dl>
          </Card>

          <Card className="p-4" data-testid="deal-contacts">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-medium">{t('crm.deal.contacts')}</p>
              {canWrite ? (
                <Button size="sm" variant="ghost" onClick={() => setContact('new')} data-testid="contact-add">
                  <Plus />
                  {t('crm.deal.addContact')}
                </Button>
              ) : null}
            </div>
            {deal.contacts.length === 0 ? (
              <p className="text-sm text-subtle-foreground">{t('crm.deal.noContacts')}</p>
            ) : (
              <ul className="grid gap-2">
                {deal.contacts.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 rounded-lg border border-border p-2" data-testid="deal-contact">
                    <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="flex items-center gap-1.5 font-medium">
                        <bdi>{c.fullName}</bdi>
                        {c.isPrimary ? (
                          <Badge tone="brand">
                            <Star aria-hidden />
                            {t('crm.deal.primary')}
                          </Badge>
                        ) : null}
                      </p>
                      {c.jobTitle ? <p className="text-xs text-muted-foreground">{c.jobTitle}</p> : null}
                      <p className="text-xs text-subtle-foreground" dir="ltr">
                        {[c.phone, c.email].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {canWrite ? (
                      <div className="flex shrink-0">
                        <Button variant="ghost" size="icon-sm" aria-label={t('crm.deal.editContact')} onClick={() => setContact(c)}>
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('crm.deal.removeContact')}
                          onClick={() => removeContact.run({ id: c.id })}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <FilesCard deal={deal} canWrite={canWrite} />

          <Card className="p-4">
            <p className="mb-2 font-medium">{t('crm.deal.history')}</p>
            <ol className="grid gap-2 text-sm" data-testid="deal-history">
              {deal.history.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-2">
                  <span>
                    {h.fromStageId
                      ? t('crm.deal.movedTo', { stage: stageName(h.toStageId) })
                      : t('crm.deal.createdIn', { stage: stageName(h.toStageId) })}
                  </span>
                  <span className="shrink-0 text-xs text-subtle-foreground">
                    {h.actorName ? `${h.actorName} · ` : ''}
                    {f.relative(h.createdAt)}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>

      {editing ? (
        <EditDealDialog deal={deal} options={options} open={editing} onOpenChange={setEditing} canManageAll={canManageAll} />
      ) : null}
      {contact ? (
        <ContactDialog
          key={contact === 'new' ? 'new' : contact.id}
          dealId={deal.id}
          contact={contact === 'new' ? null : contact}
          open
          onOpenChange={(o) => !o && setContact(null)}
        />
      ) : null}
      {converting ? <ConvertDialog deal={deal} options={options} open={converting} onOpenChange={setConverting} /> : null}
      {quoteOpen ? (
        <QuoteEditor dealId={deal.id} deal={deal} options={options} quote={null} open={quoteOpen} onOpenChange={setQuoteOpen} />
      ) : null}
    </div>
  );
}
