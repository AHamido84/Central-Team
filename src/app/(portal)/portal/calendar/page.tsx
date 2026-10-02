import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requirePortal } from '@/lib/auth/context';
import { ContentCalendar } from '@/modules/deliverables/components/content-calendar';
import { listCalendarDeliverables } from '@/modules/deliverables/server/queries';
import { addDays, dayInZone } from '@/modules/tasks/constants';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('calendar') };
}

/** Content calendar: approved and scheduled deliverables by publishing date. */
export default async function PortalCalendarPage() {
  const ctx = await requirePortal();
  if (!ctx.flags['module.calendar']) notFound();
  const t = await getTranslations('deliverables.calendar');
  const today = dayInZone(new Date(), ctx.profile.timezone);
  const items = await listCalendarDeliverables(ctx.client.id, addDays(today, -120), addDays(today, 240));
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <ContentCalendar items={items} today={today} />
    </>
  );
}
