'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Lock, MessageSquarePlus, MessagesSquare, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Avatar, Badge, Card, NativeSelect } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { preview as previewText } from '@/modules/messaging/mentions';
import { Conversation } from '@/modules/messaging/components/conversation';
import { createThreadAction } from '@/modules/messaging/server/actions';
import type { ThreadDetail, ThreadSummary } from '@/modules/messaging/server/queries';

const newThreadSchema = z.object({
  clientId: z.string().min(1, { message: 'required' }),
  title: z.string().trim().min(1, { message: 'required' }).max(140),
  visibility: z.enum(['internal', 'client']),
  body: z.string().trim().min(1, { message: 'required' }).max(10000),
});

function NewThreadDialog({
  open,
  onOpenChange,
  clients,
  side,
  basePath,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clients: { id: string; name: string }[];
  side: 'agency' | 'client';
  basePath: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const form = useForm<z.infer<typeof newThreadSchema>>({
    resolver: zodResolver(newThreadSchema),
    defaultValues: { clientId: clients.length === 1 ? clients[0]!.id : '', title: '', visibility: 'client', body: '' },
  });
  const create = useAction(createThreadAction, { successMessage: t('messaging.threadCreated') });
  const submit = form.handleSubmit(async (v) => {
    const res = await create.run(v);
    if (res.ok) {
      form.reset();
      onOpenChange(false);
      router.push(`${basePath}thread=${res.data.threadId}`);
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogHeader>
            <DialogTitle>{t('messaging.newThread')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            {clients.length > 1 ? (
              <Field label={t('clients.client')} error={form.formState.errors.clientId?.message} required>
                {(p) => (
                  <NativeSelect {...p} {...form.register('clientId')}>
                    <option value="">{t('clients.chooseClient')}</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            ) : null}
            <Field label={t('messaging.subject')} error={form.formState.errors.title?.message} required>
              {(p) => <Input {...p} {...form.register('title')} data-testid="new-thread-title" />}
            </Field>
            {side === 'agency' ? (
              <Field label={t('files.visibility')} hint={t('messaging.visibilityHint')}>
                {(p) => (
                  <NativeSelect {...p} {...form.register('visibility')}>
                    <option value="client">{t('messaging.withClient')}</option>
                    <option value="internal">{t('messaging.internalOnly')}</option>
                  </NativeSelect>
                )}
              </Field>
            ) : null}
            <Field label={t('messaging.firstMessage')} error={form.formState.errors.body?.message} required>
              {(p) => <Textarea {...p} rows={4} {...form.register('body')} data-testid="new-thread-body" />}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting} data-testid="new-thread-submit">
              {t('messaging.startConversation')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Two-pane messaging (list + conversation) shared by the agency inbox, the client page and the portal.
 * On mobile only one pane is visible; the `thread` search param selects the conversation.
 */
export function ThreadsView({
  threads,
  active,
  me,
  side,
  canWrite,
  clients,
  showClientName,
  basePath,
  height = 'h-[calc(100dvh-12rem)]',
}: {
  threads: ThreadSummary[];
  active: ThreadDetail | null;
  me: { userId: string };
  side: 'agency' | 'client';
  canWrite: boolean;
  clients: { id: string; name: string }[];
  showClientName: boolean;
  /** Path + query prefix ending with `?` or `&` to which `thread=<id>` is appended. */
  basePath: string;
  height?: string;
}) {
  const t = useTranslations('messaging');
  const locale = useLocale() as Locale;
  const f = useFormat();
  const params = useSearchParams();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const shown = threads.filter(
    (th) =>
      !query ||
      th.title.toLowerCase().includes(query.toLowerCase()) ||
      localized(th.clientName, locale).toLowerCase().includes(query.toLowerCase()),
  );
  const activeId = params.get('thread');
  const listHref = basePath.replace(/[?&]$/, '') || '?';

  return (
    <Card className={cn('grid grid-cols-1 overflow-hidden md:grid-cols-[20rem_minmax(0,1fr)]', height)}>
      <aside className={cn('flex min-h-0 min-w-0 flex-col border-e border-border', activeId && active && 'hidden md:flex')}>
        <div className="flex items-center gap-2 border-b border-border p-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchThreads')}
              className="h-9 ps-8"
              aria-label={t('searchThreads')}
            />
          </div>
          {canWrite ? (
            <Button size="icon" variant="soft" onClick={() => setCreating(true)} aria-label={t('newThread')} data-testid="new-thread">
              <MessageSquarePlus />
            </Button>
          ) : null}
        </div>
        <ul className="flex-1 divide-y divide-border overflow-y-auto" data-testid="thread-list">
          {shown.length === 0 ? (
            <li>
              <EmptyState compact icon={MessagesSquare} title={t('noThreads')} description={canWrite ? t('noThreadsBody') : undefined} />
            </li>
          ) : (
            shown.map((th) => {
              const selected = th.id === activeId;
              return (
                <li key={th.id}>
                  <Link
                    href={`${basePath}thread=${th.id}`}
                    scroll={false}
                    className={cn('flex gap-3 px-3 py-3 transition-colors', selected ? 'bg-primary-soft/60' : 'hover:bg-surface-muted')}
                    aria-current={selected ? 'true' : undefined}
                    data-testid="thread-item"
                  >
                    {showClientName ? (
                      <Avatar name={localized(th.clientName, locale)} src={publicAssetUrl(th.clientLogo)} size="sm" square />
                    ) : (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-muted-foreground">
                        {th.visibility === 'internal' ? <Lock className="size-4" /> : <MessagesSquare className="size-4" />}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cn('min-w-0 flex-1 truncate text-sm', th.unread ? 'font-semibold' : 'font-medium')}>
                          {showClientName ? localized(th.clientName, locale) : th.title}
                        </span>
                        <span className="shrink-0 text-[0.6875rem] text-subtle-foreground">{f.relative(th.lastCommentAt)}</span>
                      </span>
                      {showClientName ? <span className="block truncate text-xs text-muted-foreground">{th.title}</span> : null}
                      <span className="mt-0.5 flex items-center gap-2">
                        <span dir="auto" className="min-w-0 flex-1 truncate text-start text-xs text-subtle-foreground">
                          {th.lastAuthorName ? `${th.lastAuthorName}: ` : ''}
                          {th.preview ? previewText(th.preview, 80) : ''}
                        </span>
                        {th.visibility === 'internal' && showClientName ? <Badge tone="warning">{t('internalThread')}</Badge> : null}
                        {th.unread ? (
                          <span
                            className="tabular flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.6875rem] font-semibold text-primary-foreground"
                            aria-label={t('unreadCount', { count: th.unread })}
                          >
                            {th.unread}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </aside>
      <section className={cn('min-h-0 min-w-0', !(activeId && active) && 'hidden md:block')}>
        {active ? (
          <Conversation key={active.thread.id} initial={active} me={me} side={side} canWrite={canWrite} backHref={listHref} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={MessagesSquare} title={t('selectThread')} description={t('selectThreadBody')} />
          </div>
        )}
      </section>
      <NewThreadDialog open={creating} onOpenChange={setCreating} clients={clients} side={side} basePath={basePath} />
    </Card>
  );
}
