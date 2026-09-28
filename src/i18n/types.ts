import type admin from '../../messages/ar/admin.json';
import type auth from '../../messages/ar/auth.json';
import type clients from '../../messages/ar/clients.json';
import type common from '../../messages/ar/common.json';
import type dashboard from '../../messages/ar/dashboard.json';
import type designSystem from '../../messages/ar/designSystem.json';
import type emails from '../../messages/ar/emails.json';
import type errors from '../../messages/ar/errors.json';
import type files from '../../messages/ar/files.json';
import type messaging from '../../messages/ar/messaging.json';
import type nav from '../../messages/ar/nav.json';
import type notifications from '../../messages/ar/notifications.json';
import type onboarding from '../../messages/ar/onboarding.json';
import type portal from '../../messages/ar/portal.json';
import type settings from '../../messages/ar/settings.json';
import type validation from '../../messages/ar/validation.json';

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
  settings: typeof settings;
  validation: typeof validation;
};

declare module 'next-intl' {
  interface AppConfig {
    Locale: 'ar' | 'en';
    Messages: AppMessages;
  }
}
