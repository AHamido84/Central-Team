import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { can } from '@/lib/permissions/can';
import { cn } from '@/lib/utils/cn';
import { FollowUpList } from '@/modules/crm/components/follow-ups';
import { listFollowUps } from '@/modules/crm/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('followUps') };
}

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const ctx = await requireAgency('leads:read');
  if (!ctx.flags['module.crm']) notFound();
  const canAll = can(ctx.permissions, 'crm:manage_all');
  const scope = canAll && (await searchParams).scope === 'all' ? 'all' : 'mine';
  const [{ items, today, now }, t] = await Promise.all([listFollowUps(ctx, scope), getTranslations('crm.followUps')]);
  const tab = (value: 'mine' | 'all', label: string) => (
    <Link
      href={value === 'all' ? '/crm/follow-ups?scope=all' : '/crm/follow-ups'}
      aria-current={scope === value ? 'page' : undefined}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        scope === value ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
      data-testid={`followups-scope-${value}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canAll ? (
            <nav className="inline-flex gap-1 rounded-lg bg-surface-muted p-1" aria-label={t('title')}>
              {tab('mine', t('mine'))}
              {tab('all', t('everyone'))}
            </nav>
          ) : null
        }
      />
      <FollowUpList items={items} today={today} now={now} timeZone={ctx.profile.timezone} showOwner={scope === 'all'} />
    </div>
  );
}
