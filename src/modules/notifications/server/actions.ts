'use server';

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { defineAction } from '@/lib/actions/define-action';
import type { ActionResult } from '@/lib/actions/errors';
import { getSession } from '@/lib/auth/session';
import { getPortalScope, withRls } from '@/lib/db/rls';
import { notificationClientPreferences, notificationPreferences, notifications, profiles } from '@/lib/db/schema';
import { notificationCategories, type NotificationItem, type NotificationType } from '@/modules/notifications/types';

export async function listNotificationsAction(input: {
  filter: 'all' | 'unread';
  limit?: number;
}): Promise<ActionResult<{ items: NotificationItem[]; unread: number }>> {
  const session = await getSession();
  if (!session) return { ok: false, error: { code: 'unauthenticated' } };
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const data = await withRls(async (tx) => {
    const rows = await tx
      .select({
        id: notifications.id,
        type: notifications.type,
        params: notifications.params,
        link: notifications.link,
        clientId: notifications.clientId,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
        actorName: profiles.fullName,
        actorAvatar: profiles.avatarPath,
      })
      .from(notifications)
      .leftJoin(profiles, eq(profiles.id, notifications.actorId))
      .where(and(eq(notifications.userId, session.userId), input.filter === 'unread' ? isNull(notifications.readAt) : undefined))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, session.userId), isNull(notifications.readAt)));
    // Multi-client portal users see which client each item is about (FR4.3); names come from their own client list,
    // because the request is scoped to the selected client.
    const scope = await getPortalScope(session);
    const clientName = (id: string | null) => (scope.clients.length > 1 ? (scope.clients.find((c) => c.id === id)?.name ?? null) : null);
    return {
      items: rows.map((r) => ({
        id: r.id,
        type: r.type as NotificationType,
        params: r.params,
        link: r.link,
        readAt: r.readAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        actor: r.actorName ? { name: r.actorName, avatarPath: r.actorAvatar } : null,
        client: clientName(r.clientId),
      })),
      unread: count?.n ?? 0,
    };
  }, session);
  return { ok: true, data };
}

export async function markNotificationsReadAction(input: { ids: string[] | 'all' }): Promise<ActionResult<null>> {
  const session = await getSession();
  if (!session) return { ok: false, error: { code: 'unauthenticated' } };
  const ids = input.ids === 'all' ? 'all' : z.array(z.uuid()).max(200).parse(input.ids);
  await withRls(async (tx) => {
    await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, session.userId),
          isNull(notifications.readAt),
          ids === 'all' ? undefined : inArray(notifications.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']),
        ),
      );
  }, session);
  return { ok: true, data: null };
}

const prefsSchema = z.object({
  preferences: z.array(
    z.object({ category: z.enum(notificationCategories), inApp: z.boolean(), email: z.boolean(), whatsapp: z.boolean().default(false) }),
  ),
});

export const updateNotificationPreferencesAction = defineAction({
  input: prefsSchema,
  side: 'any',
  async handler({ input, tx, ctx }) {
    for (const pref of input.preferences) {
      await tx
        .insert(notificationPreferences)
        .values({
          userId: ctx.session.userId,
          organizationId: ctx.organization.id,
          category: pref.category,
          inApp: pref.inApp,
          email: pref.email,
          // WhatsApp is an agency channel (Phase 7).
          whatsapp: ctx.side === 'agency' && pref.whatsapp,
        })
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.organizationId, notificationPreferences.category],
          set: { inApp: pref.inApp, email: pref.email, whatsapp: ctx.side === 'agency' && pref.whatsapp },
        });
    }
    return null;
  },
});

/**
 * Per-client overrides (FR4.3, ADR-093): a portal user in several clients can tune one client's notifications; the
 * organization-wide choice stays the default for the others. RLS allows rows only for the caller's own clients.
 */
export const updateClientNotificationPreferencesAction = defineAction({
  input: z.object({
    clientId: z.uuid(),
    preferences: z.array(z.object({ category: z.enum(notificationCategories), inApp: z.boolean(), email: z.boolean() })),
  }),
  side: 'client',
  async handler({ input, tx, ctx }) {
    for (const pref of input.preferences) {
      await tx
        .insert(notificationClientPreferences)
        .values({
          userId: ctx.session.userId,
          organizationId: ctx.organization.id,
          clientId: input.clientId,
          category: pref.category,
          inApp: pref.inApp,
          email: pref.email,
        })
        .onConflictDoUpdate({
          target: [notificationClientPreferences.userId, notificationClientPreferences.clientId, notificationClientPreferences.category],
          set: { inApp: pref.inApp, email: pref.email },
        });
    }
    return null;
  },
});

/** Back to the organization-wide choice for one client. */
export const resetClientNotificationPreferencesAction = defineAction({
  input: z.object({ clientId: z.uuid() }),
  side: 'client',
  async handler({ input, tx, ctx }) {
    await tx
      .delete(notificationClientPreferences)
      .where(and(eq(notificationClientPreferences.userId, ctx.session.userId), eq(notificationClientPreferences.clientId, input.clientId)));
    return null;
  },
  revalidate: ['/portal/settings/notifications'],
});
