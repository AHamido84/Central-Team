import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import { createTranslator } from 'next-intl';

import { dbAdmin } from '@/lib/db/client';
import { notificationPreferences, notifications, organizations, profiles } from '@/lib/db/schema';
import { sendActionEmail } from '@/lib/email/send';
import { isLocale, type Locale } from '@/lib/i18n/localized';
import { loadMessages } from '@/i18n/messages';
import { sendNotificationWhatsApp } from '@/modules/integrations/server/whatsapp';
import { notificationTypes, type NotificationType } from '@/modules/notifications/types';

export type NotifyInput = {
  organizationId: string;
  userIds: string[];
  type: NotificationType;
  params: Record<string, string | number>;
  link: string;
  actorId?: string | null;
  eventId?: string | null;
  /** Optional quoted content for the email (e.g. the message text). */
  quote?: string;
};

/**
 * Fan-out from event consumers: in-app rows + email per recipient preference. Runs with the service
 * connection because it writes rows for *other* users (listed service path, CLAUDE.md §6);
 * recipients are always computed server-side from the committed event and the database.
 */
export async function notify(input: NotifyInput): Promise<void> {
  let recipients = [...new Set(input.userIds)].filter((id) => id !== input.actorId);
  if (recipients.length === 0) return;
  // Idempotent per event: a retried delivery doesn't notify the same person twice.
  if (input.eventId) {
    const already = await dbAdmin
      .select({ userId: notifications.userId })
      .from(notifications)
      .where(and(eq(notifications.eventId, input.eventId), eq(notifications.type, input.type), inArray(notifications.userId, recipients)));
    const done = new Set(already.map((r) => r.userId));
    recipients = recipients.filter((id) => !done.has(id));
    if (recipients.length === 0) return;
  }
  const category = notificationTypes[input.type];

  const prefs = await dbAdmin
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.organizationId, input.organizationId),
        eq(notificationPreferences.category, category),
        inArray(notificationPreferences.userId, recipients),
      ),
    );
  const prefFor = (userId: string) => prefs.find((p) => p.userId === userId) ?? { inApp: true, email: true };

  const inAppRecipients = recipients.filter((id) => prefFor(id).inApp);
  if (inAppRecipients.length > 0) {
    await dbAdmin.insert(notifications).values(
      inAppRecipients.map((userId) => ({
        organizationId: input.organizationId,
        userId,
        type: input.type,
        category,
        params: input.params,
        link: input.link,
        actorId: input.actorId ?? null,
        eventId: input.eventId ?? null,
      })),
    );
  }

  // WhatsApp (Phase 7): opted-in recipients with the category's WhatsApp switch on; a failure never blocks email.
  await sendNotificationWhatsApp({
    organizationId: input.organizationId,
    category,
    type: input.type,
    recipients,
    content: async (locale) => {
      const t = createTranslator({ locale, messages: await loadMessages(locale) });
      return {
        title: t(`notifications.types.${input.type}.title`, input.params as never),
        body: `${t(`notifications.types.${input.type}.body`, input.params as never)}\n${process.env.NEXT_PUBLIC_APP_URL}${input.link}`,
      };
    },
  }).catch((error) => console.error('[notify] whatsapp failed', error));

  const emailRecipients = recipients.filter((id) => prefFor(id).email);
  if (emailRecipients.length === 0) return;
  const [org] = await dbAdmin.select().from(organizations).where(eq(organizations.id, input.organizationId));
  if (!org) return;
  const flag = await dbAdmin.query.organizationFeatures.findFirst({
    where: (f, { and: a, eq: e }) => a(e(f.organizationId, org.id), e(f.flagKey, 'module.notifications_email')),
  });
  if (flag && !flag.enabled) return;

  const people = await dbAdmin
    .select({ id: profiles.id, email: profiles.email, locale: profiles.locale })
    .from(profiles)
    .where(inArray(profiles.id, emailRecipients));

  await Promise.allSettled(
    people.map(async (person) => {
      const locale: Locale = isLocale(person.locale) ? person.locale : 'ar';
      const messages = await loadMessages(locale);
      const t = createTranslator({ locale, messages });
      const title = t(`notifications.types.${input.type}.title`, input.params as never);
      const body = t(`notifications.types.${input.type}.body`, input.params as never);
      await sendActionEmail({
        organizationId: input.organizationId,
        kind: 'notification',
        userId: person.id,
        to: person.email,
        locale,
        brand: { name: org.name, primaryColor: org.brand.primaryColor },
        subject: title,
        content: {
          heading: title,
          paragraphs: [body],
          quote: input.quote,
          cta: { label: t('emails.openInApp'), href: `${process.env.NEXT_PUBLIC_APP_URL}${input.link}` },
          note: t('emails.manageNotifications'),
        },
        tags: { type: input.type },
      });
    }),
  );
}
