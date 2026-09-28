import 'server-only';

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { withRls } from '@/lib/db/rls';
import {
  clients,
  files,
  profiles,
  requestAttachments,
  requestEvents,
  requestFormVersions,
  requestForms,
  requests,
  threads,
} from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import { toFileItem, withThumbnails, type FileItem } from '@/modules/files/server/queries';
import type { FormCategory, FormIcon, FormStatus, RequestPriority, RequestStatus } from '@/modules/requests/constants';
import type { RequestFormField } from '@/modules/requests/form-schema';

type Person = { id: string; name: string; avatarPath: string | null };

export type RequestListItem = {
  id: string;
  number: number;
  title: string;
  status: RequestStatus;
  priority: RequestPriority;
  clientId: string;
  clientName: LocalizedText;
  clientLogo: string | null;
  formId: string;
  formName: LocalizedText;
  formIcon: FormIcon;
  assignee: Person | null;
  submitter: Person | null;
  submittedSide: 'agency' | 'client';
  desiredDate: string | null;
  createdAt: string;
  lastActivityAt: string;
  responseDueAt: string | null;
  resolutionDueAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  threadId: string | null;
  unread: number;
  comments: number;
};

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

async function selectRequests(where: { clientId?: string; ids?: string[]; limit?: number }) {
  return withRls(async (tx) => {
    const assignee = sql<string | null>`(select p.full_name from public.profiles p where p.id = requests.assignee_id)`;
    const rows = await tx
      .select({
        r: requests,
        clientName: clients.name,
        clientLogo: clients.logoPath,
        formName: requestForms.name,
        formIcon: requestForms.icon,
        assigneeName: assignee,
        assigneeAvatar: sql<string | null>`(select p.avatar_path from public.profiles p where p.id = requests.assignee_id)`,
        submitterName: profiles.fullName,
        submitterAvatar: profiles.avatarPath,
        threadId: threads.id,
        // Counts go through RLS (comments_select), so client users never count internal notes.
        comments: sql<number>`(select count(*)::int from public.comments c where c.thread_id = threads.id and c.deleted_at is null)`,
        unread: sql<number>`(select count(*)::int from public.comments c where c.thread_id = threads.id and c.deleted_at is null and c.author_id is distinct from auth.uid() and c.created_at > coalesce((select tr.last_read_at from public.thread_reads tr where tr.thread_id = threads.id and tr.user_id = auth.uid()), 'epoch'))`,
      })
      .from(requests)
      .innerJoin(clients, eq(clients.id, requests.clientId))
      .innerJoin(requestForms, eq(requestForms.id, requests.formId))
      .leftJoin(profiles, eq(profiles.id, requests.submittedBy))
      .leftJoin(threads, and(eq(threads.subjectType, 'request'), eq(threads.subjectId, requests.id)))
      .where(
        and(
          where.clientId ? eq(requests.clientId, where.clientId) : undefined,
          where.ids ? inArray(requests.id, where.ids.length ? where.ids : ['00000000-0000-0000-0000-000000000000']) : undefined,
        ),
      )
      .orderBy(desc(requests.lastActivityAt))
      .limit(where.limit ?? 500);
    return rows.map((x): RequestListItem => ({
      id: x.r.id,
      number: x.r.number,
      title: x.r.title,
      status: x.r.status as RequestStatus,
      priority: x.r.priority as RequestPriority,
      clientId: x.r.clientId,
      clientName: x.clientName,
      clientLogo: x.clientLogo,
      formId: x.r.formId,
      formName: x.formName,
      formIcon: x.formIcon as FormIcon,
      assignee: x.r.assigneeId ? { id: x.r.assigneeId, name: x.assigneeName ?? '', avatarPath: x.assigneeAvatar } : null,
      submitter: x.r.submittedBy ? { id: x.r.submittedBy, name: x.submitterName ?? '', avatarPath: x.submitterAvatar } : null,
      submittedSide: x.r.submittedSide as 'agency' | 'client',
      desiredDate: x.r.desiredDate,
      createdAt: x.r.createdAt.toISOString(),
      lastActivityAt: x.r.lastActivityAt.toISOString(),
      responseDueAt: iso(x.r.responseDueAt),
      resolutionDueAt: iso(x.r.resolutionDueAt),
      firstResponseAt: iso(x.r.firstResponseAt),
      resolvedAt: iso(x.r.resolvedAt),
      threadId: x.threadId,
      unread: x.unread,
      comments: x.comments,
    }));
  });
}

