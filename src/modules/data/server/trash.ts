import 'server-only';

import { sql } from 'drizzle-orm';

import type { AppContext } from '@/lib/auth/context';
import type { Tx } from '@/lib/db/client';
import { emitEvent } from '@/lib/events/emit';
import { CLIENT_FILES_BUCKET } from '@/lib/storage';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { TrashImpact, TrashType } from '@/modules/data/constants';

type Target = { org: string; client: string | null; title: string };

async function target(tx: Tx, type: TrashType, id: string): Promise<Target | null> {
  const [row] = await tx.execute<Target>(sql`select org, client, title from app.trash_target(${type}, ${id}::uuid)`);
  return row?.org ? row : null;
}

/** What a delete would take with it (RLS-scoped: the SQL function checks the caller's permission). */
export async function trashImpact(tx: Tx, type: TrashType, id: string): Promise<TrashImpact> {
  const [row] = await tx.execute<{ impact: TrashImpact }>(sql`select app.trash_impact(${type}, ${id}::uuid) as impact`);
  return row!.impact;
}

/**
 * Moves a row (and its children) to the Trash in the caller's transaction and records the events. Tasks also emit
 * `task.deleted` so the consumers that already follow it (board realtime, AI index) keep working.
 */
export async function trashDelete(
  tx: Tx,
  ctx: AppContext,
  type: TrashType,
  id: string,
  reassignTo: string | null = null,
): Promise<{ batch: string; clientId: string | null }> {
  const t = await target(tx, type, id);
  const impact = await trashImpact(tx, type, id);
  const [row] = await tx.execute<{ batch: string }>(sql`select app.trash_delete(${type}, ${id}::uuid, ${reassignTo}::uuid) as batch`);
  const clientId = type === 'client' ? id : (t?.client ?? null);
  await emitEvent(tx, {
    type: 'trash.deleted',
    organizationId: ctx.organization.id,
    actorId: ctx.session.userId,
    aggregate: { type, id },
    clientId,
    payload: { batch: row!.batch, entityType: type, entityId: id, clientId, counts: impact.counts },
  });
  if (type === 'task' && clientId) {
    await emitEvent(tx, {
      type: 'task.deleted',
      organizationId: ctx.organization.id,
      actorId: ctx.session.userId,
      aggregate: { type: 'task', id },
      clientId,
      payload: { taskId: id, clientId },
    });
  }
  return { batch: row!.batch, clientId };
}

export async function trashRestore(tx: Tx, ctx: AppContext, batch: string) {
  const [row] = await tx.execute<{ r: { entityType: string; entityId: string; clientId: string | null } }>(
    sql`select app.trash_restore(${batch}::uuid) as r`,
  );
  const r = row!.r;
  await emitEvent(tx, {
    type: 'trash.restored',
    organizationId: ctx.organization.id,
    actorId: ctx.session.userId,
    aggregate: { type: r.entityType, id: r.entityId },
    clientId: r.clientId,
    payload: { batch, entityType: r.entityType, entityId: r.entityId, clientId: r.clientId },
  });
  return r;
}

/** Permanent delete in the caller's transaction; returns the Storage paths to remove once it has committed. */
export async function trashPurge(tx: Tx, ctx: AppContext, batch: string, item: { entityType: string; entityId: string }) {
  const [row] = await tx.execute<{ paths: string[] }>(sql`select app.trash_purge(${batch}::uuid) as paths`);
  const paths = row?.paths ?? [];
  await emitEvent(tx, {
    type: 'trash.purged',
    organizationId: ctx.organization.id,
    actorId: ctx.session.userId,
    aggregate: { type: item.entityType, id: item.entityId },
    payload: { batch, entityType: item.entityType, entityId: item.entityId, files: paths.length },
  });
  return paths;
}

/**
 * Removes Storage objects of purged rows. Service path (CLAUDE.md §6): runs after the purge committed, for paths the
 * database returned from rows the caller was allowed to purge.
 */
export async function removeStorageObjects(paths: readonly string[], bucket = CLIENT_FILES_BUCKET): Promise<number> {
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { data, error } = await supabaseAdmin().storage.from(bucket).remove(chunk);
    if (error) console.error('[trash] storage removal failed', error.message);
    removed += data?.length ?? 0;
  }
  return removed;
}
