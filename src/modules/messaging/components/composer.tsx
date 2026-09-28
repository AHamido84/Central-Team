'use client';

import { AtSign, Loader2, Lock, Paperclip, SendHorizontal, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent } from 'react';

import { DirIcon, FileTypeIcon } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { Avatar, Switch, Tooltip } from '@/components/ui/primitives';
import { acceptAttribute, publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { useUpload } from '@/modules/files/components/use-upload';

export type Participant = { userId: string; name: string; avatarPath: string | null; side: 'agency' | 'client' };

/**
 * Message composer: @mentions (stored as `@[Name](id)`), attachments uploaded straight to Storage with
 * progress, and — for agency staff — an "internal note" toggle that hides the message from the client.
 */
export function Composer({
  clientId,
  threadId,
  participants,
  canInternal,
  forceInternal,
  onSend,
  disabled,
}: {
  clientId: string;
  threadId: string;
  participants: Participant[];
  canInternal: boolean;
  forceInternal: boolean;
  onSend: (payload: { body: string; internal: boolean; attachmentIds: string[] }) => Promise<boolean>;
  disabled?: boolean;
}) {
  const t = useTranslations('messaging');
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(forceInternal);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Mentions are kept in a side map (display name → id) and serialized on send.
  const mentionMap = useRef(new Map<string, string>());
  const uploads = useUpload();
  const attachments = uploads.items
    .filter((u) => u.status === 'done' && u.fileId)
    .map((u) => ({
      key: u.key,
      id: u.fileId!,
      name: u.name,
      kind: (u.mimeType.startsWith('image/') ? 'image' : u.mimeType.startsWith('video/') ? 'video' : u.mimeType === 'application/pdf' ? 'pdf' : 'document') as 'image' | 'video' | 'pdf' | 'document',
    }));
  const isInternal = forceInternal || internal;

  const matches = mentionQuery === null ? [] : participants.filter((p) => p.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6);

  const onChange = (value: string) => {
    setText(value);
    const caret = area.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    setMentionQuery(m ? m[2]! : null);
    setMentionIndex(0);
  };

  const insertMention = (p: Participant) => {
    const el = area.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.name} `);
    const next = before + text.slice(caret);
    mentionMap.current.set(p.name, p.userId);
    setText(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  };

  const serialize = (value: string) => {
    let out = value;
    for (const [name, id] of mentionMap.current) {
      out = out.split(`@${name}`).join(`@[${name}](${id})`);
    }
    return out.trim();
  };

  const send = async () => {
    const body = serialize(text);
    if (!body || sending || uploads.busy) return;
    setSending(true);
    const ok = await onSend({ body, internal: isInternal, attachmentIds: attachments.map((a) => a.id) });
    setSending(false);
    if (ok) {
      setText('');
      uploads.reset();
      mentionMap.current.clear();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(matches[mentionIndex]!);
        return;
      }
      if (e.key === 'Escape') {
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  };

  const attach = async (list: FileList | null) => {
    if (!list?.length) return;
    await uploads.upload(list, { clientId, folderId: null, threadId, visibility: isInternal ? 'internal' : 'client' });
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <div className={cn('relative rounded-xl border bg-surface shadow-xs transition-colors', isInternal ? 'border-warning/50 bg-warning-soft/40' : 'border-border')}>
      {matches.length ? (
        <ul className="absolute inset-x-2 bottom-full mb-2 overflow-hidden rounded-lg border border-border bg-surface-raised p-1 shadow-md" role="listbox" aria-label={t('mentionSomeone')}>
          {matches.map((p, i) => (
            <li key={p.userId} role="option" aria-selected={i === mentionIndex}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(p);
                }}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm', i === mentionIndex && 'bg-surface-muted')}
              >
                <Avatar name={p.name} src={publicAssetUrl(p.avatarPath)} size="xs" />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-xs text-subtle-foreground">{p.side === 'agency' ? t('agencyTeam') : t('clientTeam')}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {uploads.items.length ? (
        <div className="flex flex-wrap gap-2 border-b border-border p-2">
          {uploads.items
            .filter((u) => u.status !== 'done')
            .map((u) => (
              <span key={u.key} className={cn('inline-flex max-w-56 items-center gap-2 rounded-md border px-2 py-1 text-xs', u.status === 'error' ? 'border-danger/40 text-danger' : 'border-border')}>
                {u.status === 'uploading' ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                <bdi className="truncate">{u.name}</bdi>
                {u.status === 'uploading' ? <span className="tabular text-subtle-foreground">{Math.round(u.progress * 100)}%</span> : null}
              </span>
            ))}
          {attachments.map((a) => (
            <span key={a.id} className="inline-flex max-w-56 items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-xs" data-testid="composer-attachment">
              <FileTypeIcon kind={a.kind} className="size-5 rounded" />
              <bdi className="truncate">{a.name}</bdi>
              <button type="button" onClick={() => uploads.remove(a.key)} aria-label={t('removeAttachment')}>
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <textarea
        ref={area}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        disabled={disabled}
        placeholder={isInternal ? t('internalPlaceholder') : t('placeholder')}
        aria-label={t('placeholder')}
        className="field-sizing-content block max-h-60 min-h-16 w-full resize-none bg-transparent px-3 pt-3 text-[0.9375rem] outline-none placeholder:text-subtle-foreground"
        data-testid="composer-input"
      />
      <div className="flex items-center gap-1 p-2">
        <input ref={fileInput} type="file" multiple accept={acceptAttribute} className="sr-only" onChange={(e) => void attach(e.target.files)} />
        <Tooltip content={t('attach')}>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => fileInput.current?.click()} aria-label={t('attach')} disabled={disabled}>
            <Paperclip />
          </Button>
        </Tooltip>
        <Tooltip content={t('mentionSomeone')}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('mentionSomeone')}
            disabled={disabled}
            onClick={() => {
              onChange(`${text}${text && !text.endsWith(' ') ? ' ' : ''}@`);
              area.current?.focus();
            }}
          >
            <AtSign />
          </Button>
        </Tooltip>
        {canInternal ? (
          <label className={cn('ms-1 inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs font-medium', isInternal ? 'text-warning' : 'text-muted-foreground')}>
            <Switch checked={isInternal} onCheckedChange={setInternal} disabled={forceInternal || attachments.length > 0} aria-label={t('internalNote')} data-testid="composer-internal" />
            <Lock className="size-3.5" aria-hidden />
            {t('internalNote')}
          </label>
        ) : null}
        <span className="ms-auto hidden text-xs text-subtle-foreground sm:inline">{t('sendHint')}</span>
        <Button type="button" size="sm" onClick={() => void send()} loading={sending} disabled={!text.trim() || uploads.busy || disabled} data-testid="composer-send">
          {sending ? null : <DirIcon icon={SendHorizontal} />}
          {t('send')}
        </Button>
      </div>
    </div>
  );
}
