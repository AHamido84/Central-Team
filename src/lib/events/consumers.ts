import 'server-only';

import type { Consumer } from '@/lib/events/dispatcher';
import { fileNotifications } from '@/modules/files/server/consumers';
import { invitationNotifications } from '@/modules/invitations/server/consumers';
import { messageNotifications } from '@/modules/messaging/server/consumers';
import { roleNotifications } from '@/modules/rbac/server/consumers';
import { requestNotifications } from '@/modules/requests/server/consumers';

/**
 * Every consumer of `domain_events` (ARCHITECTURE §7). Add one here when a module needs to react to events;
 * producers never call consumers directly. Consumer names are stable ids stored in `domain_event_deliveries`.
 */
export const consumers: readonly Consumer[] = [
  messageNotifications,
  fileNotifications,
  requestNotifications,
  invitationNotifications,
  roleNotifications,
];
