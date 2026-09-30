'use client';

import {
  ArrowUpRight,
  CheckCircle2,
  CheckSquare,
  Circle,
  Clock,
  ExternalLink,
  FileBox,
  GitBranch,
  Keyboard,
  Link2,
  History,
  Lock,
  MessageSquare,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { DirIcon, FileTypeIcon } from '@/components/patterns';
import { useFormat } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { ConfirmDialog, Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/overlays';
import {
  Avatar,
  Badge,
  Checkbox,
  Kbd,
  NativeSelect,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Tooltip,
} from '@/components/ui/primitives';
import { useAction } from '@/lib/actions/use-action';
import { localized, type Locale } from '@/lib/i18n/localized';
import { acceptAttribute, publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';
import { DeleteDialog } from '@/modules/data/components/delete-dialog';
import { DeliverableStatusBadge } from '@/modules/deliverables/components/badges';
import { createDeliverableAction } from '@/modules/deliverables/server/actions';
import { FilePreviewDialog } from '@/modules/files/components/file-preview';
import { useUpload } from '@/modules/files/components/use-upload';
import type { FileItem } from '@/modules/files/server/queries';
import { Conversation } from '@/modules/messaging/components/conversation';
import { FormattedText } from '@/modules/requests/components/brief-fields';
import { taskAccess, type TaskAccess, type TaskEditContext } from '@/modules/tasks/access';
import { TaskHistory } from '@/modules/tasks/components/task-history';
import { categoryIcon, DueDate, TaskRef, TaskStatusBadge, useDuration, type StatusOption } from '@/modules/tasks/components/badges';
import { PeoplePicker, type PersonOption } from '@/modules/tasks/components/people-picker';
import { useTaskDetail } from '@/modules/tasks/components/use-tasks';
import { MAX_TAGS, taskPriorities, type TaskPriority } from '@/modules/tasks/constants';
import type { TaskPatch } from '@/modules/tasks/schemas';
import {
  addChecklistItemAction,
  addManualTimeAction,
  addTaskAttachmentsAction,
  createTaskAction,
  deleteTimeEntryAction,
  removeTaskAttachmentAction,
  setDependencyAction,
  setTaskMembersAction,
  startTimerAction,
  stopTimerAction,
  updateChecklistItemAction,
} from '@/modules/tasks/server/actions';
import type { RunningTimer, TaskDetail, TaskListItem } from '@/modules/tasks/server/queries';
import { deliverableTypes, type DeliverableType } from '@/modules/workflows/constants';

export type DrawerContext = {
  me: string;
  today: string;
  statuses: StatusOption[];
  people: PersonOption[];
  departments: { id: string; name: import('@/lib/i18n/localized').LocalizedText }[];
  allTasks: TaskListItem[];
  canUpdate: boolean;
  canDelete: boolean;
  canCreate: boolean;
  canManageDeliverables: boolean;
  /** Per-field edit rule (ADR-084); `canUpdate` above is narrowed per task from it. */
  edit: TaskEditContext;
  timer: RunningTimer;
  onTimerChange: (timer: RunningTimer) => void;
  onPatch: (taskId: string, patch: TaskPatch) => Promise<boolean>;
  onRefresh: (taskId: string) => void;
};

function Section({
  icon: Icon,
  title,
  action,
  children,
  testId,
}: {
  icon: typeof Clock;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="grid gap-2 border-t border-border px-5 py-4" data-testid={testId}>
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-subtle-foreground" aria-hidden />
        <h3 className="me-auto text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Prop({ label, children, locked }: { label: string; children: ReactNode; locked?: string | null }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 text-sm" data-locked={locked ? true : undefined}>
      <span className="flex items-center gap-1 text-muted-foreground">
        {label}
        {locked ? (
          <Tooltip content={locked}>
            <span
              tabIndex={0}
              className="rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              data-testid="field-locked"
            >
              <Lock className="size-3 text-subtle-foreground" aria-label={locked} />
            </span>
          </Tooltip>
        ) : null}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Unsaved edits inside the drawer register here so closing it can ask "discard changes?" first. */
const DirtyContext = createContext<((key: string, dirty: boolean) => void) | null>(null);

function useDirty(key: string, dirty: boolean) {
  const set = useContext(DirtyContext);
  useEffect(() => {
    set?.(key, dirty);
    return () => set?.(key, false);
  }, [set, key, dirty]);
}

function TitleEditor({
  task,
  ctx,
  editing,
  setEditing,
}: {
  task: TaskDetail;
  ctx: DrawerContext;
  editing: boolean;
  setEditing: (on: boolean) => void;
}) {
  const t = useTranslations('tasks');
  const [value, setValue] = useState(task.title);
  useDirty('title', editing && value.trim() !== task.title);
  if (editing && ctx.canUpdate) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() && value.trim() !== task.title) void ctx.onPatch(task.id, { title: value.trim() });
          setEditing(false);
        }}
      >
        <Input
          dir="auto"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(false);
            }
          }}
          autoFocus
          maxLength={200}
          aria-label={t('fields.title')}
          className="text-base font-semibold"
          data-testid="drawer-title-input"
        />
      </form>
    );
  }
  return (
    <button
      type="button"
      className="group w-full text-start text-lg leading-snug font-semibold disabled:cursor-default"
      onClick={() => {
        setValue(task.title);
        setEditing(true);
      }}
      disabled={!ctx.canUpdate}
      data-testid="drawer-title"
    >
      <bdi>{task.title}</bdi>
      {ctx.canUpdate ? (
        <Pencil className="ms-2 inline size-3.5 text-subtle-foreground opacity-0 group-hover:opacity-100" aria-hidden />
      ) : null}
    </button>
  );
}

