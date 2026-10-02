'use client';

import { ChevronDown, FilePlus2, ImageIcon, Link2, Pencil, Trash2, Unlink, Upload } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { useFormat } from '@/components/providers';
import { EmptyState, PageHeader } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { Badge, Card, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type LocalizedText } from '@/lib/i18n/localized';
import { CampaignStatusBadge, HealthBadge, PlatformList } from '@/modules/campaigns/components/badges';
import { CampaignFormDialog } from '@/modules/campaigns/components/campaign-form';
import { CampaignFlight } from '@/modules/campaigns/components/campaign-list';
import { CampaignOverview } from '@/modules/campaigns/components/campaign-overview';
import { MetricsGrid } from '@/modules/campaigns/components/metrics-grid';
import { MetricsImportDialog } from '@/modules/campaigns/components/metrics-import';
import { ReportCreateDialog } from '@/modules/campaigns/components/report-create-dialog';
import { ReportList } from '@/modules/campaigns/components/report-list';
import { campaignStatuses } from '@/modules/campaigns/constants';
import { deleteCampaignAction, linkDeliverableAction, setCampaignStatusAction } from '@/modules/campaigns/server/actions';
import type { CampaignDetail, CampaignOption } from '@/modules/campaigns/server/queries';
import type { DeliverableSummary } from '@/modules/deliverables/server/queries';

const tabs = ['overview', 'metrics', 'creatives', 'reports', 'insights'] as const;
type Tab = (typeof tabs)[number];

