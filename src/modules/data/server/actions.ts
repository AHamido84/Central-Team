'use server';

import { createClient } from '@supabase/supabase-js';
import { eq, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import { ActionFailure } from '@/lib/actions/errors';
import type { AgencyContext } from '@/lib/auth/context';
import { dbAdmin, type Tx } from '@/lib/db/client';
import { dataResetJobs, organizations } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { emitEvent } from '@/lib/events/emit';
import { can } from '@/lib/permissions/can';
import { deletePermission, purgePermission, RESET_PHRASE, resetModes, trashTypes } from '@/modules/data/constants';
import { toResetJob } from '@/modules/data/server/queries';
import { runDataReset } from '@/modules/data/server/reset';
import { removeStorageObjects, trashDelete, trashImpact, trashPurge, trashRestore } from '@/modules/data/server/trash';

const target = z.object({ type: z.enum(trashTypes), id: z.uuid() });

// Deletes change what many screens show (lists, counts, the portal): refresh everything.
const everywhere = ['/'];

// Both sides: portal users may delete their own messages and uploads; the SQL functions decide (ADR-080).
export const trashImpactAction = defineAction({
  input: target,
  side: 'any',
  async handler({ input, tx }) {
    return trashImpact(tx, input.type, input.id);
  },
});

export const trashDeleteAction = defineAction({
  input: target.extend({ reassignTo: z.uuid().nullable().optional() }),
  side: 'any',
  async handler({ input, tx, ctx }) {
    return trashDelete(tx, ctx, input.type, input.id, input.reassignTo ?? null);
  },
  revalidate: everywhere,
});

/** Bulk delete from list and table views: all or nothing, one Trash entry per row. */
export const trashDeleteManyAction = defineAction({
  input: z.object({ type: z.enum(trashTypes), ids: z.array(z.uuid()).min(1).max(500) }),
  side: 'agency',
  permission: (input) => deletePermission(input.type),
  async handler({ input, tx, ctx }) {
    const batches: string[] = [];
    for (const id of new Set(input.ids)) batches.push((await trashDelete(tx, ctx, input.type, id)).batch);
    return { count: batches.length };
  },
  revalidate: everywhere,
});

// Both sides so an author can undo deleting their own message or upload; `app.trash_restore` checks the rights.
export const trashRestoreAction = defineAction({
  input: z.object({ batch: z.uuid() }),
  side: 'any',
  async handler({ input, tx, ctx }) {
    return trashRestore(tx, ctx, input.batch);
  },
  revalidate: everywhere,
});

async function itemOf(tx: Tx, batch: string) {
  await tx.execute(sql`select set_config('app.trash_mode', 'on', true)`);
  const [row] = await tx.execute<{ entity_type: string; entity_id: string }>(
    sql`select entity_type, entity_id from public.trash_items where batch = ${batch}::uuid`,
  );
  if (!row) throw new ActionFailure('not_found');
  return { entityType: row.entity_type, entityId: row.entity_id };
}

export const trashPurgeAction = defineAction({
  input: z.object({ batch: z.uuid() }),
  side: 'agency',
  async handler({ input, tx, ctx }) {
    const item = await itemOf(tx, input.batch);
    if (!can(ctx.permissions, purgePermission(item.entityType as (typeof trashTypes)[number]))) throw new ActionFailure('forbidden');
    return { paths: await trashPurge(tx, ctx, input.batch, item) };
  },
  async complete({ prepared }) {
    return { files: await removeStorageObjects(prepared.paths) };
  },
  revalidate: ['/admin/trash'],
});

/** Purges every entry the caller may purge (others stay). */
export const emptyTrashAction = defineAction({
  input: z.object({ batches: z.array(z.uuid()).min(1).max(500) }),
  side: 'agency',
  async handler({ input, tx, ctx }) {
    const paths: string[] = [];
    let purged = 0;
    for (const batch of input.batches) {
      const item = await itemOf(tx, batch);
      if (!can(ctx.permissions, purgePermission(item.entityType as (typeof trashTypes)[number]))) continue;
      paths.push(...(await trashPurge(tx, ctx, batch, item)));
      purged++;
    }
    return { paths, purged };
  },
  async complete({ prepared }) {
    await removeStorageObjects(prepared.paths);
    return { purged: prepared.purged };
  },
  revalidate: ['/admin/trash'],
});

// ---------------------------------------------------------------------------
// Data management (Super Admin only — ADR-081)
// ---------------------------------------------------------------------------

function requireSuperAdmin(ctx: AgencyContext) {
  if (!ctx.isSuperAdmin) throw new ActionFailure('forbidden');
}

/** Checks the password of the signed-in user with a throwaway client (no session is created or changed). */
async function verifyPassword(email: string, password: string): Promise<void> {
  const client = createClient(env().NEXT_PUBLIC_SUPABASE_URL, env().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new ActionFailure(error.status === 429 ? 'rate_limited' : 'invalid_password');
  await client.auth.signOut({ scope: 'local' });
}

export const dataResetPreviewAction = defineAction({
  input: z.object({ mode: z.enum(resetModes) }),
  side: 'agency',
  async handler({ input, ctx }) {
    requireSuperAdmin(ctx);
    // Service path: counts across the whole organization, for its Super Admin.
    const [row] = await dbAdmin.execute<{ counts: Record<string, number> }>(
      sql`select app.data_reset_preview(${ctx.organization.id}::uuid, ${input.mode}, ${ctx.session.userId}::uuid) as counts`,
    );
    return row?.counts ?? {};
  },
});

export const startDataResetAction = defineAction({
  input: z.object({ mode: z.enum(resetModes), password: z.string().min(1).max(200), phrase: z.string().max(100) }),
  side: 'agency',
  rateLimit: { key: 'data_reset', max: 5, windowSeconds: 900 },
  async handler({ input, ctx }) {
    requireSuperAdmin(ctx);
    if (input.phrase.trim() !== RESET_PHRASE) throw new ActionFailure('confirmation_mismatch');
    const [org] = await dbAdmin
      .select({ lockedAt: organizations.dataResetLockedAt })
      .from(organizations)
      .where(eq(organizations.id, ctx.organization.id));
    if (org?.lockedAt) throw new ActionFailure('reset_locked');
    await verifyPassword(ctx.profile.email, input.password);
    const [job] = await dbAdmin
      .insert(dataResetJobs)
      .values({ organizationId: ctx.organization.id, mode: input.mode, requestedBy: ctx.session.userId, step: 'queued' })
      .returning();
    return toResetJob(job!);
  },
  async complete({ prepared, ctx }) {
    // The wipe runs after the response (progress is polled); it never needs the browser.
    after(() => runDataReset(prepared.id, ctx.organization.id, ctx.session.userId));
    return prepared;
  },
});

export const resetJobAction = defineAction({
  input: z.object({ jobId: z.uuid() }),
  side: 'agency',
  async handler({ input, tx, ctx }) {
    requireSuperAdmin(ctx);
    const [job] = await tx.select().from(dataResetJobs).where(eq(dataResetJobs.id, input.jobId));
    if (!job) throw new ActionFailure('not_found');
    return toResetJob(job);
  },
});

export const setResetLockAction = defineAction({
  input: z.object({ locked: z.boolean(), password: z.string().max(200).optional() }),
  side: 'agency',
  rateLimit: { key: 'data_reset_lock', max: 10, windowSeconds: 900 },
  async handler({ input, ctx }) {
    requireSuperAdmin(ctx);
    if (!input.locked) await verifyPassword(ctx.profile.email, input.password ?? '');
    // Service path for one column the Super Admin owns; audited by the organizations trigger.
    await dbAdmin.transaction(async (tx) => {
      await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ctx.session.userId })}, true)`);
      await tx
        .update(organizations)
        .set({ dataResetLockedAt: input.locked ? new Date() : null })
        .where(eq(organizations.id, ctx.organization.id));
      await emitEvent(tx, {
        type: 'data.reset_lock_changed',
        organizationId: ctx.organization.id,
        actorId: ctx.session.userId,
        aggregate: { type: 'organization', id: ctx.organization.id },
        payload: { locked: input.locked },
      });
    });
    return { locked: input.locked };
  },
  revalidate: ['/settings/data'],
});
