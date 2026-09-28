'use client';

import { Download, ExternalLink, FileWarning, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { FileTypeIcon } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/overlays';
import { getFileUrlAction } from '@/modules/files/server/actions';
import type { FileItem } from '@/modules/files/server/queries';

export async function downloadFile(fileId: string) {
  const res = await getFileUrlAction({ fileId, download: true });
  if (res.ok) window.location.assign(res.data.url);
  return res.ok;
}

/** Image / PDF / video preview through a short-lived signed URL. */
export function FilePreviewDialog({ file, onOpenChange }: { file: FileItem | null; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations();
  const f = useFormat();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (!file) return;
    let cancelled = false;
    void getFileUrlAction({ fileId: file.id, download: false }).then((res) => {
      if (cancelled) return;
      if (res.ok) setUrl(res.data.url);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  const previewable = file && ['image', 'pdf', 'video'].includes(file.kind);
  return (
    <Dialog open={Boolean(file)} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} size="xl" className="sm:max-h-[92dvh]" data-testid="file-preview">
        {file ? (
          <>
            <div className="flex items-center gap-3 border-b border-border p-4 pe-12">
              <FileTypeIcon kind={file.kind} className="size-9" />
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-[0.9375rem]">
                  <bdi>{file.name}</bdi>
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {f.bytes(file.sizeBytes)} · {f.dateTime(file.createdAt)}
                  {file.uploaderName ? ` · ${file.uploaderName}` : ''}
                </DialogDescription>
              </div>
              {url ? (
                <Button asChild variant="ghost" size="icon-sm" aria-label={t('common.open')}>
                  <a href={url} target="_blank" rel="noreferrer noopener">
                    <ExternalLink />
                  </a>
                </Button>
              ) : null}
              <Button size="sm" onClick={() => void downloadFile(file.id)} data-testid="file-download">
                <Download />
                {t('common.download')}
              </Button>
            </div>
            <div className="flex min-h-[50dvh] flex-1 items-center justify-center overflow-auto bg-surface-muted p-4">
              {failed ? (
                <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                  <FileWarning className="size-8" aria-hidden />
                  {t('files.previewFailed')}
                </div>
              ) : !url ? (
                <Loader2 className="size-6 animate-spin text-subtle-foreground" aria-label={t('common.loading')} />
              ) : !previewable ? (
                <div className="flex flex-col items-center gap-3 text-center">
                  <FileTypeIcon kind={file.kind} className="size-16" />
                  <p className="text-sm text-muted-foreground">{t('files.noPreview')}</p>
                  <Button onClick={() => void downloadFile(file.id)}>
                    <Download />
                    {t('common.download')}
                  </Button>
                </div>
              ) : file.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived Storage URL
                <img src={url} alt={file.name} className="max-h-[75dvh] max-w-full rounded-md object-contain shadow-md" />
              ) : file.kind === 'video' ? (
                <video src={url} controls playsInline className="max-h-[75dvh] max-w-full rounded-md shadow-md">
                  <track kind="captions" />
                </video>
              ) : (
                <iframe src={url} title={file.name} className="h-[75dvh] w-full rounded-md bg-white" />
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
