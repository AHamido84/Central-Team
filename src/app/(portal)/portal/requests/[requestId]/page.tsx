import { ExternalLink, MessageCircleQuestion, PencilLine } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader, SectionTitle } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { DeliverableCard } from '@/modules/deliverables/components/deliverables-list';
import { listDeliverables } from '@/modules/deliverables/server/queries';
import { RequestProgress } from '@/modules/workflows/components/request-progress';
import { getRequestProgress } from '@/modules/workflows/server/queries';
import { requirePortal } from '@/lib/auth/context';
import { localized } from '@/lib/i18n/localized';
import { getFormatters } from '@/lib/i18n/server-format';
import { can } from '@/lib/permissions/can';
import { Conversation } from '@/modules/messaging/components/conversation';
import { getThread } from '@/modules/messaging/server/queries';
import { ExtraBadge, RequestStatusBadge, TypeIcon } from '@/modules/requests/components/badges';
import { BriefView } from '@/modules/requests/components/brief-fields';
import {
  ClientRequestActions,
  PersonLine,
  RequestAttachments,
  RequestLiveRefresh,
  RequestTimeline,
  StatusTracker,
} from '@/modules/requests/components/request-detail';
import { getRequest } from '@/modules/requests/server/queries';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata({ params }: { params: Promise<{ requestId: string }> }): Promise<Metadata> {
  const { requestId } = await params;
  const request = isUuid(requestId) ? await getRequest(requestId) : null;
  return { title: request ? `${request.reference ?? ''} · ${request.title}` : undefined };
}

export default async function PortalRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  if (!isUuid(requestId)) notFound();
  const ctx = await requirePortal();
  if (!ctx.flags['module.requests']) notFound();
  const request = await getRequest(requestId);
  if (!request || request.clientId !== ctx.client.id) notFound();
  const canEdit = can(ctx.permissions, 'portal_requests:create');
  if (request.status === 'draft') redirect(`/portal/requests/${requestId}/edit`);
  const t = await getTranslations();
  const f = await getFormatters();
  const thread = request.threadId ? await getThread(request.threadId) : null;
  const canWrite = can(ctx.permissions, 'portal_messages:send');
  // Internal history (assignment, priority, flags) is filtered by RLS; keep only what the client can see.
  const timeline = request.timeline.filter((x) => x.kind === 'status' || x.visibility === 'client');
  const general = request.attachments.filter((a) => !a.fieldId);
  const [progress, deliverables] = await Promise.all([
    request.convertedAt ? getRequestProgress(request.id) : Promise.resolve([]),
    ctx.flags['module.approvals'] ? listDeliverables({ requestId: request.id, clientVisibleOnly: true }) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <RequestLiveRefresh requestId={request.id} />
      <PageHeader
        title={
          <span className="flex items-start gap-3">
            <TypeIcon icon={request.typeIcon} />
            <span className="min-w-0">
              <bdi data-testid="request-heading">{request.title}</bdi>
              <span className="mt-1 block text-sm font-normal text-muted-foreground">
                <span dir="ltr" data-testid="request-reference">
                  {request.reference}
                </span>{' '}
                · {localized(request.typeName, f.locale)}
              </span>
            </span>
          </span>
        }
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <RequestStatusBadge status={request.status} />
            {request.isExtra ? <ExtraBadge /> : null}
          </span>
        }
      />

      <Card className="grid gap-4 p-5">
        <StatusTracker status={request.status} />
        <ClientRequestActions request={request} canEdit={canEdit} />
      </Card>

      {request.status === 'needs_info' ? (
        <div
          className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4 sm:flex-row sm:items-start"
          data-testid="needs-info-banner"
        >
          <MessageCircleQuestion className="size-5 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t('requests.needsInfo.bannerTitle')}</p>
            {request.needsInfoReason ? (
              <p dir="auto" className="mt-1 text-sm whitespace-pre-wrap" data-testid="needs-info-reason">
                {request.needsInfoReason}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-muted-foreground">{t('requests.needsInfo.bannerBody')}</p>
          </div>
          {canEdit ? (
            <Button asChild size="sm">
              <Link href={`/portal/requests/${request.id}/edit`}>
                <PencilLine />
                {t('requests.needsInfo.update')}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {request.status === 'delivered' ? (
        <div className="rounded-xl border border-success/30 bg-success-soft p-4 text-sm" data-testid="delivered-banner">
          <p className="font-medium">{t('requests.deliveredBanner.title')}</p>
          <p className="mt-1 text-muted-foreground">{t('requests.deliveredBanner.body')}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {deliverables.length ? (
            <section data-testid="request-deliverables">
              <SectionTitle title={t('deliverables.portal.forRequest')} />
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {deliverables.map((d) => (
                  <li key={d.id} className="min-w-0">
                    <DeliverableCard d={d} side="client" href={`/portal/approvals/${d.id}`} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {thread ? (
            <section>
              <SectionTitle title={t('requests.conversation')} />
              <Card className="h-[32rem] overflow-hidden" id="conversation">
                <Conversation initial={thread} me={{ userId: ctx.session.userId }} side="client" canWrite={canWrite} />
              </Card>
            </section>
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
                <ul className="grid gap-1">
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
        </div>
        <aside className="space-y-6">
          {progress.length ? (
            <section>
              <SectionTitle title={t('workflows.progress.title')} />
              <Card className="p-4">
                <RequestProgress steps={progress} />
              </Card>
            </section>
          ) : null}
          <section>
            <SectionTitle title={t('requests.info')} />
            <Card className="p-4">
              <dl className="grid gap-3 text-sm">
                <div className="grid gap-1">
                  <dt className="text-xs text-muted-foreground">{t('requests.accountManager')}</dt>
                  <dd>
                    <PersonLine person={request.assignee} fallback={t('requests.notAssignedYet')} />
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-xs text-muted-foreground">{t('requests.submittedBy')}</dt>
                  <dd>
                    <PersonLine person={request.author} fallback="—" />
                  </dd>
                </div>
                {request.submittedAt ? (
                  <div className="grid gap-1">
                    <dt className="text-xs text-muted-foreground">{t('requests.submittedAt')}</dt>
                    <dd>{f.dateTime(request.submittedAt)}</dd>
                  </div>
                ) : null}
                {request.dueDate ? (
                  <div className="grid gap-1">
                    <dt className="text-xs text-muted-foreground">{t('requests.expectedDelivery')}</dt>
                    <dd data-testid="request-due">{f.date(`${request.dueDate}T12:00:00`, 'long')}</dd>
                  </div>
                ) : null}
                {request.desiredDate ? (
                  <div className="grid gap-1">
                    <dt className="text-xs text-muted-foreground">{t('requests.fields.desiredDate')}</dt>
                    <dd>{f.date(`${request.desiredDate}T12:00:00`, 'long')}</dd>
                  </div>
                ) : null}
              </dl>
            </Card>
          </section>
          <section>
            <SectionTitle title={t('requests.history')} />
            <Card className="p-4">
              <RequestTimeline items={timeline} />
            </Card>
          </section>
        </aside>
      </div>
    </div>
  );
}
