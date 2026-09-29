import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { DirIcon } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { requirePortal } from '@/lib/auth/context';
import { PrintButton } from '@/modules/campaigns/components/portal-campaign-detail';
import { ReportView } from '@/modules/campaigns/components/report-view';
import { getReport } from '@/modules/campaigns/server/queries';
import { ArrowLeft } from 'lucide-react';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata({ params }: { params: Promise<{ reportId: string }> }): Promise<Metadata> {
  const { reportId } = await params;
  const r = isUuid(reportId) ? await getReport(reportId) : null;
  return { title: r?.title };
}

export default async function PortalReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  if (!isUuid(reportId)) notFound();
  const ctx = await requirePortal();
  if (!ctx.flags['module.campaigns']) notFound();
  const report = await getReport(reportId);
  // RLS only returns published reports of the client's own companies.
  if (!report || report.clientId !== ctx.client.id || report.status !== 'published') notFound();
  const t = await getTranslations('reports');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href={report.campaign ? `/portal/campaigns/${report.campaign.id}` : '/portal/campaigns'}>
            <DirIcon icon={ArrowLeft} />
            {t('portal.back')}
          </Link>
        </Button>
        <PrintButton />
      </div>
      <ReportView report={report} />
    </div>
  );
}
