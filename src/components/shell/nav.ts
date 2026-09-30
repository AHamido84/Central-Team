import type { LucideIcon } from 'lucide-react';
import {
  Blocks,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCheck,
  FileSliders,
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
  FileCheck2,
  KanbanSquare,
  ListChecks,
  Workflow,
  Megaphone,
  FileChartColumn,
  Timer,
  UsersRound,
  Gauge,
  Contact,
  Columns3,
  CalendarCheck,
  ChartSpline,
  SlidersHorizontal,
  PlugZap,
  Zap,
  Sparkles,
  Lightbulb,
  BrainCircuit,
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

export type NavSection = { key: 'sectionHome' | 'sectionClients' | 'sectionSales' | 'sectionAdmin'; items: NavItem[] };

export const agencyNav: NavSection[] = [
  {
    key: 'sectionHome',
    items: [
      { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
      { key: 'myWork', href: '/my-work', icon: ListChecks, anyOf: ['tasks:read'], flag: 'module.tasks' },
      { key: 'inbox', href: '/notifications', icon: Inbox },
      { key: 'assistant', href: '/assistant', icon: Sparkles, anyOf: ['ai:use'], flag: 'module.ai' },
      { key: 'team', href: '/team', icon: UsersRound, anyOf: ['operations:read'] },
    ],
  },
  {
    key: 'sectionClients',
    items: [
      { key: 'requests', href: '/requests', icon: ClipboardList, anyOf: ['requests:read'], flag: 'module.requests' },
      { key: 'slaMonitor', href: '/sla', icon: Gauge, anyOf: ['operations:read'], flag: 'module.requests' },
      { key: 'tasks', href: '/tasks', icon: KanbanSquare, anyOf: ['tasks:read'], flag: 'module.tasks' },
      { key: 'deliverables', href: '/deliverables', icon: FileCheck2, anyOf: ['tasks:read'], flag: 'module.tasks' },
      { key: 'campaigns', href: '/campaigns', icon: Megaphone, anyOf: ['campaigns:read'], flag: 'module.campaigns' },
      { key: 'reports', href: '/reports', icon: FileChartColumn, anyOf: ['campaigns:read'], flag: 'module.campaigns' },
      { key: 'insights', href: '/insights', icon: Lightbulb, anyOf: ['campaigns:read'], flag: 'module.ai' },
      { key: 'clients', href: '/clients', icon: Briefcase, anyOf: ['clients:read_all', 'clients:read_assigned'], flag: 'module.clients' },
      {
        key: 'messages',
        href: '/messages',
        icon: MessagesSquare,
        anyOf: ['clients:read_all', 'clients:read_assigned'],
        flag: 'module.messages',
      },
    ],
  },
  {
    key: 'sectionSales',
    items: [
      { key: 'leads', href: '/crm/leads', icon: Contact, anyOf: ['leads:read'], flag: 'module.crm' },
      { key: 'pipeline', href: '/crm/pipeline', icon: Columns3, anyOf: ['deals:read'], flag: 'module.crm' },
      { key: 'followUps', href: '/crm/follow-ups', icon: CalendarCheck, anyOf: ['leads:manage', 'deals:manage'], flag: 'module.crm' },
      { key: 'salesDashboard', href: '/crm/dashboard', icon: ChartSpline, anyOf: ['deals:read'], flag: 'module.crm' },
      { key: 'capacity', href: '/capacity', icon: Gauge, anyOf: ['capacity:read'], flag: 'module.crm' },
    ],
  },
  {
    key: 'sectionAdmin',
    items: [
      { key: 'users', href: '/admin/users', icon: Users, anyOf: ['users:read', 'invitations:read'] },
      { key: 'roles', href: '/admin/roles', icon: ShieldCheck, anyOf: ['roles:read'] },
      { key: 'departments', href: '/admin/departments', icon: Network, anyOf: ['departments:manage'] },
      { key: 'requestTypes', href: '/admin/request-types', icon: FileSliders, anyOf: ['request_types:manage'], flag: 'module.requests' },
      { key: 'slaPolicies', href: '/admin/sla', icon: Timer, anyOf: ['sla:manage'], flag: 'module.requests' },
      { key: 'workflows', href: '/admin/workflows', icon: Workflow, anyOf: ['workflows:manage'], flag: 'module.tasks' },
      { key: 'crmSettings', href: '/admin/crm', icon: SlidersHorizontal, anyOf: ['crm:admin'], flag: 'module.crm' },
      {
        key: 'integrations',
        href: '/admin/integrations',
        icon: PlugZap,
        anyOf: ['integrations:read', 'integrations:manage'],
        flag: 'module.integrations',
      },
      {
        key: 'automations',
        href: '/admin/automations',
        icon: Zap,
        anyOf: ['automations:read', 'automations:manage'],
        flag: 'module.integrations',
      },
      { key: 'aiSettings', href: '/admin/ai', icon: BrainCircuit, anyOf: ['ai:manage'], flag: 'module.ai' },
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
  { key: 'portalCampaigns', href: '/portal/campaigns', icon: Megaphone, flag: 'module.campaigns' },
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
