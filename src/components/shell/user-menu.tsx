'use client';

import { Bell, LogOut, Palette, Settings2, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Avatar } from '@/components/ui/primitives';
import { cn } from '@/lib/utils/cn';

export function UserMenu({
  user,
  settingsBase,
  showDesignSystem,
  compact,
  subtitle,
}: {
  user: { name: string; email: string; avatarUrl: string | null };
  settingsBase: '/settings' | '/portal/settings';
  showDesignSystem?: boolean;
  compact?: boolean;
  subtitle?: string;
}) {
  const t = useTranslations();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex min-w-0 items-center gap-2.5 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring',
          compact ? 'p-0.5' : 'w-full p-2 hover:bg-surface-muted',
        )}
        data-testid="user-menu"
        aria-label={t('common.profile')}
      >
        <Avatar name={user.name} src={user.avatarUrl} size="sm" />
        {compact ? null : (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-xs text-subtle-foreground">{subtitle ?? user.email}</span>
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? 'end' : 'start'} side={compact ? 'bottom' : 'top'} className="w-60">
        <div className="px-2 py-2">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-subtle-foreground" dir="ltr">
            {user.email}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`${settingsBase}/profile`}>
            <UserRound />
            {t('common.profile')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`${settingsBase}/preferences`}>
            <Settings2 />
            {t('nav.preferences')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`${settingsBase}/notifications`}>
            <Bell />
            {t('nav.notificationSettings')}
          </Link>
        </DropdownMenuItem>
        {showDesignSystem ? (
          <DropdownMenuItem asChild>
            <Link href="/dev/design-system">
              <Palette />
              {t('nav.designSystem')}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild destructive>
          <a href="/auth/signout" data-testid="sign-out">
            <LogOut />
            {t('common.signOut')}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
