'use client';

import { Check, Search, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { Avatar, AvatarGroup, Popover, PopoverContent, PopoverTrigger } from '@/components/ui/primitives';
import { publicAssetUrl } from '@/lib/storage';
import { cn } from '@/lib/utils/cn';

export type PersonOption = { id: string; name: string; avatarPath: string | null };

/** Searchable multi-select of agency members (assignees, watchers). Also works as a single select with `single`. */
export function PeoplePicker({
  people,
  value,
  onChange,
  single,
  label,
  trigger,
  disabled,
  testId,
}: {
  people: PersonOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  single?: boolean;
  label: string;
  trigger?: ReactNode;
  disabled?: boolean;
  testId?: string;
}) {
  const t = useTranslations('tasks');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = people.filter((p) => value.includes(p.id));
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle ? people.filter((p) => p.name.toLowerCase().includes(needle)) : people;
    // Selected first, then alphabetical.
    return [...filtered].sort((a, b) => Number(value.includes(b.id)) - Number(value.includes(a.id)) || a.name.localeCompare(b.name));
  }, [people, q, value]);
  const toggle = (id: string) => {
    if (single) {
      onChange(value[0] === id ? [] : [id]);
      setOpen(false);
      return;
    }
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger ?? (
          <button
            type="button"
            aria-label={label}
            className="flex min-h-9 w-full items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-start text-sm transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
            data-testid={testId}
          >
            {selected.length ? (
              <>
                <AvatarGroup
                  people={selected.map((p) => ({ id: p.id, name: p.name, src: publicAssetUrl(p.avatarPath) }))}
                  size="xs"
                  max={3}
                />
                <span className="min-w-0 flex-1 truncate">{selected.map((p) => p.name).join('، ')}</span>
              </>
            ) : (
              <span className="flex items-center gap-1.5 text-subtle-foreground">
                <UserPlus className="size-4" aria-hidden />
                {t('pickPeople')}
              </span>
            )}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="relative border-b border-border p-2">
          <Search className="pointer-events-none absolute start-4 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('searchPeople')}
            aria-label={t('searchPeople')}
            className="ps-8"
            autoFocus
          />
        </div>
        <ul className="max-h-64 overflow-y-auto p-1" role="listbox" aria-label={label} aria-multiselectable={!single}>
          {list.map((p) => {
            const on = value.includes(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => toggle(p.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none',
                  )}
                  data-testid="person-option"
                >
                  <Avatar src={publicAssetUrl(p.avatarPath)} name={p.name} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {on ? <Check className="size-4 text-primary" aria-hidden /> : null}
                </button>
              </li>
            );
          })}
          {list.length === 0 ? <li className="px-2 py-3 text-center text-sm text-subtle-foreground">{t('noPeople')}</li> : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
