import 'server-only';

import { sql } from 'drizzle-orm';
import { strToU8, zipSync, type Zippable } from 'fflate';

import { dbAdmin } from '@/lib/db/client';
import { activityLog } from '@/lib/db/schema';

// Never exported: hashed secrets and bookkeeping that are useless (or risky) outside this database.
const SKIPPED_TABLES = new Set(['rate_limits', 'domain_events', 'ai_index_chunks', 'crm_webhook_tokens']);
const SKIPPED_COLUMNS = /(^|_)(token_hash|secret|secret_id|vault_id|embedding|key_encrypted|key_hash)$/;

/**
 * One-click backup (ADR-081): every organization-scoped table as JSON plus the organization row, the team's profiles
 * and a list of the Storage objects the rows point at. Service path — the route has checked the caller is this
 * organization's Super Admin; a backup must be complete regardless of per-row visibility, and it is audited.
 */
export async function buildBackup(organizationId: string, actorId: string): Promise<Uint8Array> {
  const tables = await dbAdmin.execute<{ table_name: string }>(sql`
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'organization_id' and t.table_type = 'BASE TABLE'
    order by c.table_name`);
  const files: Zippable = {};
  const summary: Record<string, number> = {};
  const put = (name: string, rows: Record<string, unknown>[]) => {
    const clean = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SKIPPED_COLUMNS.test(k))));
    files[`tables/${name}.json`] = strToU8(JSON.stringify(clean, null, 1));
    summary[name] = clean.length;
  };

  put('organizations', await dbAdmin.execute(sql`select * from public.organizations where id = ${organizationId}::uuid`));
  put(
    'profiles',
    await dbAdmin.execute(sql`
      select p.* from public.profiles p
      where p.id in (select user_id from public.organization_members where organization_id = ${organizationId}::uuid
        union select user_id from public.client_users where organization_id = ${organizationId}::uuid)`),
  );
  for (const { table_name: name } of tables) {
    if (SKIPPED_TABLES.has(name)) continue;
    put(
      name,
      await dbAdmin.execute(
        sql`select * from ${sql.identifier('public')}.${sql.identifier(name)} where organization_id = ${organizationId}::uuid`,
      ),
    );
  }
  const storage = await dbAdmin.execute(sql`
    select bucket, path from app.data_reset_paths(${organizationId}::uuid, 'factory')`);
  files['storage-objects.json'] = strToU8(JSON.stringify(storage, null, 1));
  files['manifest.json'] = strToU8(
    JSON.stringify({ organizationId, exportedAt: new Date().toISOString(), exportedBy: actorId, tables: summary }, null, 2),
  );

  await dbAdmin.insert(activityLog).values({
    organizationId,
    actorId,
    action: 'data_export',
    tableName: 'organizations',
    recordId: organizationId,
    after: { tables: Object.keys(summary).length, rows: Object.values(summary).reduce((a, b) => a + b, 0) },
  });
  return zipSync(files, { level: 6 });
}
