import 'server-only';

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { withRls } from '@/lib/db/rls';
import {
  clients,
  files,
  profiles,
  requestAttachments,
  requestEvents,
  requestStatusHistory,
  requestTypes,
  requests,
  threads,
} from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import type { PackageItemType } from '@/modules/clients/constants';
import { toFileItem, withThumbnails, type FileItem } from '@/modules/files/server/queries';
import type { RequestPriority, RequestStatus, TypeCategory, TypeIcon } from '@/modules/requests/constants';
import type { Brief, RequestFormField } from '@/modules/requests/form-schema';

type Person = { id: string; name: string; avatarPath: string | null };

export type RequestListItem = {
  id: string;
  reference: string | null;
  title: string;
  status: RequestStatus;
  priority: RequestPriority;
  clientId: string;
  clientName: LocalizedText;
  clientLogo: string | null;
  typeId: string;
  typeName: LocalizedText;
  typeIcon: TypeIcon;
  packageItemType: PackageItemType | null;
  assigneeId: string | null;
  assignee: Person | null;
  author: Person | null;
  desiredDate: string | null;
  dueDate: string | null;
  isExtra: boolean;
  isBillable: boolean;
  submittedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  lastActivityAt: string;
  threadId: string | null;
  unread: number;
  comments: number;
  /** The agency's latest question while the request is in Needs info. */
  needsInfoReason: string | null;
};

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

async function selectRequests(where: { clientId?: string; ids?: string[]; limit?: number }) {
  return withRls(async (tx) => {
    const rows = await tx
      .select({
        r: requests,
        clientName: clients.name,
        clientLogo: clients.logoPath,
        typeName: requestTypes.name,
        typeIcon: requestTypes.icon,
        packageItemType: requestTypes.packageItemType,
        assigneeName: sql<string | null>`(select p.full_name from public.profiles p where p.id = requests.assignee_id)`,
        assigneeAvatar: sql<string | null>`(select p.avatar_path from public.profiles p where p.id = requests.assignee_id)`,
        authorName: profiles.fullName,
        authorAvatar: profiles.avatarPath,
        threadId: threads.id,
        // Counts go through RLS (comments_select), so client users never count internal notes.
        comments: sql<number>`(select count(*)::int from public.comments c where c.thread_id = threads.id and c.deleted_at is null)`,
        unread: sql<number>`(select count(*)::int from public.comments c where c.thread_id = threads.id and c.deleted_at is null and c.author_id is distinct from auth.uid() and c.created_at > coalesce((select tr.last_read_at from public.thread_reads tr where tr.thread_id = threads.id and tr.user_id = auth.uid()), 'epoch'))`,
        needsInfoReason: sql<
          string | null
        >`(select h.reason from public.request_status_history h where h.request_id = requests.id and h.to_status = 'needs_info' order by h.created_at desc limit 1)`,
      })
      .from(requests)
      .innerJoin(clients, eq(clients.id, requests.clientId))
      .innerJoin(requestTypes, eq(requestTypes.id, requests.requestTypeId))
      .leftJoin(profiles, eq(profiles.id, requests.createdBy))
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
      reference: x.r.reference,
      title: x.r.title,
      status: x.r.status as RequestStatus,
      priority: x.r.priority as RequestPriority,
      clientId: x.r.clientId,
      clientName: x.clientName,
      clientLogo: x.clientLogo,
      typeId: x.r.requestTypeId,
      typeName: x.typeName,
      typeIcon: x.typeIcon as TypeIcon,
      packageItemType: x.packageItemType as PackageItemType | null,
      assigneeId: x.r.assigneeId,
      assignee: x.r.assigneeId ? { id: x.r.assigneeId, name: x.assigneeName ?? '', avatarPath: x.assigneeAvatar } : null,
      author: x.r.createdBy ? { id: x.r.createdBy, name: x.authorName ?? '', avatarPath: x.authorAvatar } : null,
      desiredDate: x.r.desiredDate,
      dueDate: x.r.dueDate,
      isExtra: x.r.isExtra,
      isBillable: x.r.isBillable,
      submittedAt: iso(x.r.submittedAt),
      deliveredAt: iso(x.r.deliveredAt),
      createdAt: x.r.createdAt.toISOString(),
      lastActivityAt: x.r.lastActivityAt.toISOString(),
      threadId: x.threadId,
      unread: x.unread,
      comments: x.comments,
      needsInfoReason: x.r.status === 'needs_info' ? x.needsInfoReason : null,
    }));
  });
}

