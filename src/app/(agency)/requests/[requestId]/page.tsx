import { ArrowUpRight } from 'lucide-react';
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
import { listAgencyPeople } from '@/modules/clients/server/queries';
import { Conversation } from '@/modules/messaging/components/conversation';
import { getThread } from '@/modules/messaging/server/queries';
import { AnswersView } from '@/modules/requests/components/answers-view';
import { FormIcon, PriorityBadge, RequestStatusBadge } from '@/modules/requests/components/badges';
import {
  PersonLine,
  RequestAttachments,
  RequestLiveRefresh,
  RequestTimeline,
  SlaCard,
  TriagePanel,
} from '@/modules/requests/components/request-detail';
import { formatRequestNumber } from '@/modules/requests/constants';
import { getRequest } from '@/modules/requests/server/queries';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata({ params }: { params: Promise<{ requestId: string }> }): Promise<Metadata> {
  const { requestId } = await params;
  const request = isUuid(requestId) ? await getRequest(requestId) : null;
  return { title: request ? `${formatRequestNumber(request.number)} · ${request.title}` : undefined };
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
  const canUpdate = canTriage || (can(ctx.permissions, 'requests:update') && request.assignee?.id === ctx.session.userId);
  const clientName = localized(request.clientName, f.locale);

  return (
    <div className="space-y-6">
      <BreadcrumbLabel segment={requestId} label={formatRequestNumber(request.number)} />
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
            <FormIcon icon={request.formIcon} />
            <span className="min-w-0">
              <bdi data-testid="request-heading">{request.title}</bdi>
              <span className="mt-1 block text-sm font-normal text-muted-foreground">
                <span dir="ltr">{formatRequestNumber(request.number)}</span> · {localized(request.formName, f.locale)} ·{' '}
                {t('requests.formVersion', { version: request.formVersion })}
              </span>
            </span>
          </span>
        }
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <RequestStatusBadge status={request.status} />
            <PriorityBadge priority={request.priority} />
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
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
            canUpdate={canUpdate}
          />
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
                    <PersonLine person={request.submitter} fallback="—" />
                  </dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-xs text-muted-foreground">{t('requests.submittedAt')}</dt>
                  <dd>{f.dateTime(request.createdAt)}</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-xs text-muted-foreground">{t('requests.fields.desiredDate')}</dt>
                  <dd>{request.desiredDate ? f.date(`${request.desiredDate}T12:00:00`, 'long') : '—'}</dd>
                </div>
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
