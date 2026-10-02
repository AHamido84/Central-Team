import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { PipelineBoard } from '@/modules/crm/components/pipeline-board';
import { getBoard, getCrmOptions } from '@/modules/crm/server/queries';
import { dayInZone } from '@/modules/tasks/constants';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('pipeline') };
}

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ pipeline?: string }> }) {
  const ctx = await requireAgency('deals:read');
  if (!ctx.flags['module.crm']) notFound();
  const { pipeline: pipelineParam } = await searchParams;
  const t = await getTranslations('crm.pipeline');
  const options = await getCrmOptions(ctx);
  const pipeline =
    options.pipelines.find((p) => p.id === pipelineParam) ?? options.pipelines.find((p) => p.isDefault) ?? options.pipelines[0];
  const deals = pipeline ? await getBoard(ctx, pipeline.id) : [];
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {pipeline ? (
        <PipelineBoard
          deals={deals}
          pipeline={pipeline}
          options={options}
          today={dayInZone(new Date(), ctx.profile.timezone)}
          staleDays={options.staleDays}
          me={ctx.session.userId}
          canManage={can(ctx.permissions, 'deals:manage')}
          canManageAll={can(ctx.permissions, 'crm:manage_all')}
        />
      ) : (
        <PipelineBoard
          deals={[]}
          pipeline={{ id: '', name: {}, isDefault: true, stages: [] }}
          options={options}
          today={dayInZone(new Date(), ctx.profile.timezone)}
          staleDays={options.staleDays}
          me={ctx.session.userId}
          canManage={false}
          canManageAll={false}
        />
      )}
    </>
  );
}