function Description({ task, ctx }: { task: TaskDetail; ctx: DrawerContext }) {
  const t = useTranslations('tasks');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(task.description);
  useDirty('description', editing && value !== task.description);
  if (editing) {
    return (
      <div className="grid gap-2">
        <Textarea
          dir="auto"
          rows={6}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          aria-label={t('fields.description')}
          data-testid="drawer-description-input"
        />
        <p className="text-xs text-subtle-foreground">{t('markdownHint')}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => (setValue(task.description), setEditing(false))}>
            {t('cancel')}
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              if (await ctx.onPatch(task.id, { description: value })) setEditing(false);
            }}
            data-testid="drawer-description-save"
          >
            {t('save')}
          </Button>
        </div>
      </div>
    );
  }
  return task.description ? (
    <div className="grid gap-1">
      <div className="text-sm" dir="auto">
        <FormattedText text={task.description} />
      </div>
      {ctx.canUpdate ? (
        <Button variant="link" size="sm" className="justify-self-start" onClick={() => setEditing(true)}>
          {t('editDescription')}
        </Button>
      ) : null}
    </div>
  ) : ctx.canUpdate ? (
    <button
      type="button"
      className="rounded-lg border border-dashed border-border px-3 py-3 text-start text-sm text-subtle-foreground hover:bg-surface-muted"
      onClick={() => setEditing(true)}
    >
      {t('addDescription')}
    </button>
  ) : (
    <p className="text-sm text-subtle-foreground">{t('noDescription')}</p>
  );
}

function Tags({ task, ctx }: { task: TaskDetail; ctx: DrawerContext }) {
  const t = useTranslations('tasks');
  const [value, setValue] = useState('');
  useDirty('tag', value.trim() !== '');
  const add = () => {
    const tag = value.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 30);
    setValue('');
    if (!tag || task.tags.includes(tag) || task.tags.length >= MAX_TAGS) return;
    void ctx.onPatch(task.id, { tags: [...task.tags, tag] });
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {task.tags.map((tag) => (
        <Badge key={tag} tone="outline" className="gap-0.5">
          <bdi>{`#${tag}`}</bdi>
          {ctx.canUpdate ? (
            <button
              type="button"
              onClick={() => void ctx.onPatch(task.id, { tags: task.tags.filter((x) => x !== tag) })}
              aria-label={t('removeTag', { tag })}
            >
              <X />
            </button>
          ) : null}
        </Badge>
      ))}
      {ctx.canUpdate && task.tags.length < MAX_TAGS ? (
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder={t('addTag')}
          aria-label={t('addTag')}
          className="h-7 w-28 text-xs"
        />
      ) : null}
    </div>
  );
}

function Checklist({ task, ctx }: { task: TaskDetail; ctx: DrawerContext }) {
  const t = useTranslations('tasks');
  const [body, setBody] = useState('');
  useDirty('checklist', body.trim() !== '');
  const add = useAction(addChecklistItemAction, { refresh: false });
  const update = useAction(updateChecklistItemAction, { refresh: false });
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const done = task.checklistItems.filter((i) => i.isDone).length;
  return (
    <Section
      icon={CheckSquare}
      title={t('checklist')}
      testId="drawer-checklist"
      action={
        task.checklistItems.length ? (
          <span className="tabular text-xs text-muted-foreground">{t('fraction', { done, total: task.checklistItems.length })}</span>
        ) : null
      }
    >
      <ul className="grid gap-1">
        {task.checklistItems.map((item) => (
          <li key={item.id} className="group flex items-center gap-2 rounded px-1 py-0.5 hover:bg-surface-muted/60">
            <Checkbox
              checked={item.isDone}
              disabled={!ctx.canUpdate}
              onCheckedChange={async (v) => {
                const res = await update.run({ itemId: item.id, isDone: v === true });
                if (res.ok) ctx.onRefresh(task.id);
              }}
              aria-label={item.body}
              data-testid="checklist-item"
            />
            {editingItem === item.id ? (
              <Input
                dir="auto"
                defaultValue={item.body}
                autoFocus
                maxLength={500}
                aria-label={t('editItem')}
                className="h-7 flex-1 text-sm"
                data-testid="checklist-edit-input"
                onKeyDown={async (e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setEditingItem(null);
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const value = e.currentTarget.value.trim();
                    if (value && value !== item.body) {
                      const res = await update.run({ itemId: item.id, body: value });
                      if (res.ok) ctx.onRefresh(task.id);
                    }
                    setEditingItem(null);
                  }
                }}
                onBlur={() => setEditingItem(null)}
              />
            ) : (
              <span className={cn('min-w-0 flex-1 text-sm', item.isDone && 'text-muted-foreground line-through')} dir="auto">
                {item.body}
              </span>
            )}
            {ctx.canUpdate && editingItem !== item.id ? (
              <button
                type="button"
                className="rounded p-0.5 text-subtle-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => setEditingItem(item.id)}
                aria-label={t('editItem')}
                data-testid="checklist-edit"
              >
                <Pencil className="size-3.5" />
              </button>
            ) : null}
            {ctx.canUpdate ? (
              <button
                type="button"
                className="rounded p-0.5 text-subtle-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={async () => {
                  const res = await update.run({ itemId: item.id, remove: true });
                  if (res.ok) ctx.onRefresh(task.id);
                }}
                aria-label={t('removeItem')}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {ctx.canUpdate ? (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!body.trim()) return;
            const res = await add.run({ taskId: task.id, body: body.trim() });
            if (res.ok) {
              setBody('');
              ctx.onRefresh(task.id);
            }
          }}
        >
          <Input
            dir="auto"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('addItem')}
            aria-label={t('addItem')}
            className="h-8"
            data-testid="checklist-input"
          />
          <Button type="submit" size="sm" variant="soft" disabled={!body.trim()} loading={add.pending}>
            <Plus />
          </Button>
        </form>
      ) : null}
    </Section>
  );
}

