'use client';

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCheck, Lock, MessagesSquare, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { DirIcon, EmptyState, FileTypeIcon } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Avatar, AvatarGroup, Badge, Tooltip } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { publicAssetUrl } from '@/lib/storage';
import { ensureRealtimeAuth, getSupabaseBrowserClient } from '@/lib/supabase/browser';
import { cn } from '@/lib/utils/cn';
import { DeleteDialog } from '@/modules/data/components/delete-dialog';
import { FilePreviewDialog } from '@/modules/files/components/file-preview';
import type { FileItem } from '@/modules/files/server/queries';
import { parseBody } from '@/modules/messaging/mentions';
import { Composer } from '@/modules/messaging/components/composer';
import { editCommentAction, loadThreadAction, markThreadReadAction, postCommentAction } from '@/modules/messaging/server/actions';
import type { CommentView, ThreadDetail } from '@/modules/messaging/server/queries';

function EditMessage({ initial, onCancel, onSave }: { initial: string; onCancel: () => void; onSave: (body: string) => Promise<void> }) {
  const t = useTranslations('messaging.own');
  const [body, setBody] = useState(initial);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="grid min-w-56 gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        await onSave(body.trim());
        setPending(false);
      }}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label={t('editLabel')}
        dir="auto"
        rows={3}
        maxLength={10000}
        className="bg-surface text-foreground"
        autoFocus
        onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onCancel())}
        data-testid="message-edit-input"
      />
      <span className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!body.trim()} loading={pending} data-testid="message-edit-save">
          {t('save')}
        </Button>
      </span>
    </form>
  );
}

function Body({ body, mine }: { body: string; mine: boolean }) {
  return (
    <p dir="auto" className="text-start text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap">
      {parseBody(body).map((seg, i) =>
        seg.type === 'text' ? (
          <Fragment key={i}>{seg.text}</Fragment>
        ) : (
          <span key={i} className={cn('rounded px-1 font-medium', mine ? 'bg-white/20' : 'bg-primary-soft text-primary-soft-foreground')}>
            @{seg.name}
          </span>
        ),
      )}
    </p>
  );
}