/** Requests the caller can see (RLS: agency never sees drafts; client users see their client's plus own drafts). */
export async function listRequests(opts: { clientId?: string; limit?: number } = {}): Promise<RequestListItem[]> {
  return selectRequests(opts);
}

export type TimelineItem =
  | {
      kind: 'status';
      id: string;
      from: RequestStatus | null;
      to: RequestStatus;
      reason: string | null;
      actorName: string | null;
      actorSide: 'agency' | 'client' | 'system';
      createdAt: string;
    }
  | {
      kind: 'event';
      id: string;
      type: 'assigned' | 'priority_changed' | 'due_date_changed' | 'flags_changed' | 'brief_updated';
      fromValue: string | null;
      toValue: string | null;
      /** Assignment events: the people behind the ids. */
      toName: string | null;
      actorName: string | null;
      actorSide: 'agency' | 'client' | 'system';
      visibility: 'internal' | 'client';
      createdAt: string;
    };

export type RequestAttachment = FileItem & { fieldId: string | null };

export type RequestDetail = RequestListItem & {
  brief: Brief;
  fields: RequestFormField[];
  schemaVersion: number;
  referenceLinks: string[];
  attachments: RequestAttachment[];
  timeline: TimelineItem[];
};

export async function getRequest(requestId: string): Promise<RequestDetail | null> {
  const [item] = await selectRequests({ ids: [requestId], limit: 1 });
  if (!item) return null;
  const detail = await withRls(async (tx) => {
    const [row] = await tx
      .select({ brief: requests.brief, fields: requests.formSnapshot, version: requests.schemaVersion, links: requests.referenceLinks })
      .from(requests)
      .where(eq(requests.id, requestId));
    const attachmentRows = await tx
      .select({ file: files, fieldId: requestAttachments.fieldId, uploaderName: profiles.fullName, uploaderAvatar: profiles.avatarPath })
      .from(requestAttachments)
      .innerJoin(files, eq(files.id, requestAttachments.fileId))
      .leftJoin(profiles, eq(profiles.id, files.uploadedBy))
      .where(and(eq(requestAttachments.requestId, requestId), isNull(files.deletedAt)))
      .orderBy(asc(files.createdAt));
    const history = await tx
      .select({ h: requestStatusHistory, actorName: profiles.fullName })
      .from(requestStatusHistory)
      .leftJoin(profiles, eq(profiles.id, requestStatusHistory.actorId))
      .where(eq(requestStatusHistory.requestId, requestId));
    const events = await tx
      .select({ e: requestEvents, actorName: profiles.fullName })
      .from(requestEvents)
      .leftJoin(profiles, eq(profiles.id, requestEvents.actorId))
      .where(eq(requestEvents.requestId, requestId));
    const assigneeIds = [...new Set(events.filter((x) => x.e.type === 'assigned' && x.e.toValue).map((x) => x.e.toValue!))];
    const people = assigneeIds.length
      ? await tx.select({ id: profiles.id, name: profiles.fullName }).from(profiles).where(inArray(profiles.id, assigneeIds))
      : [];
    const timeline: TimelineItem[] = [
      ...history.map(({ h, actorName }): TimelineItem => ({
        kind: 'status',
        id: h.id,
        from: h.fromStatus as RequestStatus | null,
        to: h.toStatus as RequestStatus,
        reason: h.reason,
        actorName,
        actorSide: h.actorSide as 'agency' | 'client' | 'system',
        createdAt: h.createdAt.toISOString(),
      })),
      ...events.map(({ e, actorName }): TimelineItem => ({
        kind: 'event',
        id: e.id,
        type: e.type as Extract<TimelineItem, { kind: 'event' }>['type'],
        fromValue: e.fromValue,
        toValue: e.toValue,
        toName: e.type === 'assigned' ? (people.find((p) => p.id === e.toValue)?.name ?? null) : null,
        actorName,
        actorSide: e.actorSide as 'agency' | 'client' | 'system',
        visibility: e.visibility as 'internal' | 'client',
        createdAt: e.createdAt.toISOString(),
      })),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      brief: row?.brief ?? {},
      fields: row?.fields ?? [],
      schemaVersion: row?.version ?? 1,
      referenceLinks: row?.links ?? [],
      attachments: attachmentRows.map((a) => ({ ...toFileItem(a.file, a.uploaderName, a.uploaderAvatar), fieldId: a.fieldId })),
      paths: new Map(attachmentRows.map((a) => [a.file.id, a.file.storagePath])),
      timeline,
    };
  });
  const { paths, ...rest } = detail;
  const withThumbs = await withThumbnails(rest.attachments, paths);
  return {
    ...item,
    ...rest,
    attachments: withThumbs.map((f, i) => ({ ...f, fieldId: rest.attachments[i]!.fieldId })),
  };
}

