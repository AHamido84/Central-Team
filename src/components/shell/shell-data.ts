import 'server-only';

import type { AppContext } from '@/lib/auth/context';
import { localized, type Locale } from '@/lib/i18n/localized';
import { publicAssetUrl } from '@/lib/storage';

/** Serializable snapshot of the context for client shells. */
export type ShellData = {
  side: 'agency' | 'client';
  user: { id: string; name: string; email: string; avatarUrl: string | null };
  organization: { name: string; logoUrl: string | null; brandColor: string | null };
  permissions: string[];
  flags: Record<string, boolean>;
  client: { id: string; name: string; logoUrl: string | null; roleName: string } | null;
  clients: { id: string; name: string }[];
};

export function toShellData(ctx: AppContext, locale: Locale): ShellData {
  return {
    side: ctx.side,
    user: {
      id: ctx.profile.id,
      name: ctx.profile.fullName || ctx.profile.email,
      email: ctx.profile.email,
      avatarUrl: publicAssetUrl(ctx.profile.avatarPath),
    },
    organization: {
      name: localized(ctx.organization.name, locale),
      logoUrl: publicAssetUrl(ctx.organization.logoPath),
      brandColor: ctx.organization.brand.primaryColor ?? null,
    },
    permissions: [...ctx.permissions],
    flags: ctx.flags,
    client:
      ctx.side === 'client'
        ? {
            id: ctx.client.id,
            name: localized(ctx.client.name, locale),
            logoUrl: publicAssetUrl(ctx.client.logoPath),
            roleName: localized(ctx.client.roleName, locale),
          }
        : null,
    clients: ctx.side === 'client' ? ctx.clients.map((c) => ({ id: c.id, name: localized(c.name, locale) })) : [],
  };
}

/** Inline style that re-points the brand token to the organization's color (portal theming). */
export function brandStyle(color: string | null): Record<string, string> | undefined {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? { '--brand': color } : undefined;
}
