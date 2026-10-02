import type admin from '@messages/ar/admin.json';
import type auth from '@messages/ar/auth.json';
import type clients from '@messages/ar/clients.json';
import type common from '@messages/ar/common.json';
import type dashboard from '@messages/ar/dashboard.json';
import type designSystem from '@messages/ar/designSystem.json';
import type emails from '@messages/ar/emails.json';
import type errors from '@messages/ar/errors.json';
import type files from '@messages/ar/files.json';
import type messaging from '@messages/ar/messaging.json';
import type nav from '@messages/ar/nav.json';
import type notifications from '@messages/ar/notifications.json';
import type onboarding from '@messages/ar/onboarding.json';
import type portal from '@messages/ar/portal.json';
import type reports from '@messages/ar/reports.json';
import type requests from '@messages/ar/requests.json';
import type settings from '@messages/ar/settings.json';
import type tasks from '@messages/ar/tasks.json';
import type workflows from '@messages/ar/workflows.json';
import type campaigns from '@messages/ar/campaigns.json';
import type deliverables from '@messages/ar/deliverables.json';
import type validation from '@messages/ar/validation.json';
import type sla from '@messages/ar/sla.json';
import type operations from '@messages/ar/operations.json';
import type crm from '@messages/ar/crm.json';
import type capacity from '@messages/ar/capacity.json';
import type integrations from '@messages/ar/integrations.json';
import type automations from '@messages/ar/automations.json';
import type ai from '@messages/ar/ai.json';
import type data from '@messages/ar/data.json';
import type mail from '@messages/ar/mail.json';

/** Arabic (the default locale) is the source of truth for message keys; scripts/check-i18n.ts enforces parity. */
export type AppMessages = {
  admin: typeof admin;
  auth: typeof auth;
  clients: typeof clients;
  common: typeof common;
  dashboard: typeof dashboard;
  designSystem: typeof designSystem;
  emails: typeof emails;
  errors: typeof errors;
  files: typeof files;
  messaging: typeof messaging;
  nav: typeof nav;
  notifications: typeof notifications;
  onboarding: typeof onboarding;
  portal: typeof portal;
  requests: typeof requests;
  settings: typeof settings;
  tasks: typeof tasks;
  workflows: typeof workflows;
  deliverables: typeof deliverables;
  campaigns: typeof campaigns;
  reports: typeof reports;
  validation: typeof validation;
  sla: typeof sla;
  operations: typeof operations;
  crm: typeof crm;
  capacity: typeof capacity;
  integrations: typeof integrations;
  automations: typeof automations;
  ai: typeof ai;
  data: typeof data;
  mail: typeof mail;
};

declare module 'next-intl' {
  interface AppConfig {
    Locale: 'ar' | 'en';
    Messages: AppMessages;
  }
}
