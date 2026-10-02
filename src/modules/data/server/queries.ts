import 'server-only';

import { desc, sql } from 'drizzle-orm';

import { withRls } from '@/lib/db/rls';
import { dataResetJobs, organizations, profiles, trashItems } from '@/lib/db/schema';
import type { LocalizedText } from '@/lib/i18n/localized';
import type { ResetMode, TrashType } from '@/modules/data/constants';

export type TrashListItem = {
  batch: string;
  entityType: TrashType;
  entityId: string;
  title: string;
  client: { id: string; name: LocalizedText } | null;
  counts: Record<string, number>;
  deletedBy: string | null;
  deletedAt: string;
};

/**
 * The Trash as the caller may see it: entries of the kinds they can delete, on clients they can reach. Runs in Trash
 * mode so deleted clients' names still resolve (ADR-080).
 */
export async function listTrash(): Promise<TrashListItem[]> {
  return withRls(async (tx) => {
    await tx.execute(sql`select set_config('app.trash_mode', 'on', true)`);
    const rows = await tx.execute<{
      batch: string;
      entity_type: TrashType;
      entity_id: string;
      title: string;
      client_id: string | null;
      client_name: LocalizedText | null;
      counts: Record<string, number>;
      deleted_by: string | null;
      deleted_at: string;
    }>(sql`
      select i.batch, i.entity_type, i.entity_id, i.title, i.client_id, c.name as client_name, i.counts,
        p.full_name as deleted_by, i.deleted_at::text
      from ${trashItems} i
      left join public.clients c on c.id = i.client_id
      left join ${profiles} p on p.id = i.deleted_by
      order by i.deleted_at desc
      limit 500`);
    return rows.map((r) => ({
      batch: r.batch,
      entityType: r.entity_type,
      entityId: r.entity_id,
      title: r.title,
      client: r.client_id && r.client_name ? { id: r.client_id, name: r.client_name } : null,
      counts: r.counts,
      deletedBy: r.deleted_by,
      deletedAt: new Date(r.deleted_at.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString(),
    }));
  });
}

export type ResetJob = {
  id: string;
  mode: ResetMode;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  step: string | null;
  progress: number;
  counts: Record<string, number>;
  filesRemoved: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export function toResetJob(j: typeof dataResetJobs.$inferSelect): ResetJob {
  return {
    id: j.id,
    mode: j.mode as ResetMode,
    status: j.status as ResetJob['status'],
    step: j.step,
    progress: j.progress,
    counts: j.counts,
    filesRemoved: j.filesRemoved,
    error: j.error,
    createdAt: j.createdAt.toISOString(),
    finishedAt: j.finishedAt?.toISOString() ?? null,
  };
}

/** The data management screen: lock state and the last runs (Super Admin — RLS limits the jobs to them). */
export async function getDataManagement(): Promise<{ lockedAt: string | null; jobs: ResetJob[] }> {
  return withRls(async (tx) => {
    const [org] = await tx.select({ lockedAt: organizations.dataResetLockedAt }).from(organizations).limit(1);
    const jobs = await tx.select().from(dataResetJobs).orderBy(desc(dataResetJobs.createdAt)).limit(10);
    return { lockedAt: org?.lockedAt?.toISOString() ?? null, jobs: jobs.map(toResetJob) };
  });
}
