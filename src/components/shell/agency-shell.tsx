'use client';

import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';

import { DirIcon } from '@/components/patterns';
import { Breadcrumbs, BreadcrumbProvider } from '@/components/shell/breadcrumbs';
import { CommandPalette } from '@/components/shell/command-palette';
import { agencyNav, isActive, isNavItemVisible, type NavItem } from '@/components/shell/nav';
import { LanguageSwitcher, ThemeToggle } from '@/components/shell/preferences-menu';
import type { ShellData } from '@/components/shell/shell-data';
import { UserMenu } from '@/components/shell/user-menu';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/overlays';
import { Avatar, Tooltip } from '@/components/ui/primitives';
import { can } from '@/lib/permissions/can';
import { cn } from '@/lib/utils/cn';
import { NotificationBell } from '@/modules/notifications/components/notification-bell';

const SIDEBAR_COOKIE = 'sidebar_collapsed';

function SidebarNav({
  data,
  collapsed,
  onNavigate,
}: {
  data: ShellData;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const tooltipSide = useLocale() === 'ar' ? 'left' : 'right';
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label={t('agencyWorkspace')}>
      {agencyNav.map((section) => {
        const items = section.items.filter((i) => isNavItemVisible(i, data.permissions, data.flags));
        if (items.length === 0) return null;
        return (
          <div key={section.key} className="mb-5">
            {collapsed ? (
              <div className="mx-2 mb-2 h-px bg-sidebar-border" />
            ) : (
              <p className="px-2 pb-1.5 text-xs font-medium text-subtle-foreground">{t(section.key)}</p>
            )}
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = isActive(pathname, item.href);
                const link = (
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-sidebar-active text-sidebar-active-foreground'
                        : 'text-sidebar-foreground hover:bg-surface-muted hover:text-foreground',
                      collapsed && 'justify-center px-0',
                    )}
                  >
                    {active ? <span className="absolute inset-y-1.5 start-0 w-0.5 rounded-full bg-primary" aria-hidden /> : null}
                    <item.icon className="size-[1.125rem] shrink-0" aria-hidden />
                    {collapsed ? <span className="sr-only">{t(item.key as never)}</span> : <span className="truncate">{t(item.key as never)}</span>}
                  </Link>
                );
                return (
                  <li key={item.href}>
                    {collapsed ? (
                      <Tooltip content={t(item.key as never)} side={tooltipSide}>
                        {link}
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function OrgHeader({ data, collapsed }: { data: ShellData; collapsed: boolean }) {
  return (
    <Link href="/dashboard" className={cn('flex h-14 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}>
      {data.organization.logoUrl ? (
        <Avatar name={data.organization.name} src={data.organization.logoUrl} size="sm" square />
      ) : (
        <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          {data.organization.name.charAt(0)}
        </span>
      )}
      {collapsed ? null : <span className="truncate text-sm font-semibold">{data.organization.name}</span>}
    </Link>
  );
}

export function AgencyShell({
  data,
  initialCollapsed,
  children,
}: {
  data: ShellData;
  initialCollapsed: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('common');
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      document.cookie = `${SIDEBAR_COOKIE}=${c ? '0' : '1'}; path=/; max-age=31536000; samesite=lax`;
      return !c;
    });
  };

  const paletteItems: NavItem[] = agencyNav.flatMap((s) => s.items.filter((i) => isNavItemVisible(i, data.permissions, data.flags)));

  return (
    <BreadcrumbProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        {t('skipToContent')}
      </a>
      <div className="flex min-h-dvh">
        <aside
          className={cn(
            'sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-sidebar-border bg-sidebar transition-[width] duration-(--duration-base) lg:flex',
            collapsed ? 'w-16' : 'w-66',
          )}
        >
          <OrgHeader data={data} collapsed={collapsed} />
          <SidebarNav data={data} collapsed={collapsed} />
          <div className="border-t border-sidebar-border p-2">
            {collapsed ? (
              <div className="flex justify-center py-1">
                <UserMenu user={data.user} settingsBase="/settings" compact showDesignSystem={can(data.permissions, 'design_system:view')} />
              </div>
            ) : (
              <UserMenu user={data.user} settingsBase="/settings" showDesignSystem={can(data.permissions, 'design_system:view')} />
            )}
          </div>
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="start" closeLabel={t('close')} className="w-72 bg-sidebar p-0">
            <SheetTitle className="sr-only">{t('menu')}</SheetTitle>
            <OrgHeader data={data} collapsed={false} />
            <SidebarNav data={data} collapsed={false} onNavigate={() => setMobileOpen(false)} />
            <div className="border-t border-sidebar-border p-2">
              <UserMenu user={data.user} settingsBase="/settings" showDesignSystem={can(data.permissions, 'design_system:view')} />
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-(--gutter) backdrop-blur supports-[backdrop-filter]:bg-background/70">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t('openMenu')}>
              <Menu />
            </Button>
            <Tooltip content={collapsed ? t('expandSidebar') : t('collapseSidebar')}>
              <Button variant="ghost" size="icon" className="hidden lg:inline-flex" onClick={toggle} aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}>
                <DirIcon icon={collapsed ? PanelLeftOpen : PanelLeftClose} />
              </Button>
            </Tooltip>
            <div className="min-w-0 flex-1">
              <Breadcrumbs />
            </div>
            <div className="flex items-center gap-1">
              {data.flags['ui.command_palette'] ? <CommandPalette items={paletteItems} /> : null}
              <LanguageSwitcher />
              <ThemeToggle />
              <NotificationBell userId={data.user.id} inboxHref="/notifications" />
            </div>
          </header>
          <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-(--gutter) py-6 md:py-8">
            {children}
          </main>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
