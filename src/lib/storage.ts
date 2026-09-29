/** Storage conventions (ADR-020). Buckets: `client-files` (private) and `public-assets` (public, images only). */
export const CLIENT_FILES_BUCKET = 'client-files';
export const PUBLIC_ASSETS_BUCKET = 'public-assets';

export function publicAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PUBLIC_ASSETS_BUCKET}/${path}`;
}

export function slugifyFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext =
    dot > 0
      ? name
          .slice(dot + 1)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
      : '';
  const safe =
    base
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .toLowerCase()
      .slice(0, 60) || 'file';
  return ext ? `${safe}.${ext}` : safe;
}

export const storagePaths = {
  avatar: (userId: string, id: string, ext: string) => `avatars/${userId}/${id}.${ext}`,
  orgLogo: (orgId: string, id: string, ext: string) => `org/${orgId}/logo/${id}.${ext}`,
  clientLogo: (orgId: string, clientId: string, id: string, ext: string) => `org/${orgId}/clients/${clientId}/logo/${id}.${ext}`,
  /** org/<org>/clients/<client>/<folder|root>/<fileId>-<slug> */
  clientFile: (orgId: string, clientId: string, folderId: string | null, fileId: string, name: string) =>
    `org/${orgId}/clients/${clientId}/${folderId ?? 'root'}/${fileId}-${slugifyFileName(name)}`,
  /** org/<org>/clients/<client>/threads/<thread>/<fileId>-<slug> */
  attachment: (orgId: string, clientId: string, threadId: string, fileId: string, name: string) =>
    `org/${orgId}/clients/${clientId}/threads/${threadId}/${fileId}-${slugifyFileName(name)}`,
  /** org/<org>/clients/<client>/requests/<fileId>-<slug> — attached while filling in a request, linked on submit. */
  requestAttachment: (orgId: string, clientId: string, fileId: string, name: string) =>
    `org/${orgId}/clients/${clientId}/requests/${fileId}-${slugifyFileName(name)}`,
  /** org/<org>/clients/<client>/deliverables/<deliverable>/<fileId>-<slug> (+ `<fileId>-thumb.webp` preview). */
  deliverableFile: (orgId: string, clientId: string, deliverableId: string, fileId: string, name: string) =>
    `org/${orgId}/clients/${clientId}/deliverables/${deliverableId}/${fileId}-${slugifyFileName(name)}`,
  deliverableThumb: (orgId: string, clientId: string, deliverableId: string, fileId: string) =>
    `org/${orgId}/clients/${clientId}/deliverables/${deliverableId}/${fileId}-thumb.webp`,
};

export type FileKind = 'image' | 'video' | 'pdf' | 'document' | 'archive' | 'other';

const MB = 1024 * 1024;

/** Allowed upload types and per-type size limits (bytes). */
export const uploadRules: { kind: FileKind; mime: RegExp; maxBytes: number }[] = [
  { kind: 'image', mime: /^image\/(png|jpeg|webp|gif|heic|heif|avif)$/, maxBytes: 25 * MB },
  { kind: 'video', mime: /^video\/(mp4|quicktime|webm)$/, maxBytes: 200 * MB },
  { kind: 'pdf', mime: /^application\/pdf$/, maxBytes: 50 * MB },
  {
    kind: 'document',
    mime: /^(application\/(msword|vnd\.openxmlformats-officedocument\.[\w.]+|vnd\.ms-(excel|powerpoint)|vnd\.oasis\.opendocument\.[\w.]+)|text\/(plain|csv))$/,
    maxBytes: 50 * MB,
  },
  { kind: 'archive', mime: /^application\/(zip|x-zip-compressed)$/, maxBytes: 200 * MB },
  {
    kind: 'other',
    mime: /^(application\/postscript|application\/illustrator|image\/vnd\.adobe\.photoshop|application\/x-photoshop|font\/(ttf|otf|woff2?))$/,
    maxBytes: 200 * MB,
  },
];

export function classifyUpload(
  mime: string,
  size: number,
): { ok: true; kind: FileKind } | { ok: false; code: 'file_type_not_allowed' | 'file_too_large'; maxBytes?: number } {
  const rule = uploadRules.find((r) => r.mime.test(mime));
  if (!rule) return { ok: false, code: 'file_type_not_allowed' };
  if (size > rule.maxBytes) return { ok: false, code: 'file_too_large', maxBytes: rule.maxBytes };
  return { ok: true, kind: rule.kind };
}

export const acceptAttribute =
  'image/*,video/mp4,video/quicktime,video/webm,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.txt,.csv,.zip,.ai,.eps,.psd,.ttf,.otf,.woff,.woff2';