function Subtasks({ task, ctx, onOpen }: { task: TaskDetail; ctx: DrawerContext; onOpen: (id: string) => void }) {
  const t = useTranslations('tasks');
  const [title, setTitle] = useState('');
  const create = useAction(createTaskAction, { refresh: false });
  const doneStatus = ctx.statuses.find((s) => s.category === 'done');
  const todoStatus = ctx.statuses.find((s) => s.category === 'todo');
  return (
    <Section icon={GitBranch} title={t('subtasks')} testId="drawer-subtasks">
      <ul className="grid gap-1">
        {task.subtaskItems.map((s) => {
          const done = s.statusCategory === 'done';
          const Icon = done ? CheckCircle2 : Circle;
          return (
            <li key={s.id} className="flex items-center gap-2">
              <button
                type="button"
                disabled={!ctx.canUpdate}
                aria-pressed={done}
                aria-label={done ? t('markNotDone') : t('markDone')}
                onClick={async () => {
                  const target = done ? todoStatus : doneStatus;
                  if (target && (await ctx.onPatch(s.id, { statusId: target.id }))) ctx.onRefresh(task.id);
                }}
                className={cn('rounded-full', done ? 'text-success' : 'text-subtle-foreground hover:text-foreground')}
              >
                <Icon className="size-4" />
              </button>
              <button
                type="button"
                className={cn('min-w-0 flex-1 truncate text-start text-sm hover:underline', done && 'text-muted-foreground line-through')}
                onClick={() => onOpen(s.id)}
              >
                <bdi>{s.title}</bdi>
              </button>
              {s.assignees[0] ? <Avatar name={s.assignees[0].name} src={publicAssetUrl(s.assignees[0].avatarPath)} size="xs" /> : null}
            </li>
          );
        })}
      </ul>
      {ctx.canCreate && !task.parentId ? (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            const res = await create.run({ clientId: task.clientId, parentId: task.id, title: title.trim(), assigneeIds: [ctx.me] });
            if (res.ok) {
              setTitle('');
              ctx.onRefresh(task.id);
            }
          }}
        >
          <Input
            dir="auto"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('addSubtask')}
            aria-label={t('addSubtask')}
            className="h-8"
            data-testid="subtask-input"
          />
          <Button type="submit" size="sm" variant="soft" disabled={!title.trim()} loading={create.pending}>
            <Plus />
          </Button>
        </form>
      ) : null}
    </Section>
  );
}

