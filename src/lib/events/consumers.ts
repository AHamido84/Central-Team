import 'server-only';

import type { Consumer } from '@/lib/events/dispatcher';
import { automationEngine } from '@/modules/automations/server/engine';
import { campaignNotifications } from '@/modules/campaigns/server/consumers';
import { crmNotifications } from '@/modules/crm/server/consumers';
import { deliverableNotifications } from '@/modules/deliverables/server/consumers';
import { fileNotifications } from '@/modules/files/server/consumers';
import { integrationNotifications } from '@/modules/integrations/server/consumers';
import { invitationNotifications } from '@/modules/invitations/server/consumers';
import { messageNotifications } from '@/modules/messaging/server/consumers';
import { roleNotifications } from '@/modules/rbac/server/consumers';
import { requestNotifications } from '@/modules/requests/server/consumers';
import { slaNotifications } from '@/modules/sla/server/consumers';
import { taskNotifications } from '@/modules/tasks/server/consumers';

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
  taskNotifications,
  deliverableNotifications,
  campaignNotifications,
  slaNotifications,
  crmNotifications,
  integrationNotifications,
  // Automation rules (Phase 7, ADR-071) react to the same events as the notification consumers above.
  automationEngine,
];
