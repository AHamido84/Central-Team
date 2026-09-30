import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { requireAgencyAny } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { AutomationsList } from '@/modules/automations/components/automations-list';
import { listAutomations } from '@/modules/automations/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('automations') };
}

export default async function AutomationsPage() {
  const ctx = await requireAgencyAny(['automations:read', 'automations:manage']);
  if (!ctx.flags['module.integrations']) notFound();
  const [items, t] = await Promise.all([listAutomations(), getTranslations('automations')]);
  const canManage = can(ctx.permissions, 'automations:manage');
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canManage && items.length ? (
            <Button asChild>
              <Link href="/admin/automations/new" data-testid="new-automation">
                <Plus aria-hidden />
                {t('new')}
              </Link>
            </Button>
          ) : null
        }
      />
      <AutomationsList items={items} canManage={canManage} />
    </>
  );
}
