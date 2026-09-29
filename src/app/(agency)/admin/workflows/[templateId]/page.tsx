import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { BreadcrumbLabel } from '@/components/shell/breadcrumbs';
import { requireAgency } from '@/lib/auth/context';
import { localized, type Locale } from '@/lib/i18n/localized';
import { listAgencyPeople } from '@/modules/clients/server/queries';
import { listDepartments, listRoles } from '@/modules/rbac/server/queries';
import { listRequestTypes } from '@/modules/requests/server/queries';
import { WorkflowBuilder } from '@/modules/workflows/components/workflow-builder';
import { getWorkflowTemplate } from '@/modules/workflows/server/queries';

const isUuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

export async function generateMetadata({ params }: { params: Promise<{ templateId: string }> }): Promise<Metadata> {
  const { templateId } = await params;
  const tpl = isUuid(templateId) ? await getWorkflowTemplate(templateId) : null;
  return { title: tpl ? localized(tpl.name, (await getLocale()) as Locale) : undefined };
}

export default async function WorkflowBuilderPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  if (!isUuid(templateId)) notFound();
  const ctx = await requireAgency('workflows:manage');
  if (!ctx.flags['module.tasks']) notFound();
  const template = await getWorkflowTemplate(templateId);
  if (!template) notFound();
  const [departments, roles, people, types] = await Promise.all([
    listDepartments(ctx),
    listRoles(ctx),
    listAgencyPeople(ctx),
    listRequestTypes(),
  ]);
  const t = await getTranslations('workflows.builder');
  const name = localized(template.name, (await getLocale()) as Locale);
  return (
    <>
      <BreadcrumbLabel segment={templateId} label={name} />
      <PageHeader title={name} description={t('description')} />
      <WorkflowBuilder
        key={template.updatedAt}
        template={template}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        roles={roles.filter((r) => r.side === 'agency').map((r) => ({ id: r.id, name: r.name }))}
        people={people.map((p) => ({ id: p.id, name: p.name }))}
        requestTypes={types.map((rt) => ({ id: rt.id, name: rt.name, icon: rt.icon }))}
        timeZone={ctx.organization.defaultTimezone}
      />
    </>
  );
}
