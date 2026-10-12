'use client';

import { Bookmark, BookmarkPlus, Download, FileSpreadsheet, FileText, Pin, PinOff, Presentation, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox, Label } from '@/components/ui/primitives';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
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
import { useAction } from '@/lib/actions/use-action';
import { viewSearch } from '@/modules/executive/config';
import { deleteViewAction, pinViewAction, refreshSnapshotAction, saveViewAction } from '@/modules/executive/server/actions';
import type { SavedView } from '@/modules/executive/server/queries';
import type { ExecKit } from '@/modules/executive/text';
import type { ExecutiveViewConfig } from '@/modules/executive/types';

export function ExportMenu({ kit, config }: { kit: ExecKit; config: ExecutiveViewConfig }) {
  const { t } = kit;
  const query = viewSearch(config).replace(/^\?/, '');
  const href = (format: string) => `/api/executive/export?format=${format}${query ? `&${query}` : ''}`;
  const items = [
    { format: 'pdf', icon: FileText, label: t('export.pdf') },
    { format: 'pptx', icon: Presentation, label: t('export.pptx') },
    { format: 'xlsx', icon: FileSpreadsheet, label: t('export.xlsx') },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" data-testid="executive-export">
          <Download />
          {t('controls.export')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-subtle-foreground">{t('export.scope')}</DropdownMenuLabel>
        {items.map((i) => (
          <DropdownMenuItem key={i.format} asChild>
            {/* A plain download link: the file streams from the route, the page stays as it is. */}
            <a href={href(i.format)} download data-testid={`export-${i.format}`}>
              <i.icon />
              {i.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RefreshButton({ kit }: { kit: ExecKit }) {
  const { run, pending } = useAction(refreshSnapshotAction, { successMessage: kit.t('controls.refreshed') });
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => run({})}
      disabled={pending}
      aria-label={kit.t('controls.refresh')}
      title={kit.t('controls.refresh')}
      data-testid="executive-refresh"
    >
      <RefreshCw className={pending ? 'animate-spin' : undefined} />
    </Button>
  );
}

export function ViewsMenu({ kit, config, views }: { kit: ExecKit; config: ExecutiveViewConfig; views: SavedView[] }) {
  const { t } = kit;
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [pinned, setPinned] = useState(false);
  const save = useAction(saveViewAction, { successMessage: t('views.saved'), onSuccess: () => setOpen(false) });
  const pin = useAction(pinViewAction);
  const remove = useAction(deleteViewAction, { successMessage: t('views.deleted') });
  const pinnedViews = views.filter((v) => v.pinned);

  return (
    <>
      {pinnedViews.slice(0, 3).map((v) => (
        <Button key={v.id} asChild variant="secondary" size="sm" className="max-w-40">
          <Link href={`/executive${viewSearch(v.config)}`} data-testid="pinned-view">
            <Pin />
            <span className="truncate">{v.name}</span>
          </Link>
        </Button>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" data-testid="executive-views">
            <Bookmark />
            {t('views.label')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuItem
            onSelect={() => {
              setName('');
              setPinned(false);
              setOpen(true);
            }}
            data-testid="view-save-open"
          >
            <BookmarkPlus />
            {t('views.save')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {views.length === 0 ? (
            <p className="px-2 py-2 text-xs text-subtle-foreground">{t('views.empty')}</p>
          ) : (
            views.map((v) => (
              <div key={v.id} className="flex items-center gap-1 px-1">
                <DropdownMenuItem asChild className="min-w-0 flex-1">
                  <Link href={`/executive${viewSearch(v.config)}`} data-testid="saved-view">
                    {v.pinned ? <Pin /> : <Bookmark />}
                    <span className="truncate">{v.name}</span>
                  </Link>
                </DropdownMenuItem>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t('views.togglePin')}
                  onClick={() => pin.run({ id: v.id, pinned: !v.pinned })}
                >
                  {v.pinned ? <PinOff /> : <Pin />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={t('views.delete')}
                  onClick={() => remove.run({ id: v.id })}
                >
                  <Trash2 />
                </Button>
              </div>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={tc('close')} size="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save.run({ name: name.trim(), config, pinned });
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('views.save')}</DialogTitle>
              <DialogDescription>{t('export.scope')}</DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-4">
              <div className="grid gap-1.5">
                <Label htmlFor="view-name">{t('views.name')}</Label>
                <Input
                  id="view-name"
                  value={name}
                  maxLength={80}
                  required
                  onChange={(e) => setName(e.target.value)}
                  data-testid="view-name"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={pinned} onCheckedChange={(v) => setPinned(v === true)} />
                {t('views.pin')}
              </label>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('views.cancel')}
              </Button>
              <Button type="submit" disabled={save.pending || !name.trim()} data-testid="view-save">
                {t('views.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
