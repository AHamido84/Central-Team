import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { requireAgencyAny } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { ClientsTable } from '@/modules/clients/components/clients-table';
import { listClients } from '@/modules/clients/server/queries';
import { getClientsHealth } from '@/modules/operations/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('clients') };
}

export default async function ClientsPage() {
  const ctx = await requireAgencyAny(['clients:read_all', 'clients:read_assigned']);
  const t = await getTranslations('clients');
  const [clients, health] = await Promise.all([
    listClients(ctx),
    can(ctx.permissions, 'operations:read') ? getClientsHealth(ctx) : undefined,
  ]);
  const canCreate = can(ctx.permissions, 'clients:create');
  return (
    <>
      <PageHeader
        title={t('title')}
        description={can(ctx.permissions, 'clients:read_all') ? t('descriptionAll') : t('descriptionAssigned')}
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/clients/new" data-testid="new-client">
                <Plus />
                {t('new')}
              </Link>
            </Button>
          ) : null
        }
      />
      <ClientsTable clients={clients} canCreate={canCreate} health={health} />
    </>
  );
}
