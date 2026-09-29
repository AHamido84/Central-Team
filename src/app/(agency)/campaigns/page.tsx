import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { CampaignFormDialog } from '@/modules/campaigns/components/campaign-form';
import { CampaignList } from '@/modules/campaigns/components/campaign-list';
import { listCampaigns } from '@/modules/campaigns/server/queries';
import { listAgencyPeople, listClients } from '@/modules/clients/server/queries';
import { dayInZone } from '@/modules/tasks/constants';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('campaigns') };
}

export default async function CampaignsPage() {
  const ctx = await requireAgency('campaigns:read');
  if (!ctx.flags['module.campaigns']) notFound();
  const t = await getTranslations('campaigns');
  const [campaigns, clients, people] = await Promise.all([listCampaigns(), listClients(ctx), listAgencyPeople(ctx)]);
  const clientOptions = clients.map((c) => ({ id: c.id, name: c.name }));
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          can(ctx.permissions, 'campaigns:manage') ? (
            <CampaignFormDialog
              trigger={
                <Button data-testid="new-campaign">
                  <Plus aria-hidden />
                  {t('list.new')}
                </Button>
              }
              clients={clientOptions}
              people={people.map((p) => ({ id: p.id, name: p.name }))}
              today={dayInZone(new Date(), ctx.organization.defaultTimezone)}
            />
          ) : null
        }
      />
      <CampaignList campaigns={campaigns} clients={clientOptions} />
    </>
  );
}
