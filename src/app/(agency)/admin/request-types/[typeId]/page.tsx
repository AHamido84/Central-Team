import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { requireAgency } from '@/lib/auth/context';
import { localized, type Locale } from '@/lib/i18n/localized';
import { TypeBuilder } from '@/modules/requests/components/type-builder';
import { getRequestType } from '@/modules/requests/server/queries';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata({ params }: { params: Promise<{ typeId: string }> }): Promise<Metadata> {
  const { typeId } = await params;
  const type = isUuid(typeId) ? await getRequestType(typeId) : null;
  return { title: type ? localized(type.name, (await getLocale()) as Locale) : undefined };
}

export default async function RequestTypeBuilderPage({ params }: { params: Promise<{ typeId: string }> }) {
  const { typeId } = await params;
  if (!isUuid(typeId)) notFound();
  const ctx = await requireAgency('request_types:manage');
  if (!ctx.flags['module.requests']) notFound();
  const type = await getRequestType(typeId);
  if (!type) notFound();
  const t = await getTranslations('requests.builder');
  const name = localized(type.name, (await getLocale()) as Locale);
  return (
    <>
      <BreadcrumbLabel segment={typeId} label={name} />
      <PageHeader title={name} description={t('description')} />
      {/* Remount after a save so the editor starts from the stored version. */}
      <TypeBuilder key={type.schemaVersion} type={type} />
    </>
  );
}
