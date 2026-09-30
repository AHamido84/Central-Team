import 'server-only';

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { withRls } from '@/lib/db/rls';
import { CLIENT_FILES_BUCKET } from '@/lib/storage';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fileFolders, files, profiles } from '@/lib/db/schema';

export type FolderItem = {
  id: string;
  name: string;
  kind: 'month' | 'project' | 'type' | 'brand' | 'custom';
  visibility: 'internal' | 'client';
  fileCount: number;
  updatedAt: string;
};

export type FileItem = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: 'image' | 'video' | 'pdf' | 'document' | 'archive' | 'other';
  visibility: 'internal' | 'client';
  folderId: string | null;
  uploaderName: string | null;
  uploaderAvatar: string | null;
  uploaderSide: 'agency' | 'client';
  /** Uploaders may delete their own files (ADR-080). */
  uploadedBy: string | null;
  createdAt: string;
  /** Short-lived signed URL for image thumbnails (only for rows the caller could already read via RLS). */
  thumbUrl?: string | null;
};

/** Adds signed thumbnail URLs for images. Storage paths come from rows already filtered by RLS. */
export async function withThumbnails(items: FileItem[], paths: Map<string, string>): Promise<FileItem[]> {
  const images = items.filter((i) => i.kind === 'image' && paths.has(i.id));
  if (images.length === 0) return items;
  const { data } = await supabaseAdmin()
    .storage.from(CLIENT_FILES_BUCKET)
    .createSignedUrls(
      images.map((i) => paths.get(i.id)!),
      60 * 60,
    );
  const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  return items.map((i) => (paths.has(i.id) && i.kind === 'image' ? { ...i, thumbUrl: byPath.get(paths.get(i.id)!) ?? null } : i));
}

/** Folders and library files the current user can see (RLS hides internal items from client users). */
export async function listClientLibrary(clientId: string) {
  const result = await withRls(async (tx) => {
    const folders = await tx
      .select({
        f: fileFolders,
        fileCount: sql<number>`(select count(*)::int from public.files x where x.folder_id = file_folders.id and x.deleted_at is null and x.source = 'library')`,
      })
      .from(fileFolders)
      .where(eq(fileFolders.clientId, clientId))
      .orderBy(
        sql`case ${fileFolders.kind} when 'brand' then 0 when 'month' then 1 when 'project' then 2 when 'type' then 3 else 4 end`,
        desc(fileFolders.createdAt),
      );
    const rows = await tx
      .select({ file: files, uploaderName: profiles.fullName, uploaderAvatar: profiles.avatarPath })
      .from(files)
      .leftJoin(profiles, eq(profiles.id, files.uploadedBy))
      .where(and(eq(files.clientId, clientId), eq(files.source, 'library'), isNull(files.deletedAt)))
      .orderBy(desc(files.createdAt));
    return {
      folders: folders.map(({ f, fileCount }) => ({
        id: f.id,
        name: f.name,
        kind: f.kind as FolderItem['kind'],
        visibility: f.visibility as FolderItem['visibility'],
        fileCount,
        updatedAt: f.updatedAt.toISOString(),
      })) satisfies FolderItem[],
      files: rows.map(({ file, uploaderName, uploaderAvatar }) => toFileItem(file, uploaderName, uploaderAvatar)),
      paths: new Map(rows.map(({ file }) => [file.id, file.storagePath])),
    };
  });
  return { folders: result.folders, files: await withThumbnails(result.files, result.paths) };
}

export function toFileItem(file: typeof files.$inferSelect, uploaderName: string | null, uploaderAvatar: string | null): FileItem {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    kind: file.kind as FileItem['kind'],
    visibility: file.visibility as FileItem['visibility'],
    folderId: file.folderId,
    uploaderName,
    uploaderAvatar,
    uploaderSide: file.uploaderSide as FileItem['uploaderSide'],
    uploadedBy: file.uploadedBy,
    createdAt: file.createdAt.toISOString(),
  };
}

export async function listRecentFiles(clientId: string, limit = 6): Promise<FileItem[]> {
  const rows = await withRls(async (tx) => {
    return tx
      .select({ file: files, uploaderName: profiles.fullName, uploaderAvatar: profiles.avatarPath })
      .from(files)
      .leftJoin(profiles, eq(profiles.id, files.uploadedBy))
      .where(and(eq(files.clientId, clientId), eq(files.source, 'library'), isNull(files.deletedAt)))
      .orderBy(desc(files.createdAt))
      .limit(limit);
  });
  return withThumbnails(
    rows.map(({ file, uploaderName, uploaderAvatar }) => toFileItem(file, uploaderName, uploaderAvatar)),
    new Map(rows.map(({ file }) => [file.id, file.storagePath])),
  );
}

export async function listUploadFolders(clientId: string) {
  return withRls((tx) =>
    tx
      .select({ id: fileFolders.id, name: fileFolders.name, visibility: fileFolders.visibility })
      .from(fileFolders)
      .where(eq(fileFolders.clientId, clientId))
      .orderBy(asc(fileFolders.name)),
  );
}
