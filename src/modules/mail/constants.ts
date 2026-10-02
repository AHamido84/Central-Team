/** Sender presets (FR2.1): picking one fills host / port / security; the limit is the provider's documented daily cap. */
export const mailPresets = ['gmail', 'google_workspace', 'microsoft365', 'zoho', 'resend', 'smtp'] as const;
export type MailPreset = (typeof mailPresets)[number];

export const mailSecurities = ['starttls', 'ssl', 'none'] as const;
export type MailSecurity = (typeof mailSecurities)[number];

export type PresetDefaults = {
  host: string | null;
  port: number | null;
  security: MailSecurity;
  /** Messages per day the provider allows (a conservative default the admin can change). */
  dailyLimit: number | null;
  /** The provider rewrites or rejects a From address other than the signed-in account or a verified alias. */
  fromMustMatchUser: boolean;
  /** Uses an API key instead of SMTP. */
  api: boolean;
  /** Where to create the credential. */
  helpUrl: string | null;
};

export const presetDefaults: Record<MailPreset, PresetDefaults> = {
  gmail: {
    host: 'smtp.gmail.com',
    port: 587,
    security: 'starttls',
    dailyLimit: 500,
    fromMustMatchUser: true,
    api: false,
    helpUrl: 'https://myaccount.google.com/apppasswords',
  },
  google_workspace: {
    host: 'smtp.gmail.com',
    port: 587,
    security: 'starttls',
    dailyLimit: 2000,
    fromMustMatchUser: true,
    api: false,
    helpUrl: 'https://myaccount.google.com/apppasswords',
  },
  microsoft365: {
    host: 'smtp.office365.com',
    port: 587,
    security: 'starttls',
    dailyLimit: 10000,
    fromMustMatchUser: true,
    api: false,
    helpUrl: 'https://learn.microsoft.com/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission',
  },
  zoho: {
    host: 'smtp.zoho.com',
    port: 587,
    security: 'starttls',
    dailyLimit: 500,
    fromMustMatchUser: true,
    api: false,
    helpUrl: 'https://www.zoho.com/mail/help/zoho-smtp.html',
  },
  resend: {
    host: null,
    port: null,
    security: 'starttls',
    dailyLimit: 3000,
    fromMustMatchUser: false,
    api: true,
    helpUrl: 'https://resend.com/api-keys',
  },
  smtp: { host: null, port: 587, security: 'starttls', dailyLimit: null, fromMustMatchUser: false, api: false, helpUrl: null },
};

export const outboxStatuses = ['queued', 'sending', 'sent', 'failed'] as const;
export type OutboxStatus = (typeof outboxStatuses)[number];

export const emailKinds = [
  'magic_link',
  'recovery',
  'email_change',
  'invitation',
  'notification',
  'security_notice',
  'report',
  'test',
  'other',
] as const;
export type EmailKind = (typeof emailKinds)[number];

export const senderKinds = ['configured', 'environment', 'fallback', 'dev'] as const;
export type SenderKind = (typeof senderKinds)[number];

/** Delivery problems, explained in the UI (`mail.errors.*`). */
export const mailErrorCodes = [
  'auth_failed',
  'port_blocked',
  'timeout',
  'tls_failed',
  'host_not_found',
  'sender_rejected',
  'recipient_rejected',
  'api_key_invalid',
  'rate_limited',
  'daily_limit',
  'not_configured',
  'unknown',
] as const;
export type MailErrorCode = (typeof mailErrorCodes)[number];

/** Retry delays after attempt 1, 2, 3, 4 (then the message is marked failed for good). */
export const RETRY_MINUTES = [1, 5, 15, 60] as const;
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
export const OUTBOX_RETENTION_DAYS = 90;
/** Warn admins when today's sends reach this share of the daily limit. */
export const LIMIT_WARNING_SHARE = 0.8;
