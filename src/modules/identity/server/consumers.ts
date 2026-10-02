import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { domainEvents, notifications, organizationMembers, organizations, profiles } from '@/lib/db/schema';
import { emailTranslator, sendActionEmail } from '@/lib/email/send';
import { defineConsumer } from '@/lib/events/dispatcher';
import { isLocale, type Locale } from '@/lib/i18n/localized';
import { notify } from '@/modules/notifications/server/notify';

/**
 * `user.email_changed` (self-service or by an admin, ADR-087) → the user is told in the app and at the new address
 * (their notification preferences), and — always, as a security notice — at the old address, which no longer receives
 * anything else. Idempotent: a retried delivery finds its notification row and sends nothing again.
 */
export const emailChangeNotifications = defineConsumer({
  name: 'notifications.email_change',
  types: ['user.email_changed'],
  async handle(event) {
    const { userId, from, to } = event.payload;
    const [done] = await dbAdmin
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.eventId, event.id), eq(notifications.type, 'email_changed')))
      .limit(1);
    if (done) return;
    const [member] = await dbAdmin
      .select({ userType: organizationMembers.userType, locale: profiles.locale })
      .from(organizationMembers)
      .innerJoin(profiles, eq(profiles.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.organizationId, event.organizationId)));
    if (!member) return;
    const link = member.userType === 'client' ? '/portal/settings/profile' : '/settings/profile';
    await notify({
      organizationId: event.organizationId,
      userIds: [userId],
      type: 'email_changed',
      params: { from, to },
      link,
      // The change itself is the user's (or an admin's); either way the user must hear about it.
      actorId: null,
      eventId: event.id,
    });

    const [org] = await dbAdmin.select().from(organizations).where(eq(organizations.id, event.organizationId));
    if (!org || !from) return;
    // Set by an admin (ADR-087/092)? The notice to the old address names them.
    const [byAdmin] = await dbAdmin
      .select({ name: profiles.fullName, email: profiles.email })
      .from(domainEvents)
      .innerJoin(profiles, eq(profiles.id, domainEvents.actorId))
      .where(
        and(
          eq(domainEvents.type, 'user.email_set_by_admin'),
          eq(domainEvents.organizationId, event.organizationId),
          sql`${domainEvents.payload}->>'userId' = ${userId} and lower(${domainEvents.payload}->>'to') = lower(${to})`,
          sql`${domainEvents.occurredAt} > now() - interval '1 day'`,
        ),
      )
      .orderBy(desc(domainEvents.occurredAt))
      .limit(1);
    const locale: Locale = isLocale(member.locale) ? member.locale : 'ar';
    const t = await emailTranslator(locale);
    await sendActionEmail({
      organizationId: event.organizationId,
      kind: 'security_notice',
      userId,
      to: from,
      locale,
      brand: { name: org.name, primaryColor: org.brand.primaryColor },
      subject: t('emailChangedSubject'),
      content: {
        heading: t('emailChangedHeading'),
        paragraphs: [
          byAdmin ? t('emailChangedByAdminBody', { admin: byAdmin.name || byAdmin.email, from, to }) : t('emailChangedBody', { from, to }),
        ],
        cta: { label: t('emailChangedCta'), href: `${process.env.NEXT_PUBLIC_APP_URL}/login` },
        note: t('emailChangedNote'),
      },
      tags: { type: 'email_changed' },
    });
  },
});
