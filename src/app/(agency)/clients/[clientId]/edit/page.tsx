import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { localized, type Locale } from '@/lib/i18n/localized';
import { ClientForm } from '@/modules/clients/components/client-form';
import { getClientDetail, listAgencyPeople } from '@/modules/clients/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('clients');
  return { title: t('edit') };
}

export default async function EditClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(clientId)) notFound();
  const ctx = await requireAgency('clients:update');
  const t = await getTranslations('clients');
  const locale = (await getLocale()) as Locale;
  const [detail, people] = await Promise.all([getClientDetail(clientId), listAgencyPeople(ctx)]);
  if (!detail) notFound();
  const c = detail.client;
  return (
    <div className="mx-auto max-w-5xl">
      <BreadcrumbLabel segment={clientId} label={localized(c.name, locale)} />
      <PageHeader title={t('edit')} description={localized(c.name, locale)} />
      <ClientForm
        mode="agency-edit"
        clientId={clientId}
        people={people.map((p) => ({ id: p.id, name: p.name, avatarPath: p.avatar_path, jobTitle: p.job_title }))}
        defaults={{
          nameAr: c.name.ar ?? '',
          nameEn: c.name.en ?? '',
          industry: c.industry ?? '',
          city: c.city ?? '',
          website: c.website ?? '',
          social: c.social as Record<string, string>,
          logoPath: c.logoPath,
          status: c.status as 'active',
          accountManagerId: c.accountManagerId ?? '',
          startDate: c.startDate ?? '',
          notes: detail.notes,
          teamIds: detail.team.map((m) => m.userId),
        }}
      />
    </div>
  );
}
