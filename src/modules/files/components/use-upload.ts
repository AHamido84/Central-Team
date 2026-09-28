'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { classifyUpload } from '@/lib/storage';
import { finalizeFileUploadAction, requestFileUploadAction } from '@/modules/files/server/actions';

export type UploadItem = {
  key: string;
  name: string;
  size: number;
  mimeType: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
  fileId?: string;
};

type Target = { clientId: string; folderId: string | null; threadId: string | null; visibility: 'internal' | 'client' };

function putWithProgress(url: string, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(String(xhr.status))));
    xhr.onerror = () => reject(new Error('network'));
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', file);
    xhr.send(form);
  });
}

/**
 * Direct-to-Storage uploads with per-file progress: request signed URL → PUT (XHR for progress) → finalize.
 * Files never pass through the Next.js server.
 */
export function useUpload(onComplete?: (fileIds: string[]) => void) {
  const t = useTranslations('errors');
  const [items, setItems] = useState<UploadItem[]>([]);
  const patch = (key: string, p: Partial<UploadItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const upload = useCallback(
    async (fileList: FileList | File[], target: Target) => {
      const filesArr = Array.from(fileList);
      const fresh = filesArr.map((f) => ({ key: crypto.randomUUID(), name: f.name, size: f.size, mimeType: f.type || 'application/octet-stream', progress: 0, status: 'uploading' as const }));
      setItems((list) => [...list, ...fresh]);
      const done: string[] = [];
      await Promise.all(
        filesArr.map(async (file, idx) => {
          const key = fresh[idx]!.key;
          const mimeType = file.type || 'application/octet-stream';
          const pre = classifyUpload(mimeType, file.size);
          if (!pre.ok) {
            patch(key, { status: 'error', error: t(pre.code) });
            return;
          }
          const payload = { ...target, name: file.name, mimeType, size: file.size };
          const req = await requestFileUploadAction(payload);
          if (!req.ok) {
            patch(key, { status: 'error', error: t(req.error.code) });
            return;
          }
          try {
            await putWithProgress(req.data.signedUrl, file, (p) => patch(key, { progress: p }));
          } catch {
            patch(key, { status: 'error', error: t('upload_failed') });
            return;
          }
          const fin = await finalizeFileUploadAction({ ...payload, fileId: req.data.fileId });
          if (!fin.ok) {
            patch(key, { status: 'error', error: t(fin.error.code) });
            return;
          }
          patch(key, { status: 'done', progress: 1, fileId: fin.data.fileId });
          done.push(fin.data.fileId);
        }),
      );
      const failed = filesArr.length - done.length;
      if (failed > 0) toast.error(t('upload_failed'));
      onComplete?.(done);
      return done;
    },
    [onComplete, t],
  );

  const clear = () => setItems((list) => list.filter((i) => i.status === 'uploading'));
  const reset = () => setItems([]);
  const remove = (key: string) => setItems((list) => list.filter((i) => i.key !== key));
  return { items, upload, clear, reset, remove, busy: items.some((i) => i.status === 'uploading') };
}
