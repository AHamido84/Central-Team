import type { LucideIcon } from 'lucide-react';
import {
  Blocks,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCheck,
  FolderOpen,
  Home,
  Inbox,
  LayoutDashboard,
  MessagesSquare,
  Network,
  Package,
  ScrollText,
  ShieldCheck,
  Users,
  ClipboardList,
} from 'lucide-react';

import { can, type PermissionSet } from '@/lib/permissions/can';
import type { Permission } from '@/lib/permissions/catalog';

/**
 * Module registry for navigation (ARCHITECTURE §8). Nav and command palette are generated from it,
 * filtered by permission and feature flag, so disabled modules disappear everywhere at once.
 */
export type NavItem = {
  key: string;
  href: string;
  icon: LucideIcon;
  /** Any of these permissions grants visibility (empty = everyone on this side). */
  anyOf?: Permission[];
  flag?: string;
};

export type NavSection = { key: 'sectionHome' | 'sectionClients' | 'sectionAdmin'; items: NavItem[] };

export const agencyNav: NavSection[] = [
  {
    key: 'sectionHome',
    items: [
      { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
      { key: 'inbox', href: '/notifications', icon: Inbox },
    ],
  },
  {
    key: 'sectionClients',
    items: [
      { key: 'clients', href: '/clients', icon: Briefcase, anyOf: ['clients:read_all', 'clients:read_assigned'], flag: 'module.clients' },
      { key: 'messages', href: '/messages', icon: MessagesSquare, anyOf: ['clients:read_all', 'clients:read_assigned'], flag: 'module.messages' },
    ],
  },
  {
    key: 'sectionAdmin',
    items: [
      { key: 'users', href: '/admin/users', icon: Users, anyOf: ['users:read', 'invitations:read'] },
      { key: 'roles', href: '/admin/roles', icon: ShieldCheck, anyOf: ['roles:read'] },
      { key: 'departments', href: '/admin/departments', icon: Network, anyOf: ['departments:manage'] },
      { key: 'packages', href: '/admin/packages', icon: Package, anyOf: ['packages:manage'], flag: 'module.clients' },
      { key: 'features', href: '/admin/features', icon: Blocks, anyOf: ['feature_flags:manage'] },
      { key: 'audit', href: '/admin/audit', icon: ScrollText, anyOf: ['audit_log:read'] },
      { key: 'organization', href: '/admin/organization', icon: Building2, anyOf: ['organization:update'] },
    ],
  },
];

export const portalNav: NavItem[] = [
  { key: 'portalHome', href: '/portal', icon: Home },
  { key: 'requests', href: '/portal/requests', icon: ClipboardList, flag: 'module.requests' },
  { key: 'approvals', href: '/portal/approvals', icon: CheckCheck, flag: 'module.approvals' },
  { key: 'files', href: '/portal/files', icon: FolderOpen, flag: 'module.files' },
  { key: 'calendar', href: '/portal/calendar', icon: CalendarDays, flag: 'module.calendar' },
  { key: 'messages', href: '/portal/messages', icon: MessagesSquare, flag: 'module.messages' },
  { key: 'company', href: '/portal/company', icon: Building2 },
];

export function isNavItemVisible(item: NavItem, perms: PermissionSet | readonly string[], flags: Record<string, boolean>): boolean {
  if (item.flag && !flags[item.flag]) return false;
  if (item.anyOf && item.anyOf.length > 0 && !item.anyOf.some((p) => can(perms, p))) return false;
  return true;
}

export function isActive(pathname: string, href: string): boolean {
  if (href === '/portal') return pathname === '/portal';
  return pathname === href || pathname.startsWith(`${href}/`);
}
