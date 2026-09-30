'use client';

import { MoreHorizontal, Pencil, Plus, Send, Sparkles, Trash2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';

import { DirIcon, EmptyState } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input, Textarea } from '@/components/ui/input';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { Badge, Card } from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { cn } from '@/lib/utils/cn';
import { askAssistantAction, deleteConversationAction, renameConversationAction } from '@/modules/ai/server/actions';
import type { AssistantMessage, ConversationSummary } from '@/modules/ai/server/assistant';
import type { Citation } from '@/modules/ai/types';

/** Answer text with `[n]` markers as links to the cited records; "- " lines become a list. */
function AnswerText({ text, citations, messageId }: { text: string; citations: Citation[]; messageId: string }) {
  const byN = new Map(citations.map((c) => [c.n, c]));
  const inline = (line: string, key: string): ReactNode[] =>
    line.split(/(\[\d+\])/g).map((part, i) => {
      const m = /^\[(\d+)\]$/.exec(part);
      const c = m ? byN.get(Number(m[1])) : null;
      if (!c) return <Fragment key={`${key}-${i}`}>{part}</Fragment>;
      return (
        <Link
          key={`${key}-${i}`}
          href={c.url}
          className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary-soft px-1 align-super text-[10px] font-semibold text-primary-soft-foreground hover:underline"
          title={c.title}
          data-testid="citation-marker"
        >
          {c.n}
        </Link>
      );
    });
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length)
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="ms-5 list-disc space-y-1">
          {list}
        </ul>,
      );
    list = [];
  };
  lines.forEach((l, i) => {
    const bullet = /^\s*(?:[-•*]|\d+\.)\s+(.*)$/.exec(l);
    if (bullet) list.push(<li key={`${messageId}-${i}`}>{inline(bullet[1]!, `${messageId}-${i}`)}</li>);
    else {
      flush();
      if (l.trim()) blocks.push(<p key={`${messageId}-${i}`}>{inline(l, `${messageId}-${i}`)}</p>);
    }
  });
  flush();
  return (
    <div dir="auto" className="flex flex-col gap-2 text-sm leading-relaxed">
      {blocks}
    </div>
  );
}

