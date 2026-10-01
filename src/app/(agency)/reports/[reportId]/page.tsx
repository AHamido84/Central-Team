import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { getAiAvailability } from '@/modules/ai/server/queries';
import { ReportBuilder } from '@/modules/campaigns/components/report-builder';
import { getReport } from '@/modules/campaigns/server/queries';

// Server Actions on this page call AI models (ADR-089): the provider timeout (90 s, one retry) and the assistant's
// 200 s deadline end slow calls inside the function's 300 s limit (the Vercel maximum with fluid compute).
export const maxDuration = 300;

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata({ params }: { params: Promise<{ reportId: string }> }): Promise<Metadata> {
  const { reportId } = await params;
  const r = isUuid(reportId) ? await getReport(reportId) : null;
  return { title: r?.title };
}

export default async function ReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  if (!isUuid(reportId)) notFound();
  const ctx = await requireAgency('campaigns:read');
  if (!ctx.flags['module.campaigns']) notFound();
  const report = await getReport(reportId);
  if (!report) notFound();
  const ai = ctx.flags['module.ai'] ? await getAiAvailability(ctx) : null;
  return (
    <>
      <BreadcrumbLabel segment={reportId} label={report.title} />
      <ReportBuilder
        key={`${report.id}:${report.status}:${report.updatedAt}`}
        report={report}
        canManage={can(ctx.permissions, 'reports:manage')}
        aiDraft={Boolean(ai?.usable)}
      />
    </>
  );
}
