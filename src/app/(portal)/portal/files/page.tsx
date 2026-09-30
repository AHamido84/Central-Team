import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requirePortal } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { FileBrowser } from '@/modules/files/components/file-browser';
import { listClientLibrary } from '@/modules/files/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('files');
  return { title: t('title') };
}

export default async function PortalFilesPage() {
  const ctx = await requirePortal();
  if (!ctx.flags['module.files']) notFound();
  const t = await getTranslations('files');
  const library = await listClientLibrary(ctx.client.id);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <FileBrowser
        clientId={ctx.client.id}
        folders={library.folders}
        files={library.files}
        side="client"
        canUpload={can(ctx.permissions, 'portal_files:upload')}
        canManage={false}
        canDelete={false}
        userId={ctx.session.userId}
      />
    </>
  );
}
