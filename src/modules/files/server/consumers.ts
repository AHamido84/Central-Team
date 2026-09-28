import 'server-only';

import { and, eq } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { clientAssignments, clientUsers, clients, files, profiles } from '@/lib/db/schema';
import { defineConsumer } from '@/lib/events/dispatcher';
import { localized } from '@/lib/i18n/localized';
import { notify } from '@/modules/notifications/server/notify';

/** `file.uploaded` (library, client-visible) → the other side hears about it. Attachments notify via their message/request. */
export const fileNotifications = defineConsumer({
  name: 'notifications.files',
  types: ['file.uploaded'],
  async handle(event) {
    const [file] = await dbAdmin.select().from(files).where(eq(files.id, event.payload.fileId));
    if (!file || file.deletedAt || file.source !== 'library' || file.visibility !== 'client') return;
    const [client] = await dbAdmin.select().from(clients).where(eq(clients.id, file.clientId));
    if (!client) return;
    const [actor] = file.uploadedBy
      ? await dbAdmin.select({ name: profiles.fullName }).from(profiles).where(eq(profiles.id, file.uploadedBy))
      : [];
    const base = { organizationId: event.organizationId, actorId: file.uploadedBy, eventId: event.id };
    if (file.uploaderSide === 'agency') {
      const recipients = await dbAdmin
        .select({ userId: clientUsers.userId })
        .from(clientUsers)
        .where(and(eq(clientUsers.clientId, file.clientId), eq(clientUsers.status, 'active')));
      await notify({
        ...base,
        userIds: recipients.map((r) => r.userId),
        type: 'file_shared',
        params: { file: file.name, actor: actor?.name ?? '' },
        link: file.folderId ? `/portal/files?folder=${file.folderId}` : '/portal/files',
      });
      return;
    }
    const team = await dbAdmin
      .select({ userId: clientAssignments.userId })
      .from(clientAssignments)
      .where(eq(clientAssignments.clientId, file.clientId));
    await notify({
      ...base,
      userIds: [client.accountManagerId, ...team.map((m) => m.userId)].filter(Boolean) as string[],
      type: 'file_uploaded_by_client',
      params: { file: file.name, actor: actor?.name ?? '', client: localized(client.name, 'ar') || localized(client.name, 'en') },
      link: `/clients/${file.clientId}?tab=files`,
    });
  },
});