function Dependencies({ task, ctx, onOpen }: { task: TaskDetail; ctx: DrawerContext; onOpen: (id: string) => void }) {
  const t = useTranslations('tasks');
  const setDep = useAction(setDependencyAction, { refresh: false });
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const exclude = new Set([task.id, ...task.blockedBy.map((b) => b.id), ...task.blocking.map((b) => b.id)]);
  const candidates = ctx.allTasks
    .filter((x) => x.clientId === task.clientId && !exclude.has(x.id) && !x.parentId)
    .filter((x) => !q || `${x.title} t-${x.number}`.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 30);
  const Row = ({ item, remove }: { item: TaskDetail['blockedBy'][number]; remove?: () => void }) => {
    const Icon = categoryIcon[item.statusCategory];
    return (
      <li className="flex items-center gap-2 text-sm">
        <Icon className={cn('size-4', item.statusCategory === 'done' ? 'text-success' : 'text-subtle-foreground')} aria-hidden />
        <TaskRef number={item.number} />
        <button type="button" className="min-w-0 flex-1 truncate text-start hover:underline" onClick={() => onOpen(item.id)}>
          <bdi>{item.title}</bdi>
        </button>
        {remove && ctx.canUpdate ? (
          <button
            type="button"
            onClick={remove}
            aria-label={t('removeDependency')}
            className="rounded p-0.5 text-subtle-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </li>
    );
  };
  return (
    <Section
      icon={Link2}
      title={t('dependencies')}
      testId="drawer-dependencies"
      action={
        ctx.canUpdate ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" data-testid="add-dependency">
                <Plus />
                {t('addBlocker')}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-2">
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('searchTasks')}
                aria-label={t('searchTasks')}
                autoFocus
                className="mb-2"
              />
              <ul className="max-h-60 overflow-y-auto">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-surface-muted"
                      onClick={async () => {
                        const res = await setDep.run({ taskId: task.id, dependsOnId: c.id });
                        if (res.ok) {
                          setOpen(false);
                          ctx.onRefresh(task.id);
                        }
                      }}
                    >
                      <TaskRef number={c.number} />
                      <span className="min-w-0 flex-1 truncate">
                        <bdi>{c.title}</bdi>
                      </span>
                    </button>
                  </li>
                ))}
                {candidates.length === 0 ? (
                  <li className="px-2 py-3 text-center text-sm text-subtle-foreground">{t('noCandidates')}</li>
                ) : null}
              </ul>
            </PopoverContent>
          </Popover>
        ) : null
      }
    >
      {task.blockedBy.length === 0 && task.blocking.length === 0 ? (
        <p className="text-sm text-subtle-foreground">{t('noDependencies')}</p>
      ) : null}
      {task.blockedBy.length ? (
        <div className="grid gap-1">
          <p className="text-xs font-medium text-muted-foreground">{t('blockedBy')}</p>
          <ul className="grid gap-1">
            {task.blockedBy.map((b) => (
              <Row
                key={b.id}
                item={b}
                remove={async () => {
                  const res = await setDep.run({ taskId: task.id, dependsOnId: b.id, remove: true });
                  if (res.ok) ctx.onRefresh(task.id);
                }}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {task.blocking.length ? (
        <div className="grid gap-1">
          <p className="text-xs font-medium text-muted-foreground">{t('blocking')}</p>
          <ul className="grid gap-1">
            {task.blocking.map((b) => (
              <Row key={b.id} item={b} />
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

function Deliverables({ task, ctx }: { task: TaskDetail; ctx: DrawerContext }) {
  const t = useTranslations();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<DeliverableType>('design');
  const create = useAction(createDeliverableAction, { refresh: false });
  return (
    <Section
      icon={FileBox}
      title={t('tasks.deliverables')}
      testId="drawer-deliverables"
      action={
        ctx.canManageDeliverables && !adding ? (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)} data-testid="add-deliverable">
            <Plus />
            {t('tasks.addDeliverable')}
          </Button>
        ) : null
      }
    >
      {task.deliverables.length === 0 && !adding ? <p className="text-sm text-subtle-foreground">{t('tasks.noDeliverables')}</p> : null}
      <ul className="grid gap-2">
        {task.deliverables.map((d) => (
          <li key={d.id}>
            <Link
              href={`/deliverables/${d.id}`}
              className="flex items-center gap-3 rounded-lg border border-border p-2.5 hover:bg-surface-muted"
              data-testid="drawer-deliverable"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  <bdi>{d.title}</bdi>
                </span>
                <span className="text-xs text-subtle-foreground">
                  {t(`workflows.deliverableTypes.${d.type}`)} · {t('tasks.versions', { count: d.versionCount })}
                </span>
              </span>
              <DeliverableStatusBadge status={d.status} compact />
              <DirIcon icon={ArrowUpRight} className="size-4 text-subtle-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      {adding ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await create.run({
              taskId: task.id,
              type,
              title: task.title,
              requiresInternalReview: true,
              requiresClientApproval: true,
            });
            if (res.ok) {
              setAdding(false);
              ctx.onRefresh(task.id);
            }
          }}
        >
          <NativeSelect
            value={type}
            onChange={(e) => setType(e.target.value as DeliverableType)}
            aria-label={t('tasks.deliverableType')}
            className="h-8 w-40"
          >
            {deliverableTypes.map((d) => (
              <option key={d} value={d}>
                {t(`workflows.deliverableTypes.${d}`)}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" size="sm" loading={create.pending}>
            {t('tasks.createDeliverable')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
            {t('common.cancel')}
          </Button>
        </form>
      ) : null}
    </Section>
  );
}

function Attachments({ task, ctx }: { task: TaskDetail; ctx: DrawerContext }) {
  const t = useTranslations('tasks');
  const f = useFormat();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<FileItem | null>(null);
  const link = useAction(addTaskAttachmentsAction, { refresh: false });
  const remove = useAction(removeTaskAttachmentAction, { refresh: false });
  const uploads = useUpload();
  const threadId = task.thread?.thread.id ?? null;
  return (
    <Section
      icon={Paperclip}
      title={t('attachments')}
      testId="drawer-attachments"
      action={
        ctx.canUpdate && threadId ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => input.current?.click()} loading={uploads.busy}>
              <Plus />
              {t('addAttachment')}
            </Button>
            <input
              ref={input}
              type="file"
              multiple
              accept={acceptAttribute}
              className="sr-only"
              data-testid="task-attachment-input"
              onChange={async (e) => {
                const list = e.target.files;
                if (!list?.length) return;
                const ids = await uploads.upload(list, { clientId: task.clientId, folderId: null, threadId, visibility: 'internal' });
                uploads.reset();
                if (input.current) input.current.value = '';
                if (ids.length && (await link.run({ taskId: task.id, fileIds: ids })).ok) ctx.onRefresh(task.id);
              }}
            />
          </>
        ) : null
      }
    >
      {uploads.items.map((u) => (
        <p key={u.key} className="text-xs text-muted-foreground">
          {u.name} · {f.percent(u.progress)}
        </p>
      ))}
      {task.attachments.length === 0 ? <p className="text-sm text-subtle-foreground">{t('noAttachments')}</p> : null}
      <ul className="grid gap-2 sm:grid-cols-2">
        {task.attachments.map((file) => (
          <li key={file.id} className="group flex items-center gap-2 rounded-lg border border-border p-2">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-start" onClick={() => setPreview(file)}>
              {file.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                <img src={file.thumbUrl} alt="" className="size-9 rounded object-cover" />
              ) : (
                <FileTypeIcon kind={file.kind} className="size-9" />
              )}
              <span className="min-w-0">
                <bdi className="block truncate text-xs font-medium">{file.name}</bdi>
                <span className="text-[0.6875rem] text-subtle-foreground">{f.bytes(file.sizeBytes)}</span>
              </span>
            </button>
            {ctx.canUpdate ? (
              <button
                type="button"
                className="rounded p-1 text-subtle-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={t('removeAttachment')}
                onClick={async () => {
                  if ((await remove.run({ taskId: task.id, fileId: file.id })).ok) ctx.onRefresh(task.id);
                }}
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <FilePreviewDialog file={preview} onOpenChange={(o) => !o && setPreview(null)} />
    </Section>
  );
}

function TimeTracking({ task, ctx }: { task: TaskDetail; ctx: DrawerContext }) {
  const t = useTranslations('tasks');
  const f = useFormat();
  const start = useAction(startTimerAction, { refresh: false });
  const stop = useAction(stopTimerAction, { refresh: false });
  const manual = useAction(addManualTimeAction, { refresh: false, successMessage: t('time.added') });
  const del = useAction(deleteTimeEntryAction, { refresh: false });
  const [now, setNow] = useState(() => Date.now());
  const [adding, setAdding] = useState(false);
  const [minutes, setMinutes] = useState('30');
  const [date, setDate] = useState(ctx.today);
  const [note, setNote] = useState('');
  const running = ctx.timer?.taskId === task.id ? ctx.timer : null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  const hm = useDuration();
  const elapsed = running ? Math.max(0, Math.floor((now - new Date(running.startedAt).getTime()) / 1000)) : 0;
  const clock = `${String(Math.floor(elapsed / 3600)).padStart(2, '0')}:${String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  return (
    <Section icon={Clock} title={t('time.title')} testId="drawer-time">
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button
            variant="destructive"
            size="sm"
            loading={stop.pending}
            onClick={async () => {
              const res = await stop.run({});
              if (res.ok) {
                ctx.onTimerChange(null);
                ctx.onRefresh(task.id);
              }
            }}
            data-testid="timer-stop"
          >
            <Pause />
            <span dir="ltr" className="tabular">
              {clock}
            </span>
          </Button>
        ) : (
          <Button
            variant="soft"
            size="sm"
            loading={start.pending}
            onClick={async () => {
              const res = await start.run({ taskId: task.id });
              if (res.ok) {
                ctx.onTimerChange({
                  id: res.data.entryId,
                  taskId: task.id,
                  taskNumber: task.number,
                  taskTitle: task.title,
                  startedAt: res.data.startedAt,
                });
                ctx.onRefresh(task.id);
              }
            }}
            data-testid="timer-start"
          >
            <Play />
            {t('time.start')}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setAdding((a) => !a)} data-testid="time-add">
          <Plus />
          {t('time.addManual')}
        </Button>
        <span className="ms-auto text-xs text-muted-foreground" data-testid="time-total">
          {t('time.total', { total: hm(task.time.totalMinutes), mine: hm(task.time.myMinutes) })}
          {task.estimateMinutes ? ` · ${t('time.estimate', { estimate: hm(task.estimateMinutes) })}` : ''}
        </span>
      </div>
      {adding ? (
        <form
          className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[8rem_7rem_minmax(0,1fr)_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await manual.run({ taskId: task.id, date, minutes: Number(minutes), note: note || undefined });
            if (res.ok) {
              setAdding(false);
              setNote('');
              ctx.onRefresh(task.id);
            }
          }}
        >
          <Input
            type="date"
            dir="ltr"
            value={date}
            max={ctx.today}
            onChange={(e) => setDate(e.target.value)}
            aria-label={t('time.date')}
            className="h-8"
          />
          <Input
            type="number"
            dir="ltr"
            min={1}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            aria-label={t('time.minutes')}
            className="h-8"
            data-testid="time-minutes"
          />
          <Input
            dir="auto"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('time.note')}
            aria-label={t('time.note')}
            className="h-8"
          />
          <Button type="submit" size="sm" loading={manual.pending} data-testid="time-save">
            {t('save')}
          </Button>
        </form>
      ) : null}
      {task.time.entries.length ? (
        <ul className="grid gap-1" data-testid="time-entries">
          {task.time.entries.slice(0, 8).map((e) => (
            <li key={e.id} className="group flex items-center gap-2 text-xs">
              <Avatar name={e.user.name} src={publicAssetUrl(e.user.avatarPath)} size="xs" />
              <span className="min-w-0 flex-1 truncate">
                {e.user.name}
                {e.note ? <span className="text-subtle-foreground"> · {e.note}</span> : null}
              </span>
              <span className="text-subtle-foreground">{f.date(e.startedAt, 'short')}</span>
              <span className="tabular w-16 text-end font-medium">{e.endedAt ? hm(e.minutes) : t('time.running')}</span>
              {e.user.id === ctx.me && e.endedAt ? (
                <button
                  type="button"
                  className="rounded p-0.5 text-subtle-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={t('time.delete')}
                  onClick={async () => {
                    if ((await del.run({ entryId: e.id })).ok) ctx.onRefresh(task.id);
                  }}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!task.time.canSeeAll ? <p className="text-[0.6875rem] text-subtle-foreground">{t('time.onlyMine')}</p> : null}
    </Section>
  );
}

function Shortcuts() {
  const t = useTranslations('tasks.shortcuts');
  const rows: [string, string][] = [
    ['J / K', t('next')],
    ['E', t('edit')],
    ['C', t('comment')],
    ['D', t('done')],
    ['Esc', t('close')],
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('title')}>
          <Keyboard />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-3">
        <p className="mb-2 text-sm font-semibold">{t('title')}</p>
        <dl className="grid gap-1.5 text-sm">
          {rows.map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-2">
              <dt>{label}</dt>
              <dd>
                <Kbd>{k}</Kbd>
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Task detail as a side drawer. Keyboard: J/K previous/next task in the current view, E edit title, C comment,
 * D toggle done, Esc close. Edits are optimistic; realtime changes from teammates refresh it in place.
 */
export function TaskDrawer({
  taskId,
  onClose,
  onOpen,
  order,
  ctx,
}: {
  taskId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  order: string[];
  ctx: DrawerContext;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const { data: task, isLoading, isError } = useTaskDetail(taskId);
  // Full access edits every field; limited (your own task) only the status and the checklist (ADR-084).
  const access: TaskAccess = task ? taskAccess(task, ctx.edit) : 'none';
  const baseCtx = ctx;
  const full = useMemo(() => ({ ...baseCtx, canUpdate: access === 'full' }), [baseCtx, access]);
  const own = useMemo(() => ({ ...baseCtx, canUpdate: access !== 'none' }), [baseCtx, access]);
  const locked = access === 'full' ? null : access === 'limited' ? t('tasks.access.limited') : t('tasks.access.none');
  const setMembers = useAction(setTaskMembersAction, { refresh: false });
  const [deleting, setDeleting] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const status = task ? ctx.statuses.find((s) => s.id === task.statusId) : undefined;

  // Unsaved edits → "discard changes?" before the drawer closes or switches to another task.
  const dirty = useRef(new Map<string, boolean>());
  const setDirty = useCallback((key: string, value: boolean) => void dirty.current.set(key, value), []);
  const [pending, setPending] = useState<{ open: string | null } | null>(null);
  const guard = (next: string | null) => {
    if ([...dirty.current.values()].some(Boolean)) setPending({ open: next });
    else if (next) onOpen(next);
    else onClose();
  };
  const requestClose = () => guard(null);
  const openOther = (id: string) => guard(id);

  // Focus goes back to the row / card that opened the task.
  const lastId = useRef<string | null>(null);
  useEffect(() => {
    if (taskId) lastId.current = taskId;
  }, [taskId]);

  // Swipe towards the edge the drawer came from closes it (touch devices).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const p = e.touches[0];
    touch.current = p ? { x: p.clientX, y: p.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    const p = e.changedTouches[0];
    touch.current = null;
    if (!start || !p) return;
    const dx = p.clientX - start.x;
    const dy = p.clientY - start.y;
    const towardsEdge = document.documentElement.dir === 'rtl' ? -dx : dx;
    if (towardsEdge > 80 && Math.abs(dy) < Math.abs(dx) * 0.6) requestClose();
  };
  const doneStatus = ctx.statuses.find((s) => s.category === 'done');
  const reopenStatus = ctx.statuses.find((s) => s.category === 'active') ?? ctx.statuses[0];

  const toggleDone = useMemo(
    () => () => {
      if (!task || access === 'none') return;
      const target = task.statusCategory === 'done' ? reopenStatus : doneStatus;
      if (target) void ctx.onPatch(task.id, { statusId: target.id });
    },
    [task, ctx, access, doneStatus, reopenStatus],
  );

  useEffect(() => {
    if (!taskId) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const i = order.indexOf(taskId);
      if ((e.key === 'j' || e.key === 'J') && i >= 0 && i < order.length - 1) openOther(order[i + 1]!);
      else if ((e.key === 'k' || e.key === 'K') && i > 0) openOther(order[i - 1]!);
      else if (e.key === 'e' || e.key === 'E') setEditingTitle(true);
      else if (e.key === 'd' || e.key === 'D') toggleDone();
      else if (e.key === 'c' || e.key === 'C')
        document.querySelector<HTMLTextAreaElement>('[data-testid="task-drawer"] [data-testid="composer-input"]')?.focus();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openOther reads refs; re-binding per render is unnecessary
  }, [taskId, order, onOpen, toggleDone]);

  const members = (role: 'assignee' | 'watcher') => async (ids: string[]) => {
    if (!task) return;
    const res = await setMembers.run({ taskId: task.id, role, userIds: ids });
    if (res.ok) ctx.onRefresh(task.id);
  };

  return (
    <DirtyContext.Provider value={setDirty}>
      <Sheet open={Boolean(taskId)} onOpenChange={(o) => !o && requestClose()}>
        <SheetContent
          closeLabel={t('common.close')}
          className="w-[min(100vw,40rem)] p-0"
          data-testid="task-drawer"
          aria-describedby={undefined}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const id = lastId.current;
            if (id) document.querySelector<HTMLElement>(`[data-task-focus="${id}"]`)?.focus();
          }}
        >
          {!task ? (
            <div className="grid gap-3 p-5">
              <SheetTitle className="sr-only">{t('tasks.loading')}</SheetTitle>
              {isError ? (
                <p className="text-sm text-danger">{t('tasks.loadFailed')}</p>
              ) : isLoading ? (
                <>
                  <Skeleton className="h-6 w-2/3" />
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-32 w-full" />
                </>
              ) : null}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-task-id={task.id}>
              <div className="grid gap-3 px-5 pe-12 pt-5 pb-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-subtle-foreground">
                  <TaskRef number={task.number} />
                  {task.parentId ? (
                    <button type="button" className="hover:underline" onClick={() => openOther(task.parentId!)}>
                      {t('tasks.parentTask')}
                    </button>
                  ) : null}
                  {task.requestId ? (
                    <Link href={`/requests/${task.requestId}`} className="inline-flex items-center gap-1 hover:underline">
                      <ExternalLink className="size-3" aria-hidden />
                      <bdi dir="ltr">{task.requestReference}</bdi>
                    </Link>
                  ) : null}
                  {task.stepName ? <Badge tone="outline">{localized(task.stepName, locale)}</Badge> : null}
                  {task.requestId && !task.fromWorkflow ? (
                    <Badge tone="warning" data-testid="drawer-outside-workflow">
                      {t('tasks.requestWork.outsideWorkflow')}
                    </Badge>
                  ) : null}
                </div>
                <SheetTitle asChild>
                  <div>
                    <TitleEditor key={task.id} task={task} ctx={full} editing={editingTitle} setEditing={setEditingTitle} />
                  </div>
                </SheetTitle>
                <SheetDescription className="sr-only">{localized(task.clientName, locale)}</SheetDescription>
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect
                    value={task.statusId}
                    disabled={!own.canUpdate}
                    onChange={(e) => void ctx.onPatch(task.id, { statusId: e.target.value })}
                    aria-label={t('tasks.fields.status')}
                    className="h-8 w-auto text-sm"
                    data-testid="drawer-status"
                  >
                    {ctx.statuses.map((s) => (
                      <option key={s.id} value={s.id}>
                        {localized(s.name, locale)}
                      </option>
                    ))}
                  </NativeSelect>
                  <NativeSelect
                    value={task.priority}
                    disabled={!full.canUpdate}
                    onChange={(e) => void ctx.onPatch(task.id, { priority: e.target.value as TaskPriority })}
                    aria-label={t('tasks.fields.priority')}
                    className="h-8 w-auto text-sm"
                    data-testid="drawer-priority"
                  >
                    {taskPriorities.map((p) => (
                      <option key={p} value={p}>
                        {t(`requests.priorities.${p}`)}
                      </option>
                    ))}
                  </NativeSelect>
                  <TaskStatusBadge status={status} className="hidden sm:inline-flex" />
                  <span className="ms-auto flex items-center">
                    <Shortcuts />
                    {ctx.canDelete ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('tasks.delete')}
                          onClick={() => setDeleting(true)}
                          data-testid="drawer-delete"
                        >
                          <Trash2 />
                        </Button>
                        <DeleteDialog
                          type="task"
                          id={task.id}
                          open={deleting}
                          onOpenChange={setDeleting}
                          onDeleted={() => {
                            ctx.onRefresh(task.id);
                            onClose();
                          }}
                        />
                      </>
                    ) : null}
                  </span>
                </div>
                {task.blocked ? (
                  <p
                    className="flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
                    data-testid="drawer-blocked"
                  >
                    <Lock className="size-4" aria-hidden />
                    {t('tasks.blockedBanner', { count: task.blockedBy.filter((b) => b.statusCategory !== 'done').length })}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-2.5 border-t border-border px-5 py-4" data-testid="drawer-properties">
                <Prop label={t('tasks.fields.client')}>
                  <span className="truncate">{localized(task.clientName, locale)}</span>
                </Prop>
                <Prop label={t('tasks.fields.assignees')} locked={locked}>
                  <PeoplePicker
                    people={ctx.people}
                    value={task.assignees.map((a) => a.id)}
                    onChange={members('assignee')}
                    label={t('tasks.fields.assignees')}
                    disabled={!full.canUpdate}
                    testId="drawer-assignees"
                  />
                </Prop>
                <Prop label={t('tasks.fields.reviewer')} locked={locked}>
                  <PeoplePicker
                    people={ctx.people}
                    value={task.reviewer ? [task.reviewer.id] : []}
                    single
                    onChange={(ids) => void ctx.onPatch(task.id, { reviewerId: ids[0] ?? null }).then(() => ctx.onRefresh(task.id))}
                    label={t('tasks.fields.reviewer')}
                    disabled={!full.canUpdate}
                    testId="drawer-reviewer"
                  />
                </Prop>
                <Prop label={t('tasks.fields.watchers')} locked={locked}>
                  <PeoplePicker
                    people={ctx.people}
                    value={task.watchers.map((a) => a.id)}
                    onChange={members('watcher')}
                    label={t('tasks.fields.watchers')}
                    disabled={!full.canUpdate}
                    testId="drawer-watchers"
                  />
                </Prop>
                <Prop label={t('tasks.fields.department')} locked={locked}>
                  <NativeSelect
                    value={task.departmentId ?? ''}
                    disabled={!full.canUpdate}
                    onChange={(e) => void ctx.onPatch(task.id, { departmentId: e.target.value || null })}
                    aria-label={t('tasks.fields.department')}
                    className="h-8"
                  >
                    <option value="">{t('tasks.noDepartment')}</option>
                    {ctx.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {localized(d.name, locale)}
                      </option>
                    ))}
                  </NativeSelect>
                </Prop>
                <Prop label={t('tasks.fields.dates')} locked={locked}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      dir="ltr"
                      value={task.startDate ?? ''}
                      max={task.dueDate ?? undefined}
                      disabled={!full.canUpdate}
                      onChange={(e) => void ctx.onPatch(task.id, { startDate: e.target.value || null })}
                      aria-label={t('tasks.fields.startDate')}
                      className="h-8 w-36"
                    />
                    <DirIcon icon={ArrowUpRight} className="hidden" />
                    <Input
                      type="date"
                      dir="ltr"
                      value={task.dueDate ?? ''}
                      min={task.startDate ?? undefined}
                      disabled={!full.canUpdate}
                      onChange={(e) => void ctx.onPatch(task.id, { dueDate: e.target.value || null })}
                      aria-label={t('tasks.fields.dueDate')}
                      className="h-8 w-36"
                      data-testid="drawer-due"
                    />
                    <DueDate date={task.dueDate} done={task.statusCategory === 'done'} today={ctx.today} />
                  </div>
                </Prop>
                <Prop label={t('tasks.fields.estimate')} locked={locked}>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      dir="ltr"
                      min={0}
                      step={15}
                      defaultValue={task.estimateMinutes ?? ''}
                      key={`${task.id}-${task.estimateMinutes}`}
                      disabled={!full.canUpdate}
                      onBlur={(e) => {
                        const v = e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value)));
                        if (v !== task.estimateMinutes) void ctx.onPatch(task.id, { estimateMinutes: v });
                      }}
                      aria-label={t('tasks.fields.estimate')}
                      className="h-8 w-24"
                    />
                    <span className="text-xs text-muted-foreground">{t('tasks.time.minutesUnit')}</span>
                  </div>
                </Prop>
                <Prop label={t('tasks.fields.tags')} locked={locked}>
                  <Tags task={task} ctx={full} />
                </Prop>
              </div>

              <section className="grid gap-2 border-t border-border px-5 py-4">
                <h3 className="text-sm font-semibold">{t('tasks.fields.description')}</h3>
                <Description key={`${task.id}:${task.description}`} task={task} ctx={full} />
              </section>

              <Checklist task={task} ctx={own} />
              {!task.parentId ? <Subtasks task={task} ctx={full} onOpen={openOther} /> : null}
              <Dependencies task={task} ctx={full} onOpen={openOther} />
              <Deliverables task={task} ctx={full} />
              <Attachments task={task} ctx={full} />
              <TimeTracking task={task} ctx={ctx} />
              <Section icon={History} title={t('tasks.history.title')} testId="drawer-history">
                <TaskHistory
                  key={task.id}
                  taskId={task.id}
                  statuses={ctx.statuses}
                  people={ctx.people}
                  departments={ctx.departments}
                  allTasks={ctx.allTasks}
                />
              </Section>

              <Section icon={MessageSquare} title={t('tasks.comments')} testId="drawer-comments">
                <p className="text-xs text-subtle-foreground">{t('tasks.commentsInternal')}</p>
                {task.thread ? (
                  <div className="h-[28rem] overflow-hidden rounded-lg border border-border">
                    <Conversation
                      key={task.thread.thread.id}
                      initial={task.thread}
                      me={{ userId: ctx.me }}
                      side="agency"
                      canWrite
                      refreshOnRead={false}
                    />
                  </div>
                ) : null}
              </Section>
              {status?.category !== 'done' && own.canUpdate ? (
                <div className="sticky bottom-0 border-t border-border bg-surface-raised/95 px-5 py-3 backdrop-blur">
                  <Button onClick={toggleDone} className="w-full" data-testid="drawer-mark-done">
                    <CheckCircle2 />
                    {t('tasks.markDone')}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(o) => !o && setPending(null)}
        title={t('tasks.discardTitle')}
        description={t('tasks.discardBody')}
        confirmLabel={t('tasks.discard')}
        cancelLabel={t('tasks.keepEditing')}
        destructive
        onConfirm={() => {
          const next = pending?.open ?? null;
          dirty.current.clear();
          setPending(null);
          if (next) onOpen(next);
          else onClose();
        }}
      />
    </DirtyContext.Provider>
  );
}
