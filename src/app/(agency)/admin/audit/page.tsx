import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/patterns';
import { requireAgency } from '@/lib/auth/context';
import { withRls } from '@/lib/db/rls';
import { activityLog, profiles } from '@/lib/db/schema';
import { AuditLog, type AuditEntry } from '@/modules/audit/components/audit-log';
import { listTeam } from '@/modules/rbac/server/queries';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('audit') };
}

const PAGE_SIZE = 50;
const AUDITED_TABLES = [
  'organizations',
  'organization_members',
  'profiles',
  'roles',
  'role_permissions',
  'user_roles',
  'user_permission_overrides',
  'departments',
  'department_members',
  'invitations',
  'organization_features',
  'clients',
  'client_notes',
  'client_users',
  'client_assignments',
  'packages',
  'package_items',
  'client_packages',
  'file_folders',
  'files',
];

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; table?: string; actor?: string; action?: string }>;
}) {
  const ctx = await requireAgency('audit_log:read');
  const t = await getTranslations('admin.audit');
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const filters: SQL[] = [eq(activityLog.organizationId, ctx.organization.id)];
  if (sp.table && AUDITED_TABLES.includes(sp.table)) filters.push(eq(activityLog.tableName, sp.table));
  if (sp.actor && /^[0-9a-f-]{36}$/.test(sp.actor)) filters.push(eq(activityLog.actorId, sp.actor));
  if (sp.action === 'insert' || sp.action === 'update' || sp.action === 'delete') filters.push(eq(activityLog.action, sp.action));

  const [rows, team] = await Promise.all([
    withRls((tx) =>
      tx
        .select({ log: activityLog, actorName: profiles.fullName, actorAvatar: profiles.avatarPath })
        .from(activityLog)
        .leftJoin(profiles, eq(profiles.id, activityLog.actorId))
        .where(and(...filters))
        .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
        .limit(PAGE_SIZE + 1)
        .offset((page - 1) * PAGE_SIZE),
    ),
    listTeam(ctx),
  ]);

  const entries: AuditEntry[] = rows.slice(0, PAGE_SIZE).map(({ log, actorName, actorAvatar }) => ({
    id: log.id,
    action: log.action as AuditEntry['action'],
    tableName: log.tableName,
    recordId: log.recordId,
    before: log.before as Record<string, unknown> | null,
    after: log.after as Record<string, unknown> | null,
    changedFields: log.changedFields,
    createdAt: log.createdAt.toISOString(),
    actor: log.actorId ? { name: actorName ?? '', avatarPath: actorAvatar } : null,
  }));

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <AuditLog
        entries={entries}
        page={page}
        hasNext={rows.length > PAGE_SIZE}
        tables={AUDITED_TABLES}
        actors={team.map((m) => ({ id: m.userId, name: m.name }))}
      />
    </>
  );
}
