'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { TrashType } from '@/modules/data/constants';
import { DeleteDialog } from '@/modules/data/components/delete-dialog';

/** A header "Delete" button for detail pages; goes to `redirectTo` once the item is in the Trash. */
export function DeleteButton({
  type,
  id,
  redirectTo,
  people,
  iconOnly,
  testId = 'delete-button',
}: {
  type: TrashType;
  id: string;
  redirectTo?: string;
  people?: { id: string; name: string }[];
  iconOnly?: boolean;
  testId?: string;
}) {
  const t = useTranslations('data.actions');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={iconOnly ? 'ghost' : 'outline'}
        size={iconOnly ? 'icon-sm' : 'md'}
        className="text-danger"
        aria-label={iconOnly ? t('delete') : undefined}
        onClick={() => setOpen(true)}
        data-testid={testId}
      >
        <Trash2 aria-hidden />
        {iconOnly ? null : t('delete')}
      </Button>
      <DeleteDialog
        type={type}
        id={id}
        open={open}
        onOpenChange={setOpen}
        people={people}
        onDeleted={() => redirectTo && router.push(redirectTo)}
      />
    </>
  );
}