export type RequestTypeItem = {
  id: string;
  key: string;
  name: LocalizedText;
  description: LocalizedText;
  icon: TypeIcon;
  category: TypeCategory;
  defaultPriority: RequestPriority;
  slaDays: number | null;
  packageItemType: PackageItemType | null;
  isActive: boolean;
  fields: RequestFormField[];
  schemaVersion: number;
  requestCount: number;
  updatedAt: string;
};

/** Request types visible to the caller (portal: RLS returns active types only). */
export async function listRequestTypes(opts: { activeOnly?: boolean } = {}): Promise<RequestTypeItem[]> {
  return withRls(async (tx) => {
    const rows = await tx
      .select({
        t: requestTypes,
        requestCount: sql<number>`(select count(*)::int from public.requests r where r.request_type_id = request_types.id)`,
      })
      .from(requestTypes)
      .where(opts.activeOnly ? eq(requestTypes.isActive, true) : undefined)
      .orderBy(asc(requestTypes.sortOrder), asc(requestTypes.createdAt));
    return rows.map(({ t, requestCount }) => ({
      id: t.id,
      key: t.key,
      name: t.name,
      description: t.description,
      icon: t.icon as TypeIcon,
      category: t.category as TypeCategory,
      defaultPriority: t.defaultPriority as RequestPriority,
      slaDays: t.slaDays,
      packageItemType: t.packageItemType as PackageItemType | null,
      isActive: t.isActive,
      fields: t.formSchema.fields ?? [],
      schemaVersion: t.schemaVersion,
      requestCount,
      updatedAt: t.updatedAt.toISOString(),
    }));
  });
}

export async function getRequestType(typeId: string): Promise<RequestTypeItem | null> {
  return (await listRequestTypes()).find((t) => t.id === typeId) ?? null;
}

export type Quota = { itemType: PackageItemType; allowed: number; used: number; pending: number; hasPackage: boolean };

/** Remaining package quota per item type for the client's current period (for the wizard's package check). */
export async function getQuotas(clientId: string, itemTypes: readonly string[], excludeRequestId?: string): Promise<Record<string, Quota>> {
  const unique = [...new Set(itemTypes)];
  if (!unique.length) return {};
  return withRls(async (tx) => {
    const out: Record<string, Quota> = {};
    for (const item of unique) {
      const [row] = await tx.execute<{ client_package_id: string | null; allowed: number; used: number; pending: number }>(
        sql`select * from app.request_quota(${clientId}, ${item}, ${excludeRequestId ?? null})`,
      );
      out[item] = {
        itemType: item as PackageItemType,
        allowed: row?.allowed ?? 0,
        used: row?.used ?? 0,
        pending: row?.pending ?? 0,
        hasPackage: Boolean(row?.client_package_id),
      };
    }
    return out;
  });
}

export type RequestActivity = {
  id: string;
  requestId: string;
  reference: string | null;
  title: string;
  to: RequestStatus;
  actorName: string | null;
  at: string;
};

/** Recent status changes of a client's requests (portal home timeline). */
export async function listRequestActivity(clientId: string, limit = 8): Promise<RequestActivity[]> {
  return withRls(async (tx) => {
    const rows = await tx
      .select({
        id: requestStatusHistory.id,
        requestId: requests.id,
        reference: requests.reference,
        title: requests.title,
        to: requestStatusHistory.toStatus,
        actorName: profiles.fullName,
        at: requestStatusHistory.createdAt,
      })
      .from(requestStatusHistory)
      .innerJoin(requests, eq(requests.id, requestStatusHistory.requestId))
      .leftJoin(profiles, eq(profiles.id, requestStatusHistory.actorId))
      .where(eq(requestStatusHistory.clientId, clientId))
      .orderBy(desc(requestStatusHistory.createdAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, to: r.to as RequestStatus, at: r.at.toISOString() }));
  });
}
