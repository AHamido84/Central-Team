'use client';

import {
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Folder,
  FolderInput,
  FolderLock,
  FolderPlus,
  Grid2x2,
  List,
  Loader2,
  MoreHorizontal,
  Search,
  Trash2,
  Upload,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, type DragEvent } from 'react';

import { EmptyState, FileTypeIcon } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { Avatar, Badge, Card, NativeSelect, Progress } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { acceptAttribute, publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { FilePreviewDialog, downloadFile } from '@/modules/files/components/file-preview';
import { useUpload } from '@/modules/files/components/use-upload';
import { createFolderAction, deleteFileAction, updateFileAction } from '@/modules/files/server/actions';
import type { FileItem, FolderItem } from '@/modules/files/server/queries';

const kindFilters = ['all', 'image', 'video', 'pdf', 'document'] as const;

function NewFolderDialog({ clientId, open, onOpenChange }: { clientId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'month' | 'project' | 'type' | 'brand' | 'custom'>('project');
  const [visibility, setVisibility] = useState<'client' | 'internal'>('client');
  const create = useAction(createFolderAction, { successMessage: t('files.folderCreated') });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await create.run({ clientId, name, kind, visibility });
            if (res.ok) {
              setName('');
              onOpenChange(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('files.newFolder')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <Field label={t('common.name')} required>
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
            </Field>
            <Field label={t('files.folderKind')}>
              {(p) => (
                <NativeSelect {...p} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  {(['month', 'project', 'type', 'brand', 'custom'] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`files.kinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field label={t('files.visibility')} hint={t('files.visibilityHint')}>
              {(p) => (
                <NativeSelect {...p} value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
                  <option value="client">{t('common.visibleToClient')}</option>
                  <option value="internal">{t('common.internal')}</option>
                </NativeSelect>
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={create.pending} disabled={!name.trim()}>
              {t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Files library shared by the agency client page and the portal. `side` controls management actions;
 * RLS has already removed internal items for client users before data reaches this component.
 */
export function FileBrowser({
  clientId,
  folders,
  files,
  side,
  canUpload,
  canManage,
}: {
  clientId: string;
  folders: FolderItem[];
  files: FileItem[];
  side: 'agency' | 'client';
  canUpload: boolean;
  canManage: boolean;
}) {
  const t = useTranslations();
  const f = useFormat();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const folderId = params.get('folder');
  const activeFolder = folders.find((x) => x.id === folderId) ?? null;
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<(typeof kindFilters)[number]>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [deleting, setDeleting] = useState<FileItem | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const uploads = useUpload(() => router.refresh());
  const update = useAction(updateFileAction, { successMessage: t('common.saved') });
  const remove = useAction(deleteFileAction, { successMessage: t('files.deleted') });

  const setFolder = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('folder', id);
    else next.delete('folder');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const visible = useMemo(
    () =>
      files.filter(
        (file) =>
          (folderId ? file.folderId === folderId : true) &&
          (kind === 'all' || file.kind === kind || (kind === 'document' && ['document', 'archive', 'other'].includes(file.kind))) &&
          (!query || file.name.toLowerCase().includes(query.toLowerCase())),
      ),
    [files, folderId, kind, query],
  );

  // Client uploads land in the open folder, or the brand-assets folder by default.
  const uploadFolder = activeFolder ?? folders.find((x) => x.kind === 'brand' && x.visibility === 'client') ?? null;
  const uploadVisibility: 'internal' | 'client' = side === 'client' ? 'client' : (activeFolder?.visibility ?? 'client');
  const startUpload = (list: FileList | null) => {
    if (!list?.length || !canUpload) return;
    void uploads.upload(list, { clientId, folderId: uploadFolder?.id ?? null, threadId: null, visibility: uploadVisibility });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    startUpload(e.dataTransfer.files);
  };

  const FileMenu = ({ file }: { file: FileItem }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('common.moreActions')} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => setPreview(file)}>
          <Eye />
          {t('files.preview')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void downloadFile(file.id)}>
          <Download />
          {t('common.download')}
        </DropdownMenuItem>
        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => void update.run({ fileId: file.id, visibility: file.visibility === 'client' ? 'internal' : 'client' })}
            >
              {file.visibility === 'client' ? <EyeOff /> : <Eye />}
              {file.visibility === 'client' ? t('files.makeInternal') : t('files.shareWithClient')}
            </DropdownMenuItem>
            <DropdownMenuLabel>{t('files.moveTo')}</DropdownMenuLabel>
            {folders
              .filter((x) => x.id !== file.folderId)
              .map((x) => (
                <DropdownMenuItem key={x.id} onSelect={() => void update.run({ fileId: file.id, folderId: x.id })}>
                  <FolderInput />
                  <span className="truncate">{x.name}</span>
                </DropdownMenuItem>
              ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => setDeleting(file)}>
              <Trash2 />
              {t('common.delete')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div
      className="relative space-y-5"
      onDragOver={(e) => {
        if (!canUpload) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={onDrop}
      data-testid="file-browser"
    >
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary-soft/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-primary-soft-foreground">
            <UploadCloud className="size-10" aria-hidden />
            <p className="font-medium">{t('files.dropHere', { folder: uploadFolder?.name ?? t('files.allFiles') })}</p>
          </div>
        </div>
      ) : null}

      {/* Folders */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[0.9375rem] font-semibold">{t('files.folders')}</h2>
          {side === 'agency' && canUpload ? (
            <Button variant="ghost" size="sm" onClick={() => setNewFolder(true)}>
              <FolderPlus />
              {t('files.newFolder')}
            </Button>
          ) : null}
        </div>
        <div className="-mx-(--gutter) flex gap-3 overflow-x-auto px-(--gutter) pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => setFolder(null)}
            className={cn(
              'flex min-w-44 items-center gap-3 rounded-lg border p-3 text-start transition-colors',
              !folderId ? 'border-primary bg-primary-soft/50' : 'border-border bg-surface hover:bg-surface-muted',
            )}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground">
              <Grid2x2 className="size-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{t('files.allFiles')}</span>
              <span className="block text-xs text-subtle-foreground">{t('files.fileCount', { count: files.length })}</span>
            </span>
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => setFolder(folder.id)}
              className={cn(
                'flex min-w-44 items-center gap-3 rounded-lg border p-3 text-start transition-colors',
                folderId === folder.id ? 'border-primary bg-primary-soft/50' : 'border-border bg-surface hover:bg-surface-muted',
              )}
              data-testid="folder-card"
            >
              <span
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-md',
                  folder.visibility === 'internal' ? 'bg-warning-soft text-warning' : 'bg-accent text-accent-foreground',
                )}
              >
                {folder.visibility === 'internal' ? (
                  <FolderLock className="size-5" aria-hidden />
                ) : (
                  <Folder className="size-5" aria-hidden />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{folder.name}</span>
                <span className="flex items-center gap-1.5 text-xs text-subtle-foreground">
                  {t('files.fileCount', { count: folder.fileCount })}
                  {folder.visibility === 'internal' ? <Badge tone="warning">{t('common.internal')}</Badge> : null}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('files.searchPlaceholder')}
            className="ps-9"
            aria-label={t('common.search')}
          />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {kindFilters.map((k) => (
            <Button key={k} variant={kind === k ? 'soft' : 'ghost'} size="sm" onClick={() => setKind(k)}>
              {t(`files.filters.${k}`)}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1 sm:ms-auto">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
            aria-label={view === 'grid' ? t('files.listView') : t('files.gridView')}
          >
            {view === 'grid' ? <List /> : <Grid2x2 />}
          </Button>
          {canUpload ? (
            <>
              <input
                ref={input}
                type="file"
                multiple
                accept={acceptAttribute}
                className="sr-only"
                onChange={(e) => startUpload(e.target.files)}
                data-testid="file-upload-input"
              />
              <Button onClick={() => input.current?.click()} data-testid="file-upload">
                <Upload />
                {t('files.upload')}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {canUpload && side === 'client' ? (
        <p className="-mt-2 text-xs text-subtle-foreground">
          {t('files.clientUploadHint', { folder: uploadFolder?.name ?? t('files.allFiles') })}
        </p>
      ) : null}

      {/* Upload progress */}
      {uploads.items.length > 0 ? (
        <Card className="divide-y divide-border" aria-live="polite">
          {uploads.items.map((u) => (
            <div key={u.key} className="flex items-center gap-3 px-4 py-2.5" data-testid="upload-item" data-status={u.status}>
              {u.status === 'uploading' ? (
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
              ) : u.status === 'done' ? (
                <CheckCircle2 className="size-4 text-success" aria-hidden />
              ) : (
                <XCircle className="size-4 text-danger" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">
                  <bdi>{u.name}</bdi>
                </p>
                {u.status === 'error' ? (
                  <p className="text-xs text-danger">{u.error}</p>
                ) : (
                  <Progress value={Math.round(u.progress * 100)} tone={u.status === 'done' ? 'success' : 'brand'} className="mt-1 h-1.5" />
                )}
              </div>
              <span className="tabular text-xs text-subtle-foreground">
                {u.status === 'uploading' ? f.percent(u.progress) : f.bytes(u.size)}
              </span>
              {u.status !== 'uploading' ? (
                <Button variant="ghost" size="icon-sm" onClick={() => uploads.remove(u.key)} aria-label={t('common.remove')}>
                  <X />
                </Button>
              ) : null}
            </div>
          ))}
        </Card>
      ) : null}

      {/* Files */}
      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={UploadCloud}
            title={query || kind !== 'all' ? t('common.noResults') : t('files.emptyTitle')}
            description={
              query || kind !== 'all' ? t('common.noResultsHint') : canUpload ? t('files.emptyUpload') : t('files.emptyReadOnly')
            }
            action={
              canUpload && !query ? (
                <Button onClick={() => input.current?.click()}>
                  <Upload />
                  {t('files.upload')}
                </Button>
              ) : null
            }
          />
        </Card>
      ) : view === 'grid' ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((file) => (
            <li key={file.id}>
              <Card className="group overflow-hidden transition-shadow hover:shadow-md" data-testid="file-card">
                <button
                  type="button"
                  onClick={() => setPreview(file)}
                  className="block w-full text-start"
                  aria-label={`${t('files.preview')}: ${file.name}`}
                >
                  <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-surface-muted">
                    {file.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL
                      <img
                        src={file.thumbUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover transition-transform duration-(--duration-slow) group-hover:scale-[1.03]"
                      />
                    ) : (
                      <FileTypeIcon kind={file.kind} className="size-14" />
                    )}
                    {file.visibility === 'internal' ? (
                      <Badge tone="warning" className="absolute start-2 top-2">
                        <EyeOff />
                        {t('common.internal')}
                      </Badge>
                    ) : null}
                    {file.uploaderSide === 'client' && side === 'agency' ? (
                      <Badge tone="info" className="absolute end-2 top-2">
                        {t('files.fromClient')}
                      </Badge>
                    ) : null}
                  </div>
                </button>
                <div className="flex items-start gap-2 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={file.name}>
                      <bdi>{file.name}</bdi>
                    </p>
                    <p className="truncate text-xs text-subtle-foreground">
                      {f.bytes(file.sizeBytes)} · {f.relative(file.createdAt)}
                    </p>
                  </div>
                  <FileMenu file={file} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <Card className="divide-y divide-border">
          {visible.map((file) => (
            <div key={file.id} className="flex items-center gap-3 px-4 py-3" data-testid="file-card">
              <FileTypeIcon kind={file.kind} />
              <button type="button" onClick={() => setPreview(file)} className="min-w-0 flex-1 text-start">
                <p className="truncate text-sm font-medium">
                  <bdi>{file.name}</bdi>
                </p>
                <p className="truncate text-xs text-subtle-foreground">
                  {f.bytes(file.sizeBytes)} · {f.dateTime(file.createdAt)}
                </p>
              </button>
              <span className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
                {file.uploaderName ? <Avatar name={file.uploaderName} src={publicAssetUrl(file.uploaderAvatar)} size="xs" /> : null}
                {file.uploaderName}
              </span>
              {file.visibility === 'internal' ? <Badge tone="warning">{t('common.internal')}</Badge> : null}
              <FileMenu file={file} />
            </div>
          ))}
        </Card>
      )}

      <FilePreviewDialog file={preview} onOpenChange={(o) => !o && setPreview(null)} />
      {side === 'agency' ? <NewFolderDialog clientId={clientId} open={newFolder} onOpenChange={setNewFolder} /> : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('files.deleteTitle')}
        description={t('files.deleteBody', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={async () => {
          if (deleting) await remove.run({ fileId: deleting.id });
          setDeleting(null);
        }}
      />
    </div>
  );
}