export function CreativeGrid({
  items,
  hrefBase,
  onUnlink,
}: {
  items: DeliverableSummary[];
  hrefBase: string;
  onUnlink?: (id: string) => void;
}) {
  const t = useTranslations('campaigns');
  const f = useFormat();
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="creative-grid">
      {items.map((d) => (
        <li key={d.id} className="group relative overflow-hidden rounded-lg border border-border bg-surface" data-testid="creative">
          <Link href={`${hrefBase}/${d.id}`} className="block focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <div className="flex aspect-[4/3] items-center justify-center bg-surface-muted">
              {d.thumbUrl ? (
                // Signed, short-lived URL.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.thumbUrl} alt={d.title} className="size-full object-cover" />
              ) : (
                <ImageIcon className="size-8 text-subtle-foreground" aria-hidden />
              )}
            </div>
            <div className="p-2">
              <p className="truncate text-sm font-medium">{d.title}</p>
              {d.approvedAt ? <p className="text-xs text-subtle-foreground">{f.date(d.approvedAt)}</p> : null}
            </div>
          </Link>
          {onUnlink ? (
            <Button
              variant="secondary"
              size="icon-sm"
              className="absolute end-2 top-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
              aria-label={t('creatives.unlink')}
              onClick={() => onUnlink(d.id)}
            >
              <Unlink aria-hidden />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function LinkCreativeDialog({ campaignId, linkable }: { campaignId: string; linkable: DeliverableSummary[] }) {
  const t = useTranslations('campaigns');
  const tc = useTranslations('common');
  const tdl = useTranslations('deliverables');
  const [open, setOpen] = useState(false);
  const link = useAction(linkDeliverableAction, { successMessage: t('creatives.linked') });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="link-creative">
          <Link2 aria-hidden />
          {t('creatives.link')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('creatives.linkTitle')}</DialogTitle>
          <DialogDescription>{t('creatives.linkHint')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {linkable.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('creatives.none')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {linkable.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="text-xs text-subtle-foreground">{tdl(`statuses.${d.status}`)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="soft"
                    loading={link.pending}
                    onClick={() => link.run({ deliverableId: d.id, campaignId })}
                    data-testid="link-creative-item"
                  >
                    {t('creatives.link')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function CampaignWorkspace({
  campaign,
  initialTab,
  can,
  clients,
  people,
  campaignOptions,
  linkable,
  today,
  insights,
}: {
  campaign: CampaignDetail;
  initialTab: string | undefined;
  can: { manage: boolean; metrics: boolean; reports: boolean };
  clients: { id: string; name: LocalizedText }[];
  people: { id: string; name: string }[];
  campaignOptions: CampaignOption[];
  linkable: DeliverableSummary[];
  today: string;
  /** Phase 8: the campaign's AI insights, rendered by the page when the AI module is on. */
  insights?: { panel: ReactNode; count: number };
}) {
  const t = useTranslations('campaigns');
  const tc = useTranslations('common');
  const locale = useLocale() as 'ar' | 'en';
  const f = useFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const visibleTabs = tabs.filter((k) => k !== 'insights' || insights);
  const [tab, setTab] = useState<Tab>(visibleTabs.includes(initialTab as Tab) ? (initialTab as Tab) : 'overview');
  const status = useAction(setCampaignStatusAction, { successMessage: t('actions.statusChanged') });
  const remove = useAction(deleteCampaignAction, {
    successMessage: t('actions.deleted'),
    refresh: false,
    onSuccess: () => router.push('/campaigns'),
  });
  const unlink = useAction(linkDeliverableAction, { successMessage: t('creatives.unlinked') });
  const deletable = campaign.status === 'draft' || campaign.status === 'archived';

  const onTab = (value: string) => {
    setTab(value as Tab);
    const next = new URLSearchParams(params.toString());
    if (value === 'overview') next.delete('tab');
    else next.set('tab', value);
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  };

  return (
    <>
      <PageHeader
        title={campaign.name}
        eyebrow={
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Link href={`/clients/${campaign.clientId}`} className="hover:underline">
              {localized(campaign.clientName, locale)}
            </Link>
            <span aria-hidden>{'·'}</span>
            <span dir="ltr">{`C-${campaign.number}`}</span>
            <CampaignStatusBadge status={campaign.status} />
            <HealthBadge health={campaign.health} />
            {campaign.visibility === 'internal' ? <Badge tone="outline">{tc('internal')}</Badge> : null}
          </div>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t(`objective.${campaign.objective}`)}</span>
            <CampaignFlight start={campaign.startDate} end={campaign.endDate} />
            <span>{`${t('fields.budget')}: ${f.currency(campaign.budgetMinor, campaign.currency)}`}</span>
            {campaign.owner ? <span>{`${t('fields.owner')}: ${campaign.owner.name}`}</span> : null}
            <PlatformList platforms={campaign.platforms} />
          </span>
        }
        actions={
          <>
            {can.reports ? (
              <ReportCreateDialog
                trigger={
                  <Button variant="outline" data-testid="campaign-new-report">
                    <FilePlus2 aria-hidden />
                    {t('actions.newReport')}
                  </Button>
                }
                clients={clients}
                campaigns={campaignOptions}
                defaultClientId={campaign.clientId}
                defaultCampaignId={campaign.id}
                today={today}
              />
            ) : null}
            {can.manage ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" loading={status.pending} data-testid="campaign-status-menu">
                      {t('actions.changeStatus')}
                      <ChevronDown aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {campaignStatuses
                      .filter((s) => s !== campaign.status)
                      .map((s) => (
                        <DropdownMenuItem
                          key={s}
                          onSelect={() => status.run({ campaignId: campaign.id, status: s })}
                          data-testid={`status-${s}`}
                        >
                          {t(`status.${s}`)}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <CampaignFormDialog
                  trigger={
                    <Button data-testid="campaign-edit">
                      <Pencil aria-hidden />
                      {t('actions.edit')}
                    </Button>
                  }
                  campaign={campaign}
                  clients={clients}
                  people={people}
                  today={today}
                />
                {deletable ? (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={t('actions.delete')}>
                        <Trash2 aria-hidden />
                      </Button>
                    }
                    title={t('actions.deleteTitle')}
                    description={t('actions.deleteBody')}
                    confirmLabel={tc('delete')}
                    cancelLabel={tc('cancel')}
                    destructive
                    onConfirm={() => remove.run({ campaignId: campaign.id })}
                  />
                ) : null}
              </>
            ) : null}
          </>
        }
      />
      {campaign.description ? <p className="-mt-3 mb-5 max-w-3xl text-sm text-muted-foreground">{campaign.description}</p> : null}

      <Tabs value={tab} onValueChange={onTab}>
        <TabsList className="mb-4 max-w-full overflow-x-auto">
          {visibleTabs.map((k) => (
            <TabsTrigger key={k} value={k} data-testid={`tab-${k}`}>
              {t(`tabs.${k}`)}
              {k === 'insights' && insights?.count ? (
                <Badge tone="warning" className="ms-1.5">
                  {insights.count}
                </Badge>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <CampaignOverview
            analysis={campaign.analysis}
            channels={campaign.channels}
            rows={campaign.rows}
            startDate={campaign.startDate}
            endDate={campaign.endDate}
            currency={campaign.currency}
          />
        </TabsContent>
        <TabsContent value="metrics" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{t('metrics.description')}</p>
            {can.metrics && campaign.channels.length ? (
              <MetricsImportDialog
                trigger={
                  <Button variant="outline" data-testid="open-import">
                    <Upload aria-hidden />
                    {t('metrics.import')}
                  </Button>
                }
                campaignId={campaign.id}
                channels={campaign.channels}
                currency={campaign.currency}
              />
            ) : null}
          </div>
          {can.metrics ? (
            <MetricsGrid
              campaignId={campaign.id}
              channels={campaign.channels}
              rows={campaign.rows}
              startDate={campaign.startDate}
              endDate={campaign.endDate}
              today={today}
            />
          ) : null}
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">{t('metrics.imports')}</h3>
            {campaign.imports.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('metrics.noImports')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm" data-testid="import-log">
                {campaign.imports.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-x-2">
                      <bdi dir="ltr" className="font-medium">
                        {i.fileName}
                      </bdi>
                      <span className="text-muted-foreground">
                        {t('metrics.importLine', {
                          rows: i.rowCount,
                          from: f.dayMonth(`${i.dateFrom}T12:00:00Z`),
                          to: f.date(`${i.dateTo}T12:00:00Z`),
                        })}
                      </span>
                    </span>
                    <span className="text-xs text-subtle-foreground">
                      {[i.importedBy?.name, f.relative(i.createdAt)].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="creatives" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{t('creatives.description')}</p>
            {can.manage ? <LinkCreativeDialog campaignId={campaign.id} linkable={linkable} /> : null}
          </div>
          {campaign.deliverables.length === 0 ? (
            <Card>
              <EmptyState compact icon={ImageIcon} title={t('creatives.empty')} />
            </Card>
          ) : (
            <CreativeGrid
              items={campaign.deliverables}
              hrefBase="/deliverables"
              onUnlink={can.manage ? (id) => unlink.run({ deliverableId: id, campaignId: null }) : undefined}
            />
          )}
          {campaign.requests.length ? (
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold">{t('creatives.requests')}</h3>
              <ul className="flex flex-col gap-1.5 text-sm">
                {campaign.requests.map((r) => (
                  <li key={r.id}>
                    <Link href={`/requests/${r.id}`} className="inline-flex flex-wrap items-baseline gap-x-2 hover:underline">
                      {r.reference ? (
                        <bdi dir="ltr" className="text-xs text-subtle-foreground">
                          {r.reference}
                        </bdi>
                      ) : null}
                      <span>{r.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </TabsContent>
        {insights ? <TabsContent value="insights">{insights.panel}</TabsContent> : null}
        <TabsContent value="reports">
          <ReportList reports={campaign.reports} hrefBase="/reports" showClient={false} emptyLabel={t('reportsTab.empty')} />
        </TabsContent>
      </Tabs>
    </>
  );
}
