'use client';

import { Check, Languages, Monitor, Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { Tooltip } from '@/components/ui/primitives';
import { setLocaleAction, setThemeAction } from '@/modules/identity/server/actions';

export function useSwitchLocale() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const switchTo = (next: 'ar' | 'en') =>
    startTransition(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  return { switchTo, pending };
}

export function useSwitchTheme() {
  const { setTheme, theme } = useTheme();
  return {
    theme: (theme ?? 'system') as 'system' | 'light' | 'dark',
    switchTo: (next: 'system' | 'light' | 'dark') => {
      setTheme(next);
      void setThemeAction(next);
    },
  };
}

export function LanguageSwitcher({ variant = 'icon' }: { variant?: 'icon' | 'full' }) {
  const t = useTranslations('common');
  const locale = useLocale();
  const { switchTo, pending } = useSwitchLocale();
  const options = [
    { value: 'ar' as const, label: 'العربية', lang: 'ar' },
    { value: 'en' as const, label: 'English', lang: 'en' },
  ];
  return (
    <DropdownMenu>
      <Tooltip content={t('language')}>
        <DropdownMenuTrigger asChild>
          {variant === 'icon' ? (
            <Button variant="ghost" size="icon" aria-label={t('language')} loading={pending} data-testid="language-switcher">
              {pending ? null : <Languages />}
            </Button>
          ) : (
            <Button variant="outline" size="sm" loading={pending} data-testid="language-switcher">
              {pending ? null : <Languages />}
              {locale === 'ar' ? 'العربية' : 'English'}
            </Button>
          )}
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent className="min-w-40">
        <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => switchTo(o.value)} data-testid={`locale-${o.value}`}>
            <span lang={o.lang} className="flex-1">
              {o.label}
            </span>
            {locale === o.value ? <Check className="text-primary!" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThemeToggle() {
  const t = useTranslations('common');
  const { theme, switchTo } = useSwitchTheme();
  const options = [
    { value: 'light' as const, label: t('light'), icon: Sun },
    { value: 'dark' as const, label: t('dark'), icon: Moon },
    { value: 'system' as const, label: t('system'), icon: Monitor },
  ];
  return (
    <DropdownMenu>
      <Tooltip content={t('theme')}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('theme')} data-testid="theme-toggle">
            <Sun className="dark:hidden" />
            <Moon className="hidden dark:block" />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent className="min-w-40">
        <DropdownMenuLabel>{t('theme')}</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => switchTo(o.value)}>
            <o.icon />
            <span className="flex-1">{o.label}</span>
            {theme === o.value ? <Check className="text-primary!" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