/** Requests the caller can see (RLS: agency by client access + `requests:read`; client users their own client). */
export async function listRequests(opts: { clientId?: string; limit?: number } = {}): Promise<RequestListItem[]> {
  return selectRequests(opts);
}

export type RequestEventItem = {
  id: string;
  type: 'submitted' | 'status_changed' | 'assigned' | 'priority_changed';
  actorName: string | null;
  actorAvatar: string | null;
  actorSide: 'agency' | 'client' | 'system';
  fromValue: string | null;
  toValue: string | null;
  /** For assignment events: the people behind the ids. */
  fromName: string | null;
  toName: string | null;
  visibility: 'internal' | 'client';
  createdAt: string;
};

export type RequestDetail = RequestListItem & {
  answers: Record<string, unknown>;
  fields: RequestFormField[];
  formVersion: number;
  attachments: FileItem[];
  events: RequestEventItem[];
};

export async function getRequest(requestId: string): Promise<RequestDetail | null> {
  const [item] = await selectRequests({ ids: [requestId], limit: 1 });
  if (!item) return null;
  const detail = await withRls(async (tx) => {
    const [row] = await tx
      .select({ answers: requests.answers, fields: requestFormVersions.fields, version: requestFormVersions.version })
      .from(requests)
      .innerJoin(requestFormVersions, eq(requestFormVersions.id, requests.formVersionId))
      .where(eq(requests.id, requestId));
    const attachmentRows = await tx
      .select({ file: files, uploaderName: profiles.fullName, uploaderAvatar: profiles.avatarPath })
      .from(requestAttachments)
      .innerJoin(files, eq(files.id, requestAttachments.fileId))
      .leftJoin(profiles, eq(profiles.id, files.uploadedBy))
      .where(and(eq(requestAttachments.requestId, requestId), isNull(files.deletedAt)))
      .orderBy(asc(files.createdAt));
    const events = await tx
      .select({ e: requestEvents, actorName: profiles.fullName, actorAvatar: profiles.avatarPath })
      .from(requestEvents)
      .leftJoin(profiles, eq(profiles.id, requestEvents.actorId))
      .where(eq(requestEvents.requestId, requestId))
      .orderBy(asc(requestEvents.createdAt));
    const personIds = [
      ...new Set(
        events
          .filter((x) => x.e.type === 'assigned')
          .flatMap((x) => [x.e.fromValue, x.e.toValue])
          .filter(Boolean) as string[],
      ),
    ];
    const people = personIds.length
      ? await tx.select({ id: profiles.id, name: profiles.fullName }).from(profiles).where(inArray(profiles.id, personIds))
      : [];
    const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? null) : null);
    return {
      answers: row?.answers ?? {},
      fields: row?.fields ?? [],
      formVersion: row?.version ?? 1,
      attachments: attachmentRows.map((a) => toFileItem(a.file, a.uploaderName, a.uploaderAvatar)),
      paths: new Map(attachmentRows.map((a) => [a.file.id, a.file.storagePath])),
      events: events.map(({ e, actorName, actorAvatar }): RequestEventItem => ({
        id: e.id,
        type: e.type as RequestEventItem['type'],
        actorName,
        actorAvatar,
        actorSide: e.actorSide as RequestEventItem['actorSide'],
        fromValue: e.fromValue,
        toValue: e.toValue,
        fromName: e.type === 'assigned' ? nameOf(e.fromValue) : null,
        toName: e.type === 'assigned' ? nameOf(e.toValue) : null,
        visibility: e.visibility as 'internal' | 'client',
        createdAt: e.createdAt.toISOString(),
      })),
    };
  });
  const { paths, ...rest } = detail;
  return { ...item, ...rest, attachments: await withThumbnails(rest.attachments, paths) };
}

export type FormSummary = {
  id: string;
  key: string;
  name: LocalizedText;
  description: LocalizedText;
  icon: FormIcon;
  category: FormCategory;
  status: FormStatus;
  defaultPriority: RequestPriority;
  responseSlaHours: number | null;
  resolutionSlaHours: number | null;
  currentVersion: number | null;
  hasDraft: boolean;
  requestCount: number;
  fieldCount: number;
  updatedAt: string;
};

