import { MessageCircleQuestion } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader, SectionTitle } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { requirePortal } from '@/lib/auth/context';
import { localized } from '@/lib/i18n/localized';
import { getFormatters } from '@/lib/i18n/server-format';
import { can } from '@/lib/permissions/can';
import { Conversation } from '@/modules/messaging/components/conversation';
import { getThread } from '@/modules/messaging/server/queries';
import { AnswersView } from '@/modules/requests/components/answers-view';
import { FormIcon, RequestStatusBadge } from '@/modules/requests/components/badges';
import {
  CancelRequestButton,
  PersonLine,
  RequestAttachments,
  RequestLiveRefresh,
  RequestTimeline,
  StatusTracker,
} from '@/modules/requests/components/request-detail';
import { formatRequestNumber } from '@/modules/requests/constants';
import { getRequest } from '@/modules/requests/server/queries';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata({ params }: { params: Promise<{ requestId: string }> }): Promise<Metadata> {
  const { requestId } = await params;
  const request = isUuid(requestId) ? await getRequest(requestId) : null;
  return { title: request ? `${formatRequestNumber(request.number)} · ${request.title}` : undefined };
}

export default async function PortalRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  if (!isUuid(requestId)) notFound();
  const ctx = await requirePortal();
  if (!ctx.flags['module.requests']) notFound();
  const request = await getRequest(requestId);
  if (!request || request.clientId !== ctx.client.id) notFound();
  const t = await getTranslations();
  const f = await getFormatters();
  const thread = request.threadId ? await getThread(request.threadId) : null;
  const canWrite = can(ctx.permissions, 'portal_messages:send');

  return (
    <div className="space-y-6">
      <RequestLiveRefresh requestId={request.id} />
      <PageHeader
        title={
          <span className="flex items-start gap-3">
            <FormIcon icon={request.formIcon} />
            <span className="min-w-0">
              <bdi data-testid="request-heading">{request.title}</bdi>
              <span className="mt-1 block text-sm font-normal text-muted-foreground">
                <span dir="ltr">{formatRequestNumber(request.number)}</span> · {localized(request.formName, f.locale)}
              </span>
            </span>
          </span>
        }
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <RequestStatusBadge status={request.status} />
            {can(ctx.permissions, 'portal_requests:create') ? <CancelRequestButton request={request} /> : null}
          </span>
        }
      />

      <Card className="p-5">
        <StatusTracker status={request.status} />
      </Card>

      {request.status === 'waiting_client' ? (
        <div
          className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning-soft p-4 sm:flex-row sm:items-center"
          data-testid="waiting-banner"
        >
          <MessageCircleQuestion className="size-5 shrink-0 text-warning" aria-hidden />
          <div className="flex-1">
            <p className="font-medium">{t('requests.waitingTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('requests.waitingBody')}</p>
          </div>
          {canWrite && thread ? (
            <Button asChild size="sm">
              <a href="#conversation">{t('requests.replyNow')}</a>
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {thread ? (
            <section>
              <SectionTitle title={t('requests.conversation')} />
              <Card className="h-[32rem] overflow-hidden" id="conversation">
                <Conversation initial={thread} me={{ userId: ctx.session.userId }} side="client" canWrite={canWrite} />
              </Card>
            </section>
          ) : null}
          <section>
            <SectionTitle title={t('requests.details')} />
            <Card className="p-5">
              <AnswersView fields={request.fields} answers={request.answers} />
            </Card>
          </section>
          <section>
            <SectionTitle title={t('requests.attachments')} />
            <Card className="p-4">
              <RequestAttachments files={request.attachments} />
            </Card>
          </section>
        </div>
        <aside className="space-y-6">
          <section>
            <SectionTitle title={t('requests.info')} />
            <Card className="p-4">
              <dl className="grid gap-3 text-sm">
                <div className="grid gap-1">
                  <dt className="text-xs text-muted-foreground">{t('requests.handledBy')}</dt>
                  <dd>
                    <PersonLine person={request.assignee} fallback={t('requests.notAssignedYet')} />
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-xs text-muted-foreground">{t('requests.submittedBy')}</dt>
                  <dd>
                    <PersonLine person={request.submitter} fallback="—" />
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-xs text-muted-foreground">{t('requests.submittedAt')}</dt>
                  <dd>{f.dateTime(request.createdAt)}</dd>
                </div>
                {request.desiredDate ? (
                  <div className="grid gap-1">
                    <dt className="text-xs text-muted-foreground">{t('requests.fields.desiredDate')}</dt>
                    <dd>{f.date(`${request.desiredDate}T12:00:00`, 'long')}</dd>
                  </div>
                ) : null}
                {request.responseDueAt && !request.firstResponseAt ? (
                  <div className="grid gap-1">
                    <dt className="text-xs text-muted-foreground">{t('requests.expectedResponse')}</dt>
                    <dd>{f.dateTime(request.responseDueAt)}</dd>
                  </div>
                ) : null}
              </dl>
            </Card>
          </section>
          <section>
            <SectionTitle title={t('requests.history')} />
            <Card className="p-4">
              <RequestTimeline events={request.events} />
            </Card>
          </section>
        </aside>
      </div>
    </div>
  );
}
