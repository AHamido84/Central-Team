'use client';

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { ensureRealtimeAuth, getSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { TaskPatch } from '@/modules/tasks/schemas';
import { listTasksAction, loadTaskAction, moveTaskAction, updateTaskAction } from '@/modules/tasks/server/actions';
import type { TaskDetail, TaskListItem } from '@/modules/tasks/server/queries';

export type StatusLite = { id: string; category: TaskListItem['statusCategory'] };

export const tasksKey = ['tasks'] as const;
export const taskKey = (id: string) => ['task', id] as const;

/**
 * Live subscription to task changes (RLS decides which rows each user receives). Bursts are debounced into one
 * refetch so a bulk update or a workflow conversion doesn't refetch hundreds of times.
 */
export function useTasksRealtime(onChange: () => void) {
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(() => handler.current(), 400);
    };
    void ensureRealtimeAuth().then((supabase) => {
      if (cancelled) return;
      channel = supabase
        .channel(`tasks:${crypto.randomUUID()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fire)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'deliverables' }, fire)
        .subscribe();
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (channel) void getSupabaseBrowserClient().removeChannel(channel);
    };
  }, []);
}

export function useTasks(initial: TaskListItem[]) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: tasksKey,
    initialData: initial,
    queryFn: async () => {
      const res = await listTasksAction({});
      if (!res.ok) throw new Error(res.error.code);
      return res.data;
    },
  });
  useTasksRealtime(() => {
    void queryClient.invalidateQueries({ queryKey: tasksKey });
    void queryClient.invalidateQueries({ queryKey: ['task'] });
  });
  return query.data;
}

export function useTaskDetail(taskId: string | null) {
  return useQuery({
    queryKey: taskKey(taskId ?? 'none'),
    enabled: Boolean(taskId),
    queryFn: async (): Promise<TaskDetail> => {
      const res = await loadTaskAction({ taskId: taskId! });
      if (!res.ok) throw new Error(res.error.code);
      return res.data;
    },
  });
}

function patchCaches(queryClient: QueryClient, taskId: string, patch: Partial<TaskListItem>) {
  queryClient.setQueryData<TaskListItem[]>(tasksKey, (list) => list?.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
  queryClient.setQueryData<TaskDetail>(taskKey(taskId), (d) => (d ? { ...d, ...patch } : d));
}

/** Optimistic task mutations: the caches change first, the server confirms (or the change is rolled back with a toast). */
export function useTaskMutations(statuses: StatusLite[]) {
  const queryClient = useQueryClient();
  const t = useTranslations('errors');

  const snapshot = useCallback(
    (taskId: string) => ({
      list: queryClient.getQueryData<TaskListItem[]>(tasksKey),
      detail: queryClient.getQueryData<TaskDetail>(taskKey(taskId)),
    }),
    [queryClient],
  );
  const restore = useCallback(
    (taskId: string, snap: ReturnType<typeof snapshot>) => {
      queryClient.setQueryData(tasksKey, snap.list);
      queryClient.setQueryData(taskKey(taskId), snap.detail);
    },
    [queryClient],
  );
  const settle = useCallback(
    (taskId: string) => {
      void queryClient.invalidateQueries({ queryKey: taskKey(taskId) });
      void queryClient.invalidateQueries({ queryKey: tasksKey });
    },
    [queryClient],
  );

  const update = useCallback(
    async (taskId: string, patch: TaskPatch): Promise<boolean> => {
      const snap = snapshot(taskId);
      const optimistic: Partial<TaskListItem> & { description?: string } = { ...(patch as Partial<TaskListItem>) };
      if (patch.statusId) optimistic.statusCategory = statuses.find((s) => s.id === patch.statusId)?.category ?? 'todo';
      patchCaches(queryClient, taskId, optimistic);
      const res = await updateTaskAction({ taskId, patch });
      if (!res.ok) {
        restore(taskId, snap);
        toast.error(t(res.error.code));
      }
      settle(taskId);
      return res.ok;
    },
    [queryClient, restore, settle, snapshot, statuses, t],
  );

  const move = useCallback(
    async (taskId: string, statusId: string, position: number): Promise<boolean> => {
      const snap = snapshot(taskId);
      patchCaches(queryClient, taskId, { statusId, position, statusCategory: statuses.find((s) => s.id === statusId)?.category ?? 'todo' });
      const res = await moveTaskAction({ taskId, statusId, position });
      if (!res.ok) {
        restore(taskId, snap);
        toast.error(t(res.error.code));
      }
      settle(taskId);
      return res.ok;
    },
    [queryClient, restore, settle, snapshot, statuses, t],
  );

  return { update, move, refresh: settle };
}
