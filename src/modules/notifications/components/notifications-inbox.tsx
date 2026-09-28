'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, CheckCheck, PartyPopper } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState, PageHeader } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Card, Skeleton, Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { NotificationRow } from '@/modules/notifications/components/notification-list';
import { useNotificationsRealtime } from '@/modules/notifications/components/notification-bell';
import { listNotificationsAction, markNotificationsReadAction } from '@/modules/notifications/server/actions';

export function NotificationsInbox({ userId }: { userId: string }) {
  const t = useTranslations('notifications');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const queryClient = useQueryClient();
  useNotificationsRealtime(userId);
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'inbox', filter],
    queryFn: async () => {
      const res = await listNotificationsAction({ filter, limit: 100 });
      if (!res.ok) throw new Error(res.error.code);
      return res.data;
    },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('inboxTitle')}
        description={t('inboxDescription')}
        actions={
          data && data.unread > 0 ? (
            <Button
              variant="outline"
              onClick={async () => {
                await markNotificationsReadAction({ ids: 'all' });
                await refresh();
              }}
            >
              <CheckCheck />
              {t('markAllRead')}
            </Button>
          ) : null
        }
      />
      <Tabs value={filter} onValueChange={(v) => setFilter(v as 'all' | 'unread')}>
        <TabsList>
          <TabsTrigger value="all">{t('filterAll')}</TabsTrigger>
          <TabsTrigger value="unread">
            {t('filterUnread')}
            {data?.unread ? (
              <span className="tabular rounded-full bg-primary px-1.5 text-[0.6875rem] text-primary-foreground">{data.unread}</span>
            ) : null}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <Card className="mt-4 divide-y divide-border overflow-hidden">
        {isLoading ? (
          <div className="space-y-4 p-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : data && data.items.length > 0 ? (
          data.items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              onOpen={async (n) => {
                if (!n.readAt) {
                  await markNotificationsReadAction({ ids: [n.id] });
                  await refresh();
                }
              }}
            />
          ))
        ) : filter === 'unread' ? (
          <EmptyState icon={PartyPopper} title={t('emptyUnreadTitle')} description={t('emptyUnreadBody')} />
        ) : (
          <EmptyState icon={BellOff} title={t('emptyTitle')} description={t('emptyBody')} />
        )}
      </Card>
    </div>
  );
}