/** Agency list of forms (drafts and archived included). */
export async function listForms(): Promise<FormSummary[]> {
  return withRls(async (tx) => {
    const rows = await tx
      .select({
        f: requestForms,
        currentVersion: sql<
          number | null
        >`(select v.version from public.request_form_versions v where v.id = request_forms.current_version_id)`,
        fieldCount: sql<number>`coalesce((select jsonb_array_length(v.fields) from public.request_form_versions v where v.form_id = request_forms.id order by (v.published_at is null) desc, v.version desc limit 1), 0)`,
        hasDraft: sql<boolean>`exists (select 1 from public.request_form_versions v where v.form_id = request_forms.id and v.published_at is null)`,
        requestCount: sql<number>`(select count(*)::int from public.requests r where r.form_id = request_forms.id)`,
      })
      .from(requestForms)
      .orderBy(asc(requestForms.sortOrder), asc(requestForms.createdAt));
    return rows.map(({ f, currentVersion, fieldCount, hasDraft, requestCount }) => ({
      id: f.id,
      key: f.key,
      name: f.name,
      description: f.description,
      icon: f.icon as FormIcon,
      category: f.category as FormCategory,
      status: f.status as FormStatus,
      defaultPriority: f.defaultPriority as RequestPriority,
      responseSlaHours: f.responseSlaHours,
      resolutionSlaHours: f.resolutionSlaHours,
      currentVersion,
      hasDraft,
      requestCount,
      fieldCount,
      updatedAt: f.updatedAt.toISOString(),
    }));
  });
}

export type FormVersionItem = {
  id: string;
  version: number;
  publishedAt: string | null;
  publishedByName: string | null;
  fieldCount: number;
};

export type FormForBuilder = {
  form: FormSummary;
  /** Fields being edited: the draft if one exists, else a copy of the published version. */
  fields: RequestFormField[];
  draftVersionId: string | null;
  versions: FormVersionItem[];
};

export async function getFormForBuilder(formId: string): Promise<FormForBuilder | null> {
  const forms = await listForms();
  const form = forms.find((f) => f.id === formId);
  if (!form) return null;
  return withRls(async (tx) => {
    const versions = await tx
      .select({ v: requestFormVersions, publishedByName: profiles.fullName })
      .from(requestFormVersions)
      .leftJoin(profiles, eq(profiles.id, requestFormVersions.publishedBy))
      .where(eq(requestFormVersions.formId, formId))
      .orderBy(desc(requestFormVersions.version));
    const draft = versions.find((x) => !x.v.publishedAt);
    const latest = versions.find((x) => x.v.publishedAt);
    return {
      form,
      fields: (draft ?? latest)?.v.fields ?? [],
      draftVersionId: draft?.v.id ?? null,
      versions: versions.map(({ v, publishedByName }) => ({
        id: v.id,
        version: v.version,
        publishedAt: iso(v.publishedAt),
        publishedByName,
        fieldCount: v.fields.length,
      })),
    };
  });
}

export type PublishedForm = {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  icon: FormIcon;
  category: FormCategory;
  defaultPriority: RequestPriority;
  responseSlaHours: number | null;
  versionId: string;
  fields: RequestFormField[];
};

/** Forms a request can be submitted with (portal: RLS only returns published forms). */
export async function listPublishedForms(): Promise<PublishedForm[]> {
  return withRls(async (tx) => {
    const rows = await tx
      .select({ f: requestForms, v: requestFormVersions })
      .from(requestForms)
      .innerJoin(requestFormVersions, eq(requestFormVersions.id, requestForms.currentVersionId))
      .where(eq(requestForms.status, 'published'))
      .orderBy(asc(requestForms.sortOrder), asc(requestForms.createdAt));
    return rows.map(({ f, v }) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      icon: f.icon as FormIcon,
      category: f.category as FormCategory,
      defaultPriority: f.defaultPriority as RequestPriority,
      responseSlaHours: f.responseSlaHours,
      versionId: v.id,
      fields: v.fields,
    }));
  });
}

export async function getPublishedForm(formId: string): Promise<PublishedForm | null> {
  const forms = await listPublishedForms();
  return forms.find((f) => f.id === formId) ?? null;
}
