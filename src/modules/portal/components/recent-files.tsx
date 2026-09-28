'use client';

import { FolderOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState, FileTypeIcon } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Card } from '@/components/ui/primitives';
import { FilePreviewDialog } from '@/modules/files/components/file-preview';
import type { FileItem } from '@/modules/files/server/queries';

export function RecentFilesGrid({ files }: { files: FileItem[] }) {
  const t = useTranslations('files');
  const f = useFormat();
  const [preview, setPreview] = useState<FileItem | null>(null);
  if (files.length === 0) {
    return (
      <Card>
        <EmptyState compact icon={FolderOpen} title={t('noRecentFiles')} description={t('emptyReadOnly')} />
      </Card>
    );
  }
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {files.map((file) => (
          <li key={file.id}>
            <button type="button" onClick={() => setPreview(file)} className="group block w-full text-start" data-testid="recent-file">
              <Card className="overflow-hidden transition-shadow group-hover:shadow-md">
                <div className="flex aspect-square items-center justify-center overflow-hidden bg-surface-muted">
                  {file.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
                    <img
                      src={file.thumbUrl}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-(--duration-slow) group-hover:scale-[1.03]"
                    />
                  ) : (
                    <FileTypeIcon kind={file.kind} className="size-12" />
                  )}
                </div>
                <div className="p-2.5">
                  <p className="truncate text-xs font-medium">
                    <bdi>{file.name}</bdi>
                  </p>
                  <p className="text-[0.6875rem] text-subtle-foreground">{f.relative(file.createdAt)}</p>
                </div>
              </Card>
            </button>
          </li>
        ))}
      </ul>
      <FilePreviewDialog file={preview} onOpenChange={(o) => !o && setPreview(null)} />
    </>
  );
}