function Attachments({ files, onOpen }: { files: FileItem[]; onOpen: (f: FileItem) => void }) {
  const f = useFormat();
  if (!files.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {files.map((file) => (
        <button
          key={file.id}
          type="button"
          onClick={() => onOpen(file)}
          className="flex max-w-60 items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5 text-start text-foreground transition-colors hover:bg-surface-muted"
          data-testid="message-attachment"
        >
          <FileTypeIcon kind={file.kind} className="size-8" />
          <span className="min-w-0">
            <bdi className="block truncate text-xs font-medium">{file.name}</bdi>
            <span className="block text-[0.6875rem] text-subtle-foreground">{f.bytes(file.sizeBytes)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** A single conversation with realtime updates, read receipts and the composer. */
export function Conversation({
  initial,
  me,
  side,
  canWrite,
  backHref,
}: {
  initial: ThreadDetail;
  me: { userId: string };
  side: 'agency' | 'client';
  canWrite: boolean;
  /** Mobile "back to list" link; omitted when the conversation is embedded (e.g. on a request page). */
  backHref?: string;
}) {
  const t = useTranslations('messaging');
  const f = useFormat();
  const queryClient = useQueryClient();
  const router = useRouter();
  const threadId = initial.thread.id;
  const key = useMemo(() => ['thread', threadId] as const, [threadId]);
  const { data } = useQuery({
    queryKey: key,
    initialData: initial,
    queryFn: async () => {
      const res = await loadThreadAction({ threadId });
      if (!res.ok) throw new Error(res.error.code);
      return res.data;
    },
  });
  const [preview, setPreview] = useState<FileItem | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const post = useAction(postCommentAction, { refresh: false });

  // Realtime: new comments / read receipts in this thread (RLS filters what each user receives).
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    void ensureRealtimeAuth().then((supabase) => {
      if (cancelled) return;
      channel = supabase
        .channel(`thread:${threadId}:${crypto.randomUUID()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `thread_id=eq.${threadId}` }, () => {
          void queryClient.invalidateQueries({ queryKey: key });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'thread_reads', filter: `thread_id=eq.${threadId}` }, () => {
          void queryClient.invalidateQueries({ queryKey: key });
        })
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) void getSupabaseBrowserClient().removeChannel(channel);
    };
  }, [threadId, key, queryClient]);

  // Mark as read on open and whenever new messages arrive while the thread is open.
  const lastId = data.comments.at(-1)?.id;
  useEffect(() => {
    // Refresh server data (thread list unread counts) after recording the read receipt.
    void markThreadReadAction({ threadId }).then(() => router.refresh());
    // Scroll the message list only — never the page (the conversation can be embedded, e.g. on a request page).
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [threadId, lastId, router]);

  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const edit = useAction(editCommentAction, { refresh: false });

  const send = async (payload: { body: string; internal: boolean; attachmentIds: string[] }) => {
    const res = await post.run({ threadId, ...payload });
    if (res.ok) await queryClient.invalidateQueries({ queryKey: key });
    return res.ok;
  };

  // Read receipt under my latest message: who (other than me) has read past it.
  const myLast = [...data.comments].reverse().find((c) => c.authorId === me.userId);
  const seenBy = myLast ? data.reads.filter((r) => r.userId !== me.userId && r.lastReadAt >= myLast.createdAt) : [];

  const groups: { day: string; items: CommentView[] }[] = [];
  for (const c of data.comments) {
    const day = f.date(c.createdAt, 'long');
    const last = groups.at(-1);
    if (last && last.day === day) last.items.push(c);
    else groups.push({ day, items: [c] });
  }

  const others = data.participants.filter((p) => p.userId !== me.userId);
  const isInternalThread = data.thread.visibility === 'internal';

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="conversation">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        {backHref ? (
          <Button asChild variant="ghost" size="icon-sm" className="md:hidden" aria-label={t('backToList')}>
            <Link href={backHref}>
              <DirIcon icon={ArrowLeft} />
            </Link>
          </Button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate font-semibold">
            {data.thread.title}
            {isInternalThread ? (
              <Badge tone="warning">
                <Lock />
                {t('internalThread')}
              </Badge>
            ) : null}
          </h2>
          <p className="truncate text-xs text-subtle-foreground">{t('participants', { count: data.participants.length })}</p>
        </div>
        <AvatarGroup size="xs" max={5} people={others.map((p) => ({ id: p.userId, name: p.name, src: publicAssetUrl(p.avatarPath) }))} />
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {data.comments.length === 0 ? (
          <EmptyState icon={MessagesSquare} title={t('emptyThread')} description={t('emptyThreadBody')} />
        ) : (
          groups.map((g) => (
            <section key={g.day} className="mb-4">
              <div className="sticky top-0 z-10 my-3 flex justify-center">
                <span className="rounded-full border border-border bg-surface px-3 py-0.5 text-xs text-muted-foreground shadow-xs">
                  {g.day}
                </span>
              </div>
              <ol className="space-y-3">
                {g.items.map((c) => {
                  const mine = c.authorId === me.userId;
                  const internal = c.visibility === 'internal';
                  return (
                    <li
                      key={c.id}
                      className={cn('flex items-end gap-2', mine && 'flex-row-reverse')}
                      data-testid="message"
                      data-internal={internal || undefined}
                    >
                      {!mine ? <Avatar name={c.authorName} src={publicAssetUrl(c.authorAvatar)} size="sm" /> : null}
                      <div className={cn('max-w-[85%] sm:max-w-[70%]', mine && 'items-end text-end')}>
                        {!mine ? (
                          <p className="mb-1 flex items-center gap-1.5 text-xs text-subtle-foreground">
                            <span className="font-medium text-muted-foreground">{c.authorName}</span>
                            {side === 'client' && c.authorSide === 'agency' ? <Badge tone="brand">{t('agencyTeam')}</Badge> : null}
                            {side === 'agency' && c.authorSide === 'client' ? <Badge tone="info">{t('clientTeam')}</Badge> : null}
                          </p>
                        ) : null}
                        <div
                          className={cn(
                            'inline-block rounded-2xl px-3.5 py-2.5 text-start',
                            internal
                              ? 'border border-dashed border-warning/60 bg-warning-soft text-foreground'
                              : mine
                                ? 'rounded-ee-sm bg-primary text-primary-foreground'
                                : 'rounded-es-sm bg-surface-muted text-foreground',
                          )}
                        >
                          {internal ? (
                            <p className="mb-1 flex items-center gap-1 text-[0.6875rem] font-semibold text-warning">
                              <Lock className="size-3" aria-hidden />
                              {t('internalNote')}
                            </p>
                          ) : null}
                          {editing === c.id ? (
                            <EditMessage
                              initial={c.body}
                              onCancel={() => setEditing(null)}
                              onSave={async (body) => {
                                const res = await edit.run({ commentId: c.id, body });
                                if (res.ok) {
                                  setEditing(null);
                                  await queryClient.invalidateQueries({ queryKey: key });
                                }
                              }}
                            />
                          ) : (
                            <Body body={c.body} mine={mine && !internal} />
                          )}
                          <Attachments files={c.attachments} onOpen={setPreview} />
                        </div>
                        <p className={cn('mt-1 flex items-center gap-1 text-[0.6875rem] text-subtle-foreground', mine && 'justify-end')}>
                          <Tooltip content={f.dateTime(c.createdAt)}>
                            <time dateTime={c.createdAt}>{f.time(c.createdAt)}</time>
                          </Tooltip>
                          {c.editedAt ? <span>· {t('own.edited')}</span> : null}
                          {mine && canWrite ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="size-6"
                                  aria-label={t('own.actions')}
                                  data-testid="message-actions"
                                >
                                  <MoreHorizontal className="size-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => setEditing(c.id)} data-testid="message-edit">
                                  <Pencil />
                                  {t('own.edit')}
                                </DropdownMenuItem>
                                <DropdownMenuItem destructive onSelect={() => setDeleting(c.id)} data-testid="message-delete">
                                  <Trash2 />
                                  {t('own.delete')}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))
        )}
        {myLast && seenBy.length ? (
          <p className="flex items-center justify-end gap-1.5 text-xs text-subtle-foreground" data-testid="read-receipt">
            <CheckCheck className="size-3.5 text-primary" aria-hidden />
            {t('seenBy', { names: f.list(seenBy.map((s) => s.name)) })}
          </p>
        ) : null}
      </div>

      {deleting ? (
        <DeleteDialog
          type="comment"
          id={deleting}
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          onDeleted={() => void queryClient.invalidateQueries({ queryKey: key })}
        />
      ) : null}
      <div className="border-t border-border p-3">
        {canWrite ? (
          <Composer
            clientId={data.thread.clientId}
            threadId={threadId}
            participants={others}
            canInternal={side === 'agency'}
            forceInternal={isInternalThread}
            onSend={send}
          />
        ) : (
          <p className="rounded-lg bg-surface-muted px-4 py-3 text-center text-sm text-muted-foreground">{t('readOnly')}</p>
        )}
      </div>
      <FilePreviewDialog file={preview} onOpenChange={(o) => !o && setPreview(null)} />
    </div>
  );
}
