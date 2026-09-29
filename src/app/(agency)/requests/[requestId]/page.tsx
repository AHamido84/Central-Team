import { ArrowUpRight, ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { DirIcon, PageHeader, SectionTitle } from '@/components/patterns';
import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { Avatar, Card } from '@/components/ui/primitives';
import { requireAgency } from '@/lib/auth/context';
import { localized } from '@/lib/i18n/localized';
import { getFormatters } from '@/lib/i18n/server-format';
import { can } from '@/lib/permissions/can';
import { publicAssetUrl } from '@/lib/storage';
import { CampaignLinkField } from '@/modules/campaigns/components/campaign-link';
import { listCampaignOptions } from '@/modules/campaigns/server/queries';
import { listAgencyPeople } from '@/modules/clients/server/queries';
import { Conversation } from '@/modules/messaging/components/conversation';
import { getThread } from '@/modules/messaging/server/queries';
import { ExtraBadge, PriorityBadge, RequestStatusBadge, TypeIcon } from '@/modules/requests/components/badges';
import { BriefView } from '@/modules/requests/components/brief-fields';
import {
  PersonLine,
  RequestAttachments,
  RequestLiveRefresh,
  RequestTimeline,
  SlaCard,
  TriagePanel,
} from '@/modules/requests/components/request-detail';
import { getRequest } from '@/modules/requests/server/queries';
import { listDeliverables } from '@/modules/deliverables/server/queries';
import { RequestWork } from '@/modules/tasks/components/request-work';
import { dayInZone } from '@/modules/tasks/constants';
import { listTasks } from '@/modules/tasks/server/queries';
import { ConvertToTasksButton } from '@/modules/workflows/components/convert-dialog';
import { getRequestProgress, listTaskStatuses, templatesForRequestType } from '@/modules/workflows/server/queries';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata({ params }: { params: Promise<{ requestId: string }> }): Promise<Metadata> {
  const { requestId } = await params;
  const request = isUuid(requestId) ? await getRequest(requestId) : null;
  return { title: request ? `${request.reference} · ${request.title}` : undefined };
}

export default async function AgencyRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  if (!isUuid(requestId)) notFound();
  const ctx = await requireAgency('requests:read');
  if (!ctx.flags['module.requests']) notFound();
  const request = await getRequest(requestId);
  if (!request) notFound();
  const t = await getTranslations();
  const f = await getFormatters();
  const [thread, people] = await Promise.all([request.threadId ? getThread(request.threadId) : null, listAgencyPeople(ctx)]);
  const canTriage = can(ctx.permissions, 'requests:triage');
  const isAssignee = can(ctx.permissions, 'requests:update') && request.assigneeId === ctx.session.userId;
  const clientName = localized(request.clientName, f.locale);
  const general = request.attachments.filter((a) => !a.fieldId);
  const tasksOn = Boolean(ctx.flags['module.tasks']) && can(ctx.permissions, 'tasks:read');
  const canConvert =
    tasksOn &&
    can(ctx.permissions, 'tasks:create') &&
    !request.convertedAt &&
    ['submitted', 'under_review', 'accepted'].includes(request.status);
  const today = dayInZone(new Date(), ctx.organization.defaultTimezone);
  const campaignsOn = Boolean(ctx.flags['module.campaigns']) && can(ctx.permissions, 'campaigns:read');
  const [templates, work, campaignOptions] = await Promise.all([
    canConvert ? templatesForRequestType(request.typeId) : Promise.resolve([]),
    tasksOn && request.convertedAt
      ? Promise.all([
          getRequestProgress(request.id),
          listTasks({ requestId: request.id, includeDoneDays: 36500 }),
          listDeliverables({ requestId: request.id }),
          listTaskStatuses(),
        ])
      : Promise.resolve(null),
    campaignsOn ? listCampaignOptions(request.clientId) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <BreadcrumbLabel segment={requestId} label={request.reference ?? ''} />
      <RequestLiveRefresh requestId={request.id} />
      <PageHeader
        eyebrow={
          <Link
            href={`/clients/${request.clientId}?tab=requests`}
            className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <Avatar name={clientName} src={publicAssetUrl(request.clientLogo)} size="xs" square />
            {clientName}
            <DirIcon icon={ArrowUpRight} className="size-3.5" />
          </Link>
        }
        title={
          <span className="flex items-start gap-3">
            <TypeIcon icon={request.typeIcon} />
            <span className="min-w-0">
              <bdi data-testid="request-heading">{request.title}</bdi>
              <span className="mt-1 block text-sm font-normal text-muted-foreground">
                <span dir="ltr" data-testid="request-reference">
                  {request.reference}
                </span>{' '}
                · {localized(request.typeName, f.locale)} · {t('requests.formVersion', { version: request.schemaVersion })}
              </span>
            </span>
          </span>
        }
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <RequestStatusBadge status={request.status} />
            <PriorityBadge priority={request.priority} />
            {request.isExtra ? <ExtraBadge /> : null}
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {work ? (
            <RequestWork
              steps={work[0]}
              tasks={work[1]}
              deliverables={work[2]}
              statuses={work[3].map((s) => ({ id: s.id, name: s.name, category: s.category, color: s.color }))}
              today={today}
            />
          ) : null}
          <section>
            <SectionTitle title={t('requests.brief')} />
            <Card className="p-5">
              <BriefView fields={request.fields} brief={request.brief} files={request.attachments} />
            </Card>
          </section>
          <section>
            <SectionTitle title={t('requests.attachmentsAndReferences')} />
            <Card className="grid gap-4 p-4">
              <RequestAttachments files={general} />
              {request.referenceLinks.length ? (
                <ul className="grid gap-1" data-testid="reference-links">
                  {request.referenceLinks.map((u) => (
                    <li key={u}>
                      <a
                        href={u}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex max-w-full items-center gap-1 text-sm text-link hover:underline"
                      >
                        <bdi dir="ltr" className="truncate">
                          {u}
                        </bdi>
                        <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          </section>
          {thread ? (
            <section>
              <SectionTitle title={t('requests.conversation')} />
              <Card className="h-[36rem] overflow-hidden" id="conversation">
                <Conversation
                  initial={thread}
                  me={{ userId: ctx.session.userId }}
                  side="agency"
                  canWrite={can(ctx.permissions, 'messages:send')}
                />
              </Card>
              <p className="mt-2 text-xs text-subtle-foreground">{t('requests.internalNoteHint')}</p>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6">
          <TriagePanel
            request={request}
            people={people.map((p) => ({ id: p.id, name: p.name, avatarPath: p.avatar_path }))}
            canTriage={canTriage}
            isAssignee={isAssignee}
            convertSlot={
              canConvert ? (
                <ConvertToTasksButton
                  requestId={request.id}
                  templates={templates}
                  today={today}
                  canManageWorkflows={can(ctx.permissions, 'workflows:manage')}
                />
              ) : null
            }
          />
          {campaignsOn ? (
            <Card className="p-4">
              <CampaignLinkField
                subject={{ type: 'request', id: request.id }}
                campaignId={request.campaignId}
                options={campaignOptions}
                canManage={can(ctx.permissions, 'campaigns:manage')}
              />
            </Card>
          ) : null}
          <section>
            <SectionTitle title={t('requests.sla.title')} />
            <Card className="p-4">
              <SlaCard request={request} />
            </Card>
          </section>
          <section>
            <SectionTitle title={t('requests.info')} />
            <Card className="p-4">
              <dl className="grid gap-3 text-sm">
                <div className="grid gap-1">
                  <dt className="text-xs text-muted-foreground">{t('requests.submittedBy')}</dt>
                  <dd>
                    <PersonLine person={request.author} fallback="—" />
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-xs text-muted-foreground">{t('requests.fields.desiredDate')}</dt>
                  <dd>{request.desiredDate ? f.date(`${request.desiredDate}T12:00:00`, 'long') : '—'}</dd>
                </div>
                {request.packageItemType ? (
                  <div className="grid gap-1">
                    <dt className="text-xs text-muted-foreground">{t('requests.packageItem')}</dt>
                    <dd>{request.isExtra ? t('requests.extraOutside') : t(`clients.itemTypes.${request.packageItemType}`)}</dd>
                  </div>
                ) : null}
              </dl>
            </Card>
          </section>
          <section>
            <SectionTitle title={t('requests.history')} />
            <Card className="p-4">
              <RequestTimeline items={request.timeline} />
            </Card>
          </section>
        </aside>
      </div>
    </div>
  );
}
