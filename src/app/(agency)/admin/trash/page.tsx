import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgencyAny } from '@/lib/auth/context';
import { deletePermission, trashTypes } from '@/modules/data/constants';
import { TrashList } from '@/modules/data/components/trash-list';
import { listTrash } from '@/modules/data/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('trash') };
}

export default async function TrashPage() {
  const ctx = await requireAgencyAny([...new Set(trashTypes.map(deletePermission))]);
  const t = await getTranslations('data.trash');
  const items = await listTrash();
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <TrashList items={items} permissions={[...ctx.permissions]} />
    </>
  );
}
