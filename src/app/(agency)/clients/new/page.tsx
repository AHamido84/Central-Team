import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { ClientForm } from '@/modules/clients/components/client-form';
import { listAgencyPeople } from '@/modules/clients/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('clients');
  return { title: t('new') };
}

export default async function NewClientPage() {
  const ctx = await requireAgency('clients:create');
  const t = await getTranslations('clients');
  const people = await listAgencyPeople(ctx);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('new')} description={t('newDescription')} />
      <ClientForm
        mode="agency-create"
        people={people.map((p) => ({ id: p.id, name: p.name, avatarPath: p.avatar_path, jobTitle: p.job_title }))}
        defaults={{
          nameAr: '',
          nameEn: '',
          industry: '',
          city: 'riyadh',
          website: '',
          social: {},
          logoPath: null,
          status: 'onboarding',
          accountManagerId: '',
          startDate: new Date().toISOString().slice(0, 10),
          notes: '',
          teamIds: [],
        }}
      />
    </div>
  );
}
