import { asc, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import { featureFlags } from '@/lib/db/schema';
import { FeatureToggles } from '@/modules/organizations/components/feature-toggles';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('features') };
}

/** Modules that belong to later phases: toggling them on only exposes their (empty-state) routes. */
const UPCOMING = new Set(['module.requests', 'module.approvals', 'module.calendar']);

export default async function FeaturesPage() {
  const ctx = await requireAgency('feature_flags:manage');
  const t = await getTranslations('admin.features');
  const rows = await withRls((tx) =>
    tx
      .select({
        key: featureFlags.key,
        module: featureFlags.module,
        description: featureFlags.description,
        enabled: sql<boolean>`app.feature_enabled(${ctx.organization.id}, ${featureFlags.key})`,
      })
      .from(featureFlags)
      .orderBy(asc(featureFlags.key)),
  );
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <FeatureToggles features={rows.map((r) => ({ ...r, upcoming: UPCOMING.has(r.key) }))} />
    </>
  );
}
