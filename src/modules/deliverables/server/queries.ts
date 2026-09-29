import 'server-only';

import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { withRls } from '@/lib/db/rls';
import {
  annotationReplies,
  annotations,
  approvals,
  clients,
  deliverableVersionFiles,
  deliverableVersions,
  deliverables,
  files,
  profiles,
  requests,
  tasks,
} from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import { CLIENT_FILES_BUCKET } from '@/lib/storage';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { AnnotationKind, ApprovalDecision, ApprovalStage, DeliverableStatus, VersionStatus } from '@/modules/deliverables/constants';
import type { DeliverableType } from '@/modules/workflows/constants';

type Person = { id: string; name: string; avatarPath: string | null };

export type VersionFile = {
  id: string;
  name: string;
  mimeType: string;
  kind: 'image' | 'video' | 'pdf' | 'document' | 'archive' | 'other';
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  /** Short-lived signed URLs, issued only for rows RLS returned. */
  url: string | null;
  thumbUrl: string | null;
};

export type ApprovalItem = {
  id: string;
  versionId: string;
  stage: ApprovalStage;
  decision: ApprovalDecision;
  comment: string;
  reviewer: Person | null;
  createdAt: string;
};

export type AnnotationItem = {
  id: string;
  versionId: string;
  fileId: string | null;
  kind: AnnotationKind;
  x: number | null;
  y: number | null;
  timeSeconds: number | null;
  body: string;
  visibility: 'internal' | 'client';
  author: Person | null;
  authorSide: 'agency' | 'client';
  resolvedAt: string | null;
  createdAt: string;
  replies: { id: string; body: string; author: Person | null; authorSide: 'agency' | 'client'; createdAt: string }[];
};

export type VersionItem = {
  id: string;
  number: number;
  status: VersionStatus;
  notes: string;
  uploadedBy: Person | null;
  createdAt: string;
  submittedAt: string | null;
  sentToClientAt: string | null;
  decidedAt: string | null;
  files: VersionFile[];
};

export type DeliverableSummary = {
  id: string;
  title: string;
  type: DeliverableType;
  status: DeliverableStatus;
  clientId: string;
  clientName: LocalizedText;
  clientLogo: string | null;
  requestId: string | null;
  requestReference: string | null;
  requestTitle: string | null;
  taskId: string | null;
  taskNumber: number | null;
  versionCount: number;
  revisionRounds: number;
  requiresInternalReview: boolean;
  requiresClientApproval: boolean;
  scheduledFor: string | null;
  approvedAt: string | null;
  clientVisibleAt: string | null;
  updatedAt: string;
  current: { id: string; number: number; status: VersionStatus; sentToClientAt: string | null; submittedAt: string | null } | null;
  thumbUrl: string | null;
};

export type DeliverableDetail = DeliverableSummary & {
  versions: VersionItem[];
  approvals: ApprovalItem[];
  annotations: AnnotationItem[];
  taskAssignees: string[];
  taskReviewerId: string | null;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

async function sign(paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data } = await supabaseAdmin()
    .storage.from(CLIENT_FILES_BUCKET)
    .createSignedUrls(unique, 60 * 60);
  return new Map((data ?? []).flatMap((d) => (d.signedUrl && d.path ? [[d.path, d.signedUrl] as [string, string]] : [])));
}

type Filter = { requestId?: string; clientId?: string; taskId?: string; ids?: string[]; clientVisibleOnly?: boolean };

