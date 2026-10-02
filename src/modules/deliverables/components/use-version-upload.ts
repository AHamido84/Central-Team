'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { Upload } from 'tus-js-client';

import { uploadRules } from '@/lib/storage';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { deliverableMaxBytes, TUS_CHUNK_SIZE } from '@/modules/deliverables/constants';
import { finalizeVersionFileAction, requestVersionUploadAction } from '@/modules/deliverables/server/actions';

export type VersionUploadItem = {
  key: string;
  name: string;
  size: number;
  progress: number;
  status: 'preparing' | 'uploading' | 'finishing' | 'done' | 'error';
  error?: string;
  resumed?: boolean;
};

type Meta = { width: number | null; height: number | null; durationSeconds: number | null; thumbnail: Blob | null };
type Ticket = { fileId: string; path: string; token: string; thumb: { path: string; token: string } | null; expiresAt: number };

const BUCKET = 'client-files';
const THUMB_MAX = 640;

/** Browser-side preview: a downscaled WebP for images, the frame at ~1s for videos (poster). Never blocks the upload. */
async function readMeta(file: File): Promise<Meta> {
  const empty: Meta = { width: null, height: null, durationSeconds: null, thumbnail: null };
  const toBlob = (source: CanvasImageSource, w: number, h: number) => {
    const scale = Math.min(1, THUMB_MAX / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/webp', 0.82));
  };
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith('image/')) {
      const img = new Image();
      img.src = url;
      await img.decode();
      return {
        width: img.naturalWidth,
        height: img.naturalHeight,
        durationSeconds: null,
        thumbnail: await toBlob(img, img.naturalWidth, img.naturalHeight),
      };
    }
    if (file.type.startsWith('video/')) {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('video'));
      });
      const duration = Number.isFinite(video.duration) ? video.duration : null;
      video.currentTime = Math.min(1, (duration ?? 2) / 2);
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        setTimeout(resolve, 3000);
      });
      const thumbnail = video.videoWidth ? await toBlob(video, video.videoWidth, video.videoHeight) : null;
      return { width: video.videoWidth || null, height: video.videoHeight || null, durationSeconds: duration, thumbnail };
    }
    return empty;
  } catch {
    return empty;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const ticketKey = (versionId: string, file: File) => `deliverable-upload:${versionId}:${file.name}:${file.size}:${file.lastModified}`;
function loadTicket(key: string): Ticket | null {
  try {
    const raw = localStorage.getItem(key);
    const t = raw ? (JSON.parse(raw) as Ticket) : null;
    return t && t.expiresAt > Date.now() ? t : null;
  } catch {
    return null;
  }
}
function saveTicket(key: string, t: Ticket | null) {
  try {
    if (t) localStorage.setItem(key, JSON.stringify(t));
    else localStorage.removeItem(key);
  } catch {
    // Resuming after a reload is a convenience; uploads still work without storage.
  }
}

/**
 * Deliverable uploads: resumable TUS uploads (6 MB chunks) straight to Storage using a server-signed token for a
 * server-chosen path, with progress, automatic retries, and resume after a dropped connection or a page reload
 * (re-pick the same file). A preview image is uploaded next to each image/video, then the server records the file.
 */
export function useVersionUpload(versionId: string | null, onDone?: () => void) {
  const t = useTranslations('errors');
  const [items, setItems] = useState<VersionUploadItem[]>([]);
  const patch = (key: string, p: Partial<VersionUploadItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const uploadOne = useCallback(
    async (file: File) => {
      if (!versionId) return;
      const key = crypto.randomUUID();
      setItems((list) => [...list, { key, name: file.name, size: file.size, progress: 0, status: 'preparing' }]);
      const mimeType = file.type || 'application/octet-stream';
      const rule = uploadRules.find((r) => r.mime.test(mimeType));
      if (!rule) return patch(key, { status: 'error', error: t('file_type_not_allowed') });
      if (file.size > deliverableMaxBytes[rule.kind]) return patch(key, { status: 'error', error: t('file_too_large') });

      const meta = await readMeta(file);
      const stored = ticketKey(versionId, file);
      let ticket = loadTicket(stored);
      const resumed = Boolean(ticket);
      if (!ticket) {
        const res = await requestVersionUploadAction({
          versionId,
          name: file.name,
          mimeType,
          size: file.size,
          withThumbnail: Boolean(meta.thumbnail),
        });
        if (!res.ok) return patch(key, { status: 'error', error: t(res.error.code) });
        // Signed upload tokens live two hours; keep a margin.
        ticket = { ...res.data, expiresAt: Date.now() + 100 * 60 * 1000 };
        saveTicket(stored, ticket);
      }
      patch(key, { status: 'uploading', resumed });

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const apikey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
      const current = ticket;
      try {
        await new Promise<void>((resolve, reject) => {
          const upload = new Upload(file, {
            endpoint: `${supabaseUrl}/storage/v1/upload/resumable/sign`,
            retryDelays: [0, 1000, 3000, 5000, 10000],
            headers: { 'x-signature': current.token, apikey },
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            chunkSize: TUS_CHUNK_SIZE,
            metadata: { bucketName: BUCKET, objectName: current.path, contentType: mimeType, cacheControl: '3600' },
            onProgress: (sent, total) => patch(key, { progress: total ? sent / total : 0 }),
            onSuccess: () => resolve(),
            onError: (e) => reject(e),
          });
          void upload.findPreviousUploads().then((previous) => {
            if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
            upload.start();
          });
        });
        if (current.thumb && meta.thumbnail) {
          await getSupabaseBrowserClient()
            .storage.from(BUCKET)
            .uploadToSignedUrl(current.thumb.path, current.thumb.token, meta.thumbnail, { contentType: 'image/webp' });
        }
      } catch {
        return patch(key, { status: 'error', error: t('upload_failed') });
      }
      patch(key, { status: 'finishing', progress: 1 });
      const fin = await finalizeVersionFileAction({
        versionId,
        fileId: current.fileId,
        name: file.name,
        mimeType,
        size: file.size,
        withThumbnail: Boolean(current.thumb && meta.thumbnail),
        width: meta.width,
        height: meta.height,
        durationSeconds: meta.durationSeconds,
      });
      saveTicket(stored, null);
      if (!fin.ok) return patch(key, { status: 'error', error: t(fin.error.code) });
      patch(key, { status: 'done' });
    },
    [t, versionId],
  );

  const upload = useCallback(
    async (files: FileList | File[]) => {
      await Promise.all(Array.from(files).map((f) => uploadOne(f)));
      onDone?.();
    },
    [onDone, uploadOne],
  );

  const clear = () => setItems((list) => list.filter((i) => i.status !== 'done'));
  return { items, upload, clear, busy: items.some((i) => ['preparing', 'uploading', 'finishing'].includes(i.status)) };
}
