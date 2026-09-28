import { CalendarDays } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { EmptyState, PageHeader } from '@/components/patterns';
import { Card } from '@/components/ui/primitives';
import { requirePortal } from '@/lib/auth/context';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('calendar') };
}

/** Designed-in route for an upcoming phase. Hidden (404) until the `module.calendar` flag is enabled. */
export default async function PortalCalendarPage() {
  const ctx = await requirePortal();
  if (!ctx.flags['module.calendar']) notFound();
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t('nav.calendar')} description={t('portal.upcoming.calendar.description')} />
      <Card>
        <EmptyState icon={CalendarDays} title={t('portal.upcoming.calendar.title')} description={t('portal.upcoming.calendar.body')} />
      </Card>
    </>
  );
}