/** Deliverables the caller can see (RLS: clients only get the ones sent to them), with the current version's cover image. */
export async function listDeliverables(filter: Filter = {}): Promise<DeliverableSummary[]> {
  const rows = await withRls(async (tx) => {
    const conds = [
      filter.requestId ? eq(deliverables.requestId, filter.requestId) : undefined,
      filter.clientId ? eq(deliverables.clientId, filter.clientId) : undefined,
      filter.taskId ? eq(deliverables.taskId, filter.taskId) : undefined,
      filter.ids ? inArray(deliverables.id, filter.ids.length ? filter.ids : ['00000000-0000-0000-0000-000000000000']) : undefined,
      filter.clientVisibleOnly ? isNotNull(deliverables.clientVisibleAt) : undefined,
    ].filter(Boolean);
    const list = await tx
      .select({
        d: deliverables,
        clientName: clients.name,
        clientLogo: clients.logoPath,
        reference: requests.reference,
        requestTitle: requests.title,
        taskNumber: tasks.number,
        v: deliverableVersions,
      })
      .from(deliverables)
      .innerJoin(clients, eq(clients.id, deliverables.clientId))
      .leftJoin(requests, eq(requests.id, deliverables.requestId))
      .leftJoin(tasks, eq(tasks.id, deliverables.taskId))
      .leftJoin(deliverableVersions, eq(deliverableVersions.id, deliverables.currentVersionId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(deliverables.updatedAt))
      .limit(500);
    // Cover: first image (or its thumbnail) of the latest version the caller can see.
    const deliverableIds = list.map((l) => l.d.id);
    const covers = deliverableIds.length
      ? await tx.execute<{ deliverable_id: string; storage_path: string; thumbnail_path: string | null; kind: string }>(sql`
          select distinct on (v.deliverable_id) v.deliverable_id, f.storage_path, f.thumbnail_path, f.kind
          from public.deliverable_versions v
          join public.deliverable_version_files vf on vf.version_id = v.id
          join public.files f on f.id = vf.file_id
          where v.deliverable_id in (${sql.join(
            deliverableIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
            and (f.kind = 'image' or f.thumbnail_path is not null)
          order by v.deliverable_id, v.number desc, vf.sort_order`)
      : [];
    return { list, covers: [...covers] };
  });
  const coverPath = new Map(rows.covers.map((c) => [c.deliverable_id, c.thumbnail_path ?? c.storage_path]));
  const signed = await sign([...coverPath.values()]);
  return rows.list.map(({ d, clientName, clientLogo, reference, requestTitle, taskNumber, v }) => ({
    id: d.id,
    title: d.title,
    type: d.type as DeliverableType,
    status: d.status as DeliverableStatus,
    clientId: d.clientId,
    clientName,
    clientLogo,
    requestId: d.requestId,
    requestReference: reference,
    requestTitle,
    taskId: d.taskId,
    taskNumber,
    versionCount: d.versionCount,
    revisionRounds: d.revisionRounds,
    requiresInternalReview: d.requiresInternalReview,
    requiresClientApproval: d.requiresClientApproval,
    scheduledFor: d.scheduledFor,
    approvedAt: iso(d.approvedAt),
    clientVisibleAt: iso(d.clientVisibleAt),
    updatedAt: d.updatedAt.toISOString(),
    // RLS hides an internal current version from client users (then `current` is null; their versions list still shows what they saw).
    current: v
      ? {
          id: v.id,
          number: v.number,
          status: v.status as VersionStatus,
          sentToClientAt: iso(v.sentToClientAt),
          submittedAt: iso(v.submittedAt),
        }
      : null,
    thumbUrl: coverPath.has(d.id) ? (signed.get(coverPath.get(d.id)!) ?? null) : null,
  }));
}

export async function getDeliverable(deliverableId: string): Promise<DeliverableDetail | null> {
  const [summary] = await listDeliverables({ ids: [deliverableId] });
  if (!summary) return null;
  const data = await withRls(async (tx) => {
    const versions = await tx
      .select({ v: deliverableVersions, name: profiles.fullName, avatarPath: profiles.avatarPath })
      .from(deliverableVersions)
      .leftJoin(profiles, eq(profiles.id, deliverableVersions.uploadedBy))
      .where(eq(deliverableVersions.deliverableId, deliverableId))
      .orderBy(desc(deliverableVersions.number));
    const versionIds = versions.map((v) => v.v.id);
    const fileRows = versionIds.length
      ? await tx
          .select({ versionId: deliverableVersionFiles.versionId, sortOrder: deliverableVersionFiles.sortOrder, f: files })
          .from(deliverableVersionFiles)
          .innerJoin(files, eq(files.id, deliverableVersionFiles.fileId))
          .where(inArray(deliverableVersionFiles.versionId, versionIds))
          .orderBy(asc(deliverableVersionFiles.sortOrder), asc(files.createdAt))
      : [];
    const approvalRows = await tx
      .select({ a: approvals, name: profiles.fullName, avatarPath: profiles.avatarPath })
      .from(approvals)
      .leftJoin(profiles, eq(profiles.id, approvals.reviewerId))
      .where(eq(approvals.deliverableId, deliverableId))
      .orderBy(desc(approvals.createdAt));
    const annotationRows = await tx
      .select({ a: annotations, name: profiles.fullName, avatarPath: profiles.avatarPath })
      .from(annotations)
      .leftJoin(profiles, eq(profiles.id, annotations.authorId))
      .where(eq(annotations.deliverableId, deliverableId))
      .orderBy(asc(annotations.createdAt));
    const replyRows = annotationRows.length
      ? await tx
          .select({ r: annotationReplies, name: profiles.fullName, avatarPath: profiles.avatarPath })
          .from(annotationReplies)
          .leftJoin(profiles, eq(profiles.id, annotationReplies.authorId))
          .where(
            inArray(
              annotationReplies.annotationId,
              annotationRows.map((a) => a.a.id),
            ),
          )
          .orderBy(asc(annotationReplies.createdAt))
      : [];
    const team = summary.taskId
      ? await tx.execute<{ user_id: string; reviewer_id: string | null }>(sql`
          select m.user_id, t.reviewer_id from public.tasks t
          left join public.task_members m on m.task_id = t.id and m.role = 'assignee'
          where t.id = ${summary.taskId}`)
      : [];
    return { versions, fileRows, approvalRows, annotationRows, replyRows, team: [...team] };
  });
  const signed = await sign(data.fileRows.flatMap((r) => [r.f.storagePath, r.f.thumbnailPath ?? '']));
  const person = (id: string | null, name: string | null, avatarPath: string | null): Person | null =>
    id && name ? { id, name, avatarPath } : null;
  return {
    ...summary,
    versions: data.versions.map(({ v, name, avatarPath }) => ({
      id: v.id,
      number: v.number,
      status: v.status as VersionStatus,
      notes: v.notes,
      uploadedBy: person(v.uploadedBy, name, avatarPath),
      createdAt: v.createdAt.toISOString(),
      submittedAt: iso(v.submittedAt),
      sentToClientAt: iso(v.sentToClientAt),
      decidedAt: iso(v.decidedAt),
      files: data.fileRows
        .filter((r) => r.versionId === v.id)
        .map(({ f }) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          kind: f.kind as VersionFile['kind'],
          sizeBytes: f.sizeBytes,
          width: f.width,
          height: f.height,
          durationSeconds: f.durationSeconds,
          url: signed.get(f.storagePath) ?? null,
          thumbUrl: f.thumbnailPath
            ? (signed.get(f.thumbnailPath) ?? null)
            : f.kind === 'image'
              ? (signed.get(f.storagePath) ?? null)
              : null,
        })),
    })),
    approvals: data.approvalRows.map(({ a, name, avatarPath }) => ({
      id: a.id,
      versionId: a.versionId,
      stage: a.stage as ApprovalStage,
      decision: a.decision as ApprovalDecision,
      comment: a.comment,
      reviewer: person(a.reviewerId, name, avatarPath),
      createdAt: a.createdAt.toISOString(),
    })),
    annotations: data.annotationRows.map(({ a, name, avatarPath }) => ({
      id: a.id,
      versionId: a.versionId,
      fileId: a.fileId,
      kind: a.kind as AnnotationKind,
      x: a.x,
      y: a.y,
      timeSeconds: a.timeSeconds,
      body: a.body,
      visibility: a.visibility as 'internal' | 'client',
      author: person(a.authorId, name, avatarPath),
      authorSide: a.authorSide as 'agency' | 'client',
      resolvedAt: iso(a.resolvedAt),
      createdAt: a.createdAt.toISOString(),
      replies: data.replyRows
        .filter((r) => r.r.annotationId === a.id)
        .map(({ r, name: rn, avatarPath: ra }) => ({
          id: r.id,
          body: r.body,
          author: person(r.authorId, rn, ra),
          authorSide: r.authorSide as 'agency' | 'client',
          createdAt: r.createdAt.toISOString(),
        })),
    })),
    taskAssignees: data.team.map((t) => t.user_id).filter(Boolean),
    taskReviewerId: data.team[0]?.reviewer_id ?? null,
  };
}

/** Portal content calendar: approved or scheduled deliverables in a date range (by scheduled date, else approval date). */
export async function listCalendarDeliverables(
  clientId: string,
  from: string,
  to: string,
): Promise<(DeliverableSummary & { day: string })[]> {
  const list = await listDeliverables({ clientId, clientVisibleOnly: true });
  return list
    .map((d) => ({ ...d, day: d.scheduledFor ?? (d.approvedAt ? d.approvedAt.slice(0, 10) : '') }))
    .filter((d) => d.day && d.day >= from && d.day <= to && (d.status === 'approved' || d.scheduledFor));
}

/** Deliverables waiting for this person's internal review: they review the task, or it has no reviewer and they manage the client. */
export async function listReviewQueue(me: string): Promise<DeliverableSummary[]> {
  const rows = await withRls((tx) =>
    tx.execute<{ id: string }>(sql`
      select d.id from public.deliverables d
      left join public.tasks t on t.id = d.task_id
      join public.clients c on c.id = d.client_id
      where d.status = 'internal_review'
        and (t.reviewer_id = ${me} or (t.reviewer_id is null and c.account_manager_id = ${me}))`),
  );
  const ids = [...rows].map((r) => r.id);
  return ids.length ? listDeliverables({ ids }) : [];
}
