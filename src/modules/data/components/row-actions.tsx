'use client';

import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import type { TrashType } from '@/modules/data/constants';
import { DeleteDialog } from '@/modules/data/components/delete-dialog';

/**
 * The row / header actions menu used across lists and detail pages: Edit, extra items, and Delete (which opens the
 * shared delete dialog). Pass only what the viewer may do; nothing renders when there's nothing to offer.
 */
export function RowActions({
  label,
  onEdit,
  del,
  extra,
  people,
  onDeleted,
  testId = 'row-actions',
}: {
  /** Accessible name, e.g. the item's title. */
  label: string;
  onEdit?: () => void;
  del?: { type: TrashType; id: string };
  extra?: ReactNode;
  people?: { id: string; name: string }[];
  onDeleted?: () => void;
  testId?: string;
}) {
  const t = useTranslations('data.actions');
  const [deleting, setDeleting] = useState(false);
  if (!onEdit && !del && !extra) return null;
  // The menu and the dialog are portaled, but React events still bubble through the component tree — stop them here so
  // clicks and keys inside never reach a clickable row or card around the actions.
  return (
    <span className="contents" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('menu', { name: label })}
            data-testid={testId}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {onEdit ? (
            <DropdownMenuItem onSelect={onEdit} data-testid="action-edit">
              <Pencil aria-hidden />
              {t('edit')}
            </DropdownMenuItem>
          ) : null}
          {extra}
          {del ? (
            <>
              {onEdit || extra ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem onSelect={() => setDeleting(true)} className="text-danger focus:text-danger" data-testid="action-delete">
                <Trash2 aria-hidden />
                {t('delete')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {del ? (
        <DeleteDialog type={del.type} id={del.id} open={deleting} onOpenChange={setDeleting} people={people} onDeleted={onDeleted} />
      ) : null}
    </span>
  );
}
