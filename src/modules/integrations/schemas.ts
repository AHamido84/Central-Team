import { z } from 'zod';

import { connectionModes, providerKeys, SYNC } from '@/modules/integrations/constants';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const startOAuthSchema = z.object({
  provider: z.enum(providerKeys).exclude(['whatsapp']),
  mode: z.enum(connectionModes),
  connectionId: z.uuid().nullable().default(null),
});

export const connectWhatsAppSchema = z.object({
  mode: z.enum(connectionModes),
  connectionId: z.uuid().nullable().default(null),
  accessToken: z.string().trim().max(2000).default(''),
  phoneNumberId: z.string().trim().max(40).default(''),
  wabaId: z.string().trim().max(40).default(''),
});

export const connectionIdSchema = z.object({ connectionId: z.uuid() });

export const renameConnectionSchema = z.object({ connectionId: z.uuid(), name: z.string().trim().min(1).max(120) });

export const mapAccountSchema = z.object({ accountId: z.uuid(), clientId: z.uuid().nullable(), syncEnabled: z.boolean() });

export const linkCampaignSchema = z.object({ linkId: z.uuid(), channelId: z.uuid().nullable() });

export const syncSchema = z
  .object({
    connectionId: z.uuid(),
    accountId: z.uuid().nullable().default(null),
    trigger: z.enum(['manual', 'backfill']),
    from: day,
    to: day,
  })
  .refine((v) => v.from <= v.to, { message: 'range_order', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= SYNC.maxBackfillDays, {
    message: 'range_too_long',
    path: ['from'],
  });

export const retryRunSchema = z.object({ runId: z.uuid() });

export const notificationTemplateSchema = z.object({ templateId: z.uuid(), isNotification: z.boolean() });

export const sendWhatsAppSchema = z
  .object({
    leadId: z.uuid().nullable().default(null),
    dealId: z.uuid().nullable().default(null),
    templateId: z.uuid(),
    params: z.array(z.string().trim().min(1).max(500)).max(10),
  })
  .refine((v) => !!v.leadId !== !!v.dealId, { message: 'subject_required', path: ['leadId'] });

export const optInSchema = z.object({
  phone: z.string().trim().min(8).max(20),
  consent: z.literal(true, { message: 'consent_required' }),
});
