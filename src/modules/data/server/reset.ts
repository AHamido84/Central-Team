import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { activityLog, dataResetJobs } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { scheduleEventDispatch } from '@/lib/events/schedule';
import type { ResetMode } from '@/modules/data/constants';
import { removeStorageObjects } from '@/modules/data/server/trash';

/**
 * Runs a data reset job (ADR-081) — service path: the action already checked the Super Admin, their password, the
 * phrase and the lock. Steps are written to the job row so the screen can show progress; the database work is one
 * transaction (`app.data_reset_run`), Storage objects are removed after it commits, and a single audit entry is
 * written last so it survives the wipe.
 */
export async function runDataReset(jobId: string, organizationId: string, userId: string): Promise<void> {
  const step = (patch: Partial<typeof dataResetJobs.$inferInsert>) =>
    dbAdmin.update(dataResetJobs).set(patch).where(eq(dataResetJobs.id, jobId));
  try {
    const [job] = await dbAdmin.select().from(dataResetJobs).where(eq(dataResetJobs.id, jobId));
    if (!job || job.status !== 'queued') return;
    const mode = job.mode as ResetMode;
    await step({ status: 'running', startedAt: new Date(), step: 'collecting', progress: 10 });
    const paths = await dbAdmin.execute<{ bucket: string; path: string }>(
      sql`select bucket, path from app.data_reset_paths(${organizationId}::uuid, ${mode})`,
    );
    await step({ step: 'deleting', progress: 30 });
    const counts = await dbAdmin.transaction(async (tx) => {
      const [row] = await tx.execute<{ counts: Record<string, number> }>(
        sql`select app.data_reset_run(${organizationId}::uuid, ${mode}, ${userId}::uuid) as counts`,
      );
      return row?.counts ?? {};
    });
    await step({ step: 'files', progress: 70, counts });
    let filesRemoved = 0;
    for (const bucket of new Set(paths.map((p) => p.bucket))) {
      filesRemoved += await removeStorageObjects(
        paths.filter((p) => p.bucket === bucket).map((p) => p.path),
        bucket,
      );
    }
    await step({ step: 'finishing', progress: 95, filesRemoved });
    await dbAdmin.transaction(async (tx) => {
      await tx.insert(activityLog).values({
        organizationId,
        actorId: userId,
        action: 'data_reset',
        tableName: 'organizations',
        recordId: organizationId,
        after: { mode, counts, filesRemoved, jobId },
      });
      await emitEvent(tx, {
        type: 'data.reset',
        organizationId,
        actorId: userId,
        aggregate: { type: 'organization', id: organizationId },
        payload: { jobId, mode, counts, filesRemoved },
      });
    });
    await step({ status: 'succeeded', step: 'done', progress: 100, finishedAt: new Date() });
    scheduleEventDispatch();
  } catch (error) {
    const pg = error as { message?: string; cause?: { message?: string } };
    const reason = pg.cause?.message ?? pg.message ?? 'unknown';
    console.error('[data-reset] failed', jobId, reason);
    await step({ status: 'failed', step: 'failed', error: reason.slice(0, 500), finishedAt: new Date() });
  }
}
