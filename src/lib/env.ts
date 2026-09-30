import 'server-only';

import { z } from 'zod';

import { databaseUrl } from '@/lib/db/url';

const serverSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  EMAIL_PROVIDER: z.enum(['smtp', 'resend', 'console']).default('console'),
  EMAIL_FROM: z.string().min(3).default('Central <no-reply@localhost>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  RESEND_API_KEY: z.string().optional(),
  /** Bearer secret for /api/cron/* (the event dispatcher safety net). */
  CRON_SECRET: z.string().min(16).optional(),
  FORM_SIGNING_SECRET: z.string().min(16).optional(),
  // Phase 7 — integrations. A provider without its keys shows as "not configured" (sandbox still works).
  /** `1` enables the sandbox providers in production (always on outside production). */
  INTEGRATIONS_SANDBOX: z.enum(['0', '1']).optional(),
  /** HMAC key for OAuth `state` and sandbox webhook signatures (falls back to the Supabase secret key). */
  INTEGRATIONS_SIGNING_SECRET: z.string().min(16).optional(),
  META_APP_ID: z.string().min(1).optional(),
  META_APP_SECRET: z.string().min(1).optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(8).optional(),
  META_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v23.0'),
  TIKTOK_APP_ID: z.string().min(1).optional(),
  TIKTOK_APP_SECRET: z.string().min(1).optional(),
  SNAPCHAT_CLIENT_ID: z.string().min(1).optional(),
  SNAPCHAT_CLIENT_SECRET: z.string().min(1).optional(),
  SNAPCHAT_WEBHOOK_SECRET: z.string().min(8).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().min(1).optional(),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: z
    .string()
    .regex(/^\d{10}$/)
    .optional(),
  GOOGLE_LEAD_WEBHOOK_KEY: z.string().min(8).optional(),
  GOOGLE_ADS_API_VERSION: z
    .string()
    .regex(/^v\d+$/)
    .default('v21'),
  // Phase 8 — AI. Without keys the AI features show "not configured" (the mock provider runs outside production).
  /** `anthropic` = live (needs both keys); `mock` = deterministic provider (allowed in production for demos). */
  AI_PROVIDER: z.enum(['anthropic', 'mock']).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AI_MODEL: z.string().min(1).default('claude-opus-5-5'),
  VOYAGE_API_KEY: z.string().min(1).optional(),
  AI_EMBEDDING_MODEL: z.string().min(1).default('voyage-3.5'),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  // A variable set to an empty string (a blank line in .env or on Vercel) counts as unset, not as an invalid value.
  const set = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
  cached ??= serverSchema.parse({ ...set, DATABASE_URL: databaseUrl() });
  return cached;
}
