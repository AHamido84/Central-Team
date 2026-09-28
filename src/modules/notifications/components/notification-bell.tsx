'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger, Skeleton, Tooltip } from '@/components/ui/primitives';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { listNotificationsAction, markNotificationsReadAction } from '@/modules/notifications/server/actions';
import { NotificationRow } from '@/modules/notifications/components/notification-list';

export const notificationsQueryKey = ['notifications', 'latest'] as const;

async function fetchLatest() {
  const res = await listNotificationsAction({ filter: 'all', limit: 10 });
  if (!res.ok) throw new Error(res.error.code);
  return res.data;
}

/** Subscribes to the user's notification rows (RLS limits Realtime to their own rows). */
export function useNotificationsRealtime(userId: string, onInsert?: () => void) {
  const queryClient = useQueryClient();
  const onInsertRef = useRef(onInsert);
  onInsertRef.current = onInsert;
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`notifications:${userId}:${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['notifications'] });
          onInsertRef.current?.();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}

export function NotificationBell({ userId, inboxHref }: { userId: string; inboxHref: string }) {
  const t = useTranslations('notifications');
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: notificationsQueryKey, queryFn: fetchLatest, refetchInterval: 60_000 });
  useNotificationsRealtime(userId, () => toast(t('newNotification')));
  const unread = data?.unread ?? 0;

  const markAll = async () => {
    await markNotificationsReadAction({ ids: 'all' });
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
  const markOne = async (id: string) => {
    await markNotificationsReadAction({ ids: [id] });
    setOpen(false);
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={t('title')}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={unread > 0 ? t('bellUnread', { count: unread }) : t('title')}
            data-testid="notification-bell"
          >
            <Bell />
            {unread > 0 ? (
              <span
                className="absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.625rem] leading-none font-semibold text-white tabular"
                data-testid="notification-count"
              >
                {unread > 99 ? '99+' : unread}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(92vw,24rem)] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="font-semibold">{t('title')}</p>
          {unread > 0 ? (
            <Button variant="link" size="sm" onClick={markAll}>
              {t('markAllRead')}
            </Button>
          ) : null}
        </div>
        <div className="max-h-[60vh] divide-y divide-border overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : data && data.items.length > 0 ? (
            data.items.map((item) => <NotificationRow key={item.id} item={item} compact onOpen={(n) => void markOne(n.id)} />)
          ) : (
            <EmptyState compact icon={BellOff} title={t('emptyTitle')} description={t('emptyBody')} />
          )}
        </div>
        <div className="border-t border-border p-2">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link href={inboxHref} onClick={() => setOpen(false)}>
              {t('openInbox')}
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