function Sources({ citations }: { citations: Citation[] }) {
  const t = useTranslations('ai.assistant');
  if (!citations.length) return null;
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2 text-xs font-medium text-subtle-foreground">{t('sources')}</p>
      <ol className="flex flex-col gap-1.5" data-testid="citations">
        {citations.map((c) => (
          <li key={c.n}>
            <Link href={c.url} className="group flex items-center gap-2 text-sm" data-testid="citation" data-source-type={c.sourceType}>
              <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary-soft text-[11px] font-semibold text-primary-soft-foreground">
                {c.n}
              </span>
              <Badge tone="outline">{t(`sourceType.${c.sourceType}`)}</Badge>
              <span className="min-w-0 truncate group-hover:underline">
                <bdi>{c.title}</bdi>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Bubble({ message }: { message: AssistantMessage }) {
  const t = useTranslations('ai.assistant');
  if (message.role === 'user') {
    return (
      <div className="flex justify-end" data-testid="message-user">
        <div
          className="max-w-[85%] rounded-2xl rounded-ee-sm bg-primary px-4 py-2.5 text-sm whitespace-pre-line text-primary-foreground"
          dir="auto"
        >
          {message.content}
        </div>
      </div>
    );
  }
  const problem = message.status !== 'ok';
  return (
    <div className="flex gap-3" data-testid="message-assistant" data-status={message.status}>
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
        <Sparkles className="size-4" aria-hidden />
      </span>
      <Card className={cn('min-w-0 flex-1 px-4 py-3', problem && 'border-warning/40 bg-warning-soft/40')}>
        {problem ? (
          <p className="flex items-start gap-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            {t(`status.${message.status}` as 'status.failed')}
          </p>
        ) : (
          <>
            <AnswerText text={message.content} citations={message.citations} messageId={message.id} />
            <Sources citations={message.citations} />
          </>
        )}
      </Card>
    </div>
  );
}

function ConversationMenu({ id, title }: { id: string; title: string }) {
  const t = useTranslations('ai.assistant');
  const tc = useTranslations('common');
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [value, setValue] = useState(title);
  const rename = useAction(renameConversationAction, { successMessage: t('renamed'), onSuccess: () => setRenaming(false) });
  const remove = useAction(deleteConversationAction, {
    successMessage: t('deleted'),
    refresh: false,
    onSuccess: () => router.push('/assistant'),
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={tc('moreActions')} data-testid="conversation-menu">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Pencil aria-hidden />
            {t('rename')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDeleting(true)} data-testid="conversation-delete">
            <Trash2 aria-hidden />
            {t('delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent closeLabel={tc('close')}>
          <DialogHeader>
            <DialogTitle>{t('rename')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Field label={t('titleLabel')}>
              {(p) => <Input {...p} value={value} maxLength={120} onChange={(e) => setValue(e.target.value)} />}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>
              {tc('cancel')}
            </Button>
            <Button loading={rename.pending} disabled={!value.trim()} onClick={() => rename.run({ conversationId: id, title: value })}>
              {tc('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('deleteTitle')}
        description={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={tc('cancel')}
        destructive
        onConfirm={() => remove.run({ conversationId: id })}
      />
    </>
  );
}

export function Assistant({
  conversations,
  conversation,
  usable,
}: {
  conversations: ConversationSummary[];
  conversation: { id: string; title: string; messages: AssistantMessage[] } | null;
  usable: boolean;
}) {
  const t = useTranslations('ai.assistant');
  const f = useFormat();
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  // Replies shown before the refreshed server data arrives, tied to the server's message count at the time.
  const serverCount = conversation?.messages.length ?? 0;
  const [extra, setExtra] = useState<{ base: number; items: AssistantMessage[] }>({ base: 0, items: [] });
  const endRef = useRef<HTMLDivElement>(null);
  const messages = [...(conversation?.messages ?? []), ...(extra.base === serverCount ? extra.items : [])];
  const ask = useAction(askAssistantAction, { refresh: false });

  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [messages.length, pending]);

  const send = async (text: string) => {
    const q = text.trim();
    if (q.length < 2 || ask.pending) return;
    setPending(q);
    setQuestion('');
    const res = await ask.run({ conversationId: conversation?.id, question: q });
    if (!res.ok) {
      setPending(null);
      setQuestion(q);
      return;
    }
    if (!conversation) {
      // A new conversation: its page takes over (the question stays on screen until it loads).
      router.push(`/assistant/${res.data.conversationId}`);
      return;
    }
    const at = res.data.message.createdAt;
    setExtra((e) => ({
      base: serverCount,
      items: [
        ...(e.base === serverCount ? e.items : []),
        { id: `q-${res.data.message.id}`, role: 'user', content: q, citations: [], status: 'ok', createdAt: at },
        res.data.message,
      ],
    }));
    setPending(null);
    router.refresh();
  };

  const suggestions = (['one', 'two', 'three', 'four'] as const).map((k) => t(`suggestions.${k}`));

  return (
    <div className="grid min-h-[calc(100dvh-12rem)] grid-cols-1 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col gap-2" aria-label={t('conversations')}>
        <Button asChild variant="outline" className="justify-start">
          <Link href="/assistant" data-testid="assistant-new">
            <Plus aria-hidden />
            {t('newChat')}
          </Link>
        </Button>
        <Card className="max-h-60 overflow-y-auto lg:max-h-[calc(100dvh-16rem)]">
          {conversations.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('noConversations')}</p>
          ) : (
            <ul className="divide-y divide-border" data-testid="conversation-list">
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/assistant/${c.id}`}
                    aria-current={c.id === conversation?.id ? 'page' : undefined}
                    className={cn(
                      'block px-4 py-2.5 text-sm hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none',
                      c.id === conversation?.id && 'bg-primary-soft text-primary-soft-foreground',
                    )}
                  >
                    <span className="block truncate font-medium" dir="auto">
                      {c.title}
                    </span>
                    <span className="text-xs text-subtle-foreground">{f.relative(c.lastMessageAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </aside>

      <section className="flex min-w-0 flex-col gap-4">
        {conversation ? (
          <div className="flex items-center justify-between gap-2">
            <h2 className="min-w-0 truncate text-h3 font-semibold" dir="auto">
              {conversation.title}
            </h2>
            <ConversationMenu id={conversation.id} title={conversation.title} />
          </div>
        ) : null}

        <div className="flex flex-1 flex-col gap-4" aria-live="polite">
          {messages.length === 0 && !pending ? (
            <Card>
              <EmptyState
                icon={Sparkles}
                title={t('emptyTitle')}
                description={t('emptyHint')}
                action={
                  usable ? (
                    <div className="grid max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                      {suggestions.map((s) => (
                        <Button
                          key={s}
                          variant="outline"
                          className="h-auto justify-start py-2 text-start whitespace-normal"
                          onClick={() => void send(s)}
                          data-testid="assistant-suggestion"
                        >
                          {s}
                        </Button>
                      ))}
                    </div>
                  ) : undefined
                }
              />
            </Card>
          ) : null}
          {messages.map((m) => (
            <Bubble key={m.id} message={m} />
          ))}
          {pending ? (
            <>
              <Bubble message={{ id: 'pending', role: 'user', content: pending, citations: [], status: 'ok', createdAt: '' }} />
              <div className="flex items-center gap-3 text-sm text-muted-foreground" data-testid="assistant-thinking">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
                  <Sparkles className="size-4 animate-pulse motion-reduce:animate-none" aria-hidden />
                </span>
                {t('thinking')}
              </div>
            </>
          ) : null}
          <div ref={endRef} />
        </div>

        {usable ? (
          <form
            className="sticky bottom-0 flex flex-col gap-1.5 bg-background pb-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(question);
            }}
          >
            <div className="flex items-end gap-2 rounded-xl border border-border bg-surface p-2 focus-within:ring-2 focus-within:ring-ring">
              <Textarea
                aria-label={t('placeholder')}
                placeholder={t('placeholder')}
                rows={2}
                maxLength={2000}
                value={question}
                dir="auto"
                className="min-h-0 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send(question);
                  }
                }}
                data-testid="assistant-input"
              />
              <Button
                type="submit"
                size="icon"
                loading={ask.pending}
                disabled={question.trim().length < 2}
                aria-label={t('send')}
                data-testid="assistant-send"
              >
                <DirIcon icon={Send} />
              </Button>
            </div>
            <p className="text-center text-xs text-subtle-foreground">{t('disclaimer')}</p>
          </form>
        ) : (
          <Card className="p-4 text-sm text-muted-foreground" data-testid="assistant-disabled">
            <p className="font-medium text-foreground">{t('notEnabled')}</p>
            <p>{t('notEnabledHint')}</p>
          </Card>
        )}
      </section>
    </div>
  );
}
