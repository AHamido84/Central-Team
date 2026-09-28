import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { OrganizationForm } from '@/modules/organizations/components/organization-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('organization') };
}

const TIMEZONES = ['Asia/Riyadh', 'Asia/Dubai', 'Asia/Kuwait', 'Asia/Qatar', 'Asia/Bahrain', 'Africa/Cairo', 'Europe/London', 'UTC'];

export default async function OrganizationPage() {
  const ctx = await requireAgency('organization:update');
  const t = await getTranslations('admin.organization');
  const org = ctx.organization;
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <OrganizationForm
        timezones={TIMEZONES.includes(org.defaultTimezone) ? TIMEZONES : [org.defaultTimezone, ...TIMEZONES]}
        defaults={{
          nameAr: org.name.ar ?? '',
          nameEn: org.name.en ?? '',
          supportEmail: org.supportEmail ?? '',
          supportWhatsapp: org.supportWhatsapp ?? '',
          brandColor: org.brand.primaryColor ?? '#5140E0',
          logoPath: org.logoPath,
          defaultLocale: org.defaultLocale === 'en' ? 'en' : 'ar',
          defaultTimezone: org.defaultTimezone,
        }}
      />
    </>
  );
}
