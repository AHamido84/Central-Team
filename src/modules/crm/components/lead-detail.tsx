'use client';

import { Copy, Handshake, Mail, MessageCircle, Pencil, Phone, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { SectionTitle } from '@/components/patterns';
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
import { Badge, Card, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { ActivityPanel } from '@/modules/crm/components/activity-panel';
import { DealStatusBadge, LeadStatusBadge, ScoreMeter } from '@/modules/crm/components/badges';
import { LeadDialog } from '@/modules/crm/components/lead-dialog';
import { dealReference, leadReference, leadStatuses, type CrmService, type LeadStatus } from '@/modules/crm/constants';
import { convertLeadAction, mergeLeadsAction, setLeadStatusAction } from '@/modules/crm/server/actions';
import { DeleteDialog } from '@/modules/data/components/delete-dialog';
import type { CrmOptions, LeadDetail } from '@/modules/crm/server/queries';

function ConvertDialog({
  lead,
  options,
  open,
  onOpenChange,
}: {
  lead: LeadDetail;
  options: CrmOptions;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const defaultPipeline = options.pipelines.find((p) => p.isDefault) ?? options.pipelines[0];
  const [title, setTitle] = useState(lead.company || lead.fullName);
  const [pipelineId, setPipelineId] = useState(defaultPipeline?.id ?? '');
  const [value, setValue] = useState('');
  const [close, setClose] = useState('');
  const [packageId, setPackageId] = useState('');
  const convert = useAction(convertLeadAction, { successMessage: t('common.saved') });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await convert.run({
              leadId: lead.id,
              title,
              pipelineId,
              valueSar: Number(value || 0),
              expectedCloseDate: close || null,
              packageId: packageId || null,
            });
            if (res.ok) router.push(`/crm/deals/${res.data.dealId}`);
          }}
          data-testid="lead-convert-form"
        >
          <DialogHeader>
            <DialogTitle>{t('crm.leads.convertTitle')}</DialogTitle>
            <DialogDescription>{t('crm.leads.convertBody')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label={t('crm.leads.dealTitle')} required>
              {(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} data-testid="deal-title" />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('crm.pipeline.pipeline')}>
                {(p) => (
                  <NativeSelect {...p} value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
                    {options.pipelines.map((x) => (
                      <option key={x.id} value={x.id}>
                        {localized(x.name, locale)}
                      </option>
                    ))}
                  </NativeSelect>
                )}
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
                    data-testid="deal-value"
                  />
                )}
              </Field>
              <Field label={t('crm.pipeline.expectedClose')} optional>
                {(p) => <Input {...p} type="date" dir="ltr" value={close} onChange={(e) => setClose(e.target.value)} />}
              </Field>
              <Field label={t('crm.pipeline.package')} optional>
                {(p) => (
                  <NativeSelect {...p} value={packageId} onChange={(e) => setPackageId(e.target.value)} data-testid="deal-package">
                    <option value="">{t('crm.pipeline.noPackage')}</option>
                    {options.packages.map((x) => (
                      <option key={x.id} value={x.id}>
                        {localized(x.name, locale)}
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
            <Button type="submit" loading={convert.pending} disabled={!title.trim() || !pipelineId} data-testid="lead-convert-save">
              {t('crm.leads.convert')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LeadDetailView({
  lead,
  options,
  me,
  canManageAll,
  canDelete = false,
  canCreateDeal,
}: {
  lead: LeadDetail;
  options: CrmOptions;
  me: string;
  canManageAll: boolean;
  /** `leads:delete` (FR5): moves the lead to the Trash. */
  canDelete?: boolean;
  canCreateDeal: boolean;
}) {
  const t = useTranslations();
  const f = useFormat();
  const router = useRouter();
  const locale = useLocale() as Locale;
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const setStatus = useAction(setLeadStatusAction, { successMessage: t('common.saved') });
  const merge = useAction(mergeLeadsAction, { successMessage: t('crm.leads.merged') });
  const [deleting, setDeleting] = useState(false);
  const waNumber = lead.phone?.replace(/^\+/, '');
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{value}</dd>
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" data-testid="lead-detail">
      {deleting ? (
        <DeleteDialog type="lead" id={lead.id} open onOpenChange={setDeleting} onDeleted={() => router.push('/crm/leads')} />
      ) : null}
      <div className="min-w-0 space-y-6">
        {lead.status === 'merged' && lead.mergedIntoId ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 border-warning/40 p-4 text-sm">
            <span>{t('crm.leads.mergedInto')}</span>
            <Button asChild size="sm" variant="outline">
              <Link href={`/crm/leads/${lead.mergedIntoId}`}>{t('crm.leads.openMerged')}</Link>
            </Button>
          </Card>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {lead.canWrite && lead.status !== 'merged' ? (
            <>
              <NativeSelect
                aria-label={t('crm.leads.status')}
                value={lead.status}
                disabled={lead.status === 'converted'}
                onChange={(e) => setStatus.run({ leadId: lead.id, status: e.target.value as Exclude<LeadStatus, 'merged' | 'converted'> })}
                className="h-9 w-40"
                data-testid="lead-status-select"
              >
                {leadStatuses
                  .filter((s) => s !== 'merged' && (s !== 'converted' || lead.status === 'converted'))
                  .map((s) => (
                    <option key={s} value={s}>
                      {t(`crm.statuses.${s}`)}
                    </option>
                  ))}
              </NativeSelect>
              <Button variant="outline" onClick={() => setEditing(true)} data-testid="lead-edit">
                <Pencil />
                {t('common.edit')}
              </Button>
            </>
          ) : (
            <LeadStatusBadge status={lead.status} />
          )}
          {canCreateDeal && lead.status !== 'merged' ? (
            <Button onClick={() => setConverting(true)} data-testid="lead-convert">
              <Handshake />
              {t('crm.leads.convert')}
            </Button>
          ) : null}
          {canDelete ? (
            <Button variant="ghost" className="text-danger" onClick={() => setDeleting(true)} data-testid="lead-delete">
              <Trash2 />
              {t('common.delete')}
            </Button>
          ) : null}
        </div>

        <ActivityPanel items={lead.activities} leadId={lead.id} canWrite={lead.canWrite && lead.status !== 'merged'} />

        <section>
          <SectionTitle title={t('crm.leads.dealsList')} />
          <Card className="divide-y divide-border">
            {lead.dealList.length === 0 ? (
              <p className="px-4 py-3 text-sm text-subtle-foreground">{t('crm.leads.noDeals')}</p>
            ) : (
              lead.dealList.map((d) => (
                <Link key={d.id} href={`/crm/deals/${d.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      <bdi>{d.title}</bdi>
                    </p>
                    <p className="text-xs text-subtle-foreground">
                      <span dir="ltr">{dealReference(d.number)}</span> · {localized(d.stageName, locale)}
                    </p>
                  </div>
                  <span className="tabular text-sm">{f.currency(d.valueMinor)}</span>
                  <DealStatusBadge status={d.status} />
                </Link>
              ))
            )}
          </Card>
        </section>
      </div>

      <aside className="min-w-0 space-y-6">
        <Card className="p-4">
          <p className="mb-2 font-medium">{t('crm.leads.contact')}</p>
          <dl>
            {lead.phone
              ? row(
                  t('crm.leads.phone'),
                  <span className="flex flex-wrap items-center gap-2">
                    <span dir="ltr">{lead.phone}</span>
                    <a href={`tel:${lead.phone}`} className="text-primary" aria-label={t('crm.leads.callLink')}>
                      <Phone className="size-4" />
                    </a>
                    <a
                      href={`https://wa.me/${waNumber}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary"
                      aria-label={t('crm.leads.whatsappLink')}
                    >
                      <MessageCircle className="size-4" />
                    </a>
                  </span>,
                )
              : null}
            {lead.email
              ? row(
                  t('crm.leads.email'),
                  <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 truncate text-primary" dir="ltr">
                    <Mail className="size-4 shrink-0" />
                    {lead.email}
                  </a>,
                )
              : null}
            {lead.company ? row(t('crm.leads.company'), <bdi>{lead.company}</bdi>) : null}
            {lead.city ? row(t('crm.leads.city'), t(`clients.cities.${lead.city as 'riyadh'}`)) : null}
          </dl>
        </Card>
        <Card className="p-4">
          <p className="mb-2 font-medium">{t('crm.leads.details')}</p>
          <dl>
            {row(t('crm.leads.owner'), lead.owner?.name ?? t('crm.leads.unassigned'))}
            {row(t('crm.leads.score'), <ScoreMeter score={lead.score} />)}
            {row(t('crm.leads.source'), `${t(`crm.sources.${lead.source}`)}${lead.sourceDetail ? ` · ${lead.sourceDetail}` : ''}`)}
            {lead.formName ? row(t('crm.leads.form'), <bdi>{lead.formName}</bdi>) : null}
            {lead.externalRef
              ? row(
                  t('crm.leads.externalRef'),
                  <span dir="ltr" className="text-xs">
                    {lead.externalRef}
                  </span>,
                )
              : null}
            {row(t('crm.leads.budget'), t(`crm.budgets.${lead.budgetRange}`))}
            {row(
              t('crm.leads.services'),
              lead.services.length ? lead.services.map((s) => t(`crm.services.${s as CrmService}`)).join(' · ') : '—',
            )}
            {lead.tags.length
              ? row(
                  t('crm.leads.tags'),
                  <span className="flex flex-wrap gap-1">
                    {lead.tags.map((x) => (
                      <Badge key={x} tone="neutral">
                        <bdi>{x}</bdi>
                      </Badge>
                    ))}
                  </span>,
                )
              : null}
            {row(t('crm.leads.created'), f.dateTime(lead.createdAt))}
          </dl>
          {lead.notes ? (
            <p className="mt-3 border-t border-border pt-3 text-sm whitespace-pre-line text-muted-foreground">{lead.notes}</p>
          ) : null}
        </Card>
        <Card className="p-4" data-testid="lead-duplicates">
          <p className="font-medium">{t('crm.leads.duplicates')}</p>
          {lead.duplicateLeads.length === 0 ? (
            <p className="mt-1 text-sm text-subtle-foreground">{t('crm.leads.noDuplicates')}</p>
          ) : (
            <>
              <p className="mt-1 mb-3 text-xs text-subtle-foreground">{t('crm.leads.duplicatesBody')}</p>
              <ul className="grid gap-2">
                {lead.duplicateLeads.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 rounded-lg border border-border p-2" data-testid="lead-duplicate">
                    <Copy className="size-4 shrink-0 text-warning" aria-hidden />
                    <Link href={`/crm/leads/${d.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                      <bdi>{d.fullName}</bdi> <span className="text-xs text-subtle-foreground">{leadReference(d.number)}</span>
                    </Link>
                    {canManageAll && lead.status !== 'merged' ? (
                      <ConfirmDialog
                        trigger={
                          <Button size="sm" variant="outline" data-testid="lead-merge">
                            {t('crm.leads.merge')}
                          </Button>
                        }
                        title={t('crm.leads.mergeTitle')}
                        description={t('crm.leads.mergeBody', { other: d.fullName, primary: lead.fullName })}
                        confirmLabel={t('crm.leads.merge')}
                        cancelLabel={t('common.cancel')}
                        onConfirm={() => merge.run({ primaryId: lead.id, otherId: d.id })}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </aside>

      <LeadDialog
        lead={{ ...lead, id: lead.id, ownerId: lead.owner?.id ?? null }}
        open={editing}
        onOpenChange={setEditing}
        owners={options.owners}
        me={me}
        canManageAll={canManageAll}
      />
      {canCreateDeal ? <ConvertDialog lead={lead} options={options} open={converting} onOpenChange={setConverting} /> : null}
    </div>
  );
}
