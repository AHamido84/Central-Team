import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { cn } from '@/lib/utils/cn';
import { listRequestTypes } from '@/modules/requests/server/queries';
import { StatusesEditor } from '@/modules/workflows/components/statuses-editor';
import { TemplatesAdmin } from '@/modules/workflows/components/templates-admin';
import { listTaskStatuses, listWorkflowTemplates } from '@/modules/workflows/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('workflows') };
}

export default async function WorkflowsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireAgency('workflows:manage');
  if (!ctx.flags['module.tasks']) notFound();
  const { tab } = await searchParams;
  const t = await getTranslations('workflows');
  const active = tab === 'statuses' ? 'statuses' : 'templates';
  const [templates, types, statuses] = await Promise.all([listWorkflowTemplates(), listRequestTypes(), listTaskStatuses()]);
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <nav aria-label={t('title')} className="mb-5 border-b border-border">
        <ul className="flex gap-1">
          {(['templates', 'statuses'] as const).map((k) => (
            <li key={k}>
              <Link
                href={k === 'templates' ? '/admin/workflows' : '/admin/workflows?tab=statuses'}
                aria-current={active === k ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium',
                  active === k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
                data-testid={`workflows-tab-${k}`}
              >
                {t(`tabs.${k}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {active === 'templates' ? (
        <TemplatesAdmin templates={templates} requestTypes={types.map((rt) => ({ id: rt.id, name: rt.name, icon: rt.icon }))} />
      ) : (
        <StatusesEditor statuses={statuses} />
      )}
    </>
  );
}
