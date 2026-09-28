'use client';

import { Command } from 'cmdk';
import { Languages, Monitor, Moon, Search, Sun } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Kbd } from '@/components/ui/primitives';
import { useSwitchLocale, useSwitchTheme } from '@/components/shell/preferences-menu';
import type { NavItem } from '@/components/shell/nav';

export function useCommandPaletteShortcut(setOpen: (fn: (o: boolean) => boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
}

const itemClass =
  'flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-sm outline-none select-none data-[selected=true]:bg-surface-muted [&_svg]:size-4 [&_svg]:text-subtle-foreground';

export function CommandPalette({ items }: { items: NavItem[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useCommandPaletteShortcut(setOpen);
  const { switchTo: switchLocale } = useSwitchLocale();
  const { switchTo: switchTheme } = useSwitchTheme();

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-9 w-64 items-center gap-2 rounded-md border border-border bg-surface-muted/60 px-3 text-sm text-subtle-foreground transition-colors hover:bg-surface-muted md:flex"
        data-testid="command-palette-trigger"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 truncate text-start">{t('common.commandPlaceholder')}</span>
        <Kbd>⌘K</Kbd>
      </button>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-overlay data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed start-1/2 top-[12vh] z-[90] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-xl border border-border bg-surface-raised shadow-lg data-[state=open]:animate-in data-[state=open]:zoom-in-95 ltr:-translate-x-1/2 rtl:translate-x-1/2">
            <DialogPrimitive.Title className="sr-only">{t('common.commandPalette')}</DialogPrimitive.Title>
            <Command label={t('common.commandPalette')} className="flex flex-col">
              <div className="flex items-center gap-2 border-b border-border px-4">
                <Search className="size-4 text-subtle-foreground" aria-hidden />
                <Command.Input
                  autoFocus
                  placeholder={t('common.commandPlaceholder')}
                  className="h-12 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-subtle-foreground"
                />
              </div>
              <Command.List className="max-h-[50vh] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">{t('common.commandEmpty')}</Command.Empty>
                <Command.Group
                  heading={t('common.commandNavigation')}
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle-foreground"
                >
                  {items.map((item) => (
                    <Command.Item
                      key={item.href}
                      value={`${t(`nav.${item.key}` as never)} ${item.href}`}
                      onSelect={() => run(() => router.push(item.href))}
                      className={itemClass}
                    >
                      <item.icon aria-hidden />
                      {t(`nav.${item.key}` as never)}
                    </Command.Item>
                  ))}
                </Command.Group>
                <Command.Group
                  heading={t('common.commandActions')}
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-subtle-foreground"
                >
                  <Command.Item onSelect={() => run(() => switchLocale('ar'))} className={itemClass}>
                    <Languages aria-hidden />
                    {t('common.switchToArabic')}
                  </Command.Item>
                  <Command.Item onSelect={() => run(() => switchLocale('en'))} className={itemClass}>
                    <Languages aria-hidden />
                    {t('common.switchToEnglish')}
                  </Command.Item>
                  <Command.Item onSelect={() => run(() => switchTheme('light'))} className={itemClass}>
                    <Sun aria-hidden />
                    {`${t('common.switchTheme')}: ${t('common.light')}`}
                  </Command.Item>
                  <Command.Item onSelect={() => run(() => switchTheme('dark'))} className={itemClass}>
                    <Moon aria-hidden />
                    {`${t('common.switchTheme')}: ${t('common.dark')}`}
                  </Command.Item>
                  <Command.Item onSelect={() => run(() => switchTheme('system'))} className={itemClass}>
                    <Monitor aria-hidden />
                    {`${t('common.switchTheme')}: ${t('common.system')}`}
                  </Command.Item>
                </Command.Group>
              </Command.List>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
