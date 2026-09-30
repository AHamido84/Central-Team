import 'server-only';

import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import {
  crmActivities,
  integrationConnections,
  notificationPreferences,
  profiles,
  whatsappMessages,
  whatsappOptIns,
  whatsappTemplates,
} from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { renderTemplateBody, terminalErrors, type ProviderErrorCode } from '@/modules/integrations/constants';
import { signingSecret } from '@/modules/integrations/providers';
import { ProviderError } from '@/modules/integrations/providers/types';
import { signSandbox } from '@/modules/integrations/signatures';
import { serviceTx, withConnection } from '@/modules/integrations/server/connections';
import { processWebhookEvents, receiveWebhook, SANDBOX_SIGNATURE_HEADER } from '@/modules/integrations/server/webhooks';

export type Template = typeof whatsappTemplates.$inferSelect;

export type SendInput = {
  organizationId: string;
  template: Template;
  to: string;
  params: string[];
  purpose: 'notification' | 'lead' | 'automation';
  leadId?: string | null;
  dealId?: string | null;
  recipientUserId?: string | null;
  notificationType?: string | null;
  automationRunId?: string | null;
  sentBy?: string | null;
};

export type SendResult = { messageId: string; status: 'sent' | 'failed'; errorCode: string | null };

/**
 * Sends one approved template message and logs it (service path: the platform call and the log row). Callers check
 * the permission and the recipient first (RLS lookup of the lead / deal, or the opt-in for notifications).
 * A lead message is also recorded as a completed WhatsApp activity on the lead / deal.
 */
export async function sendWhatsApp(input: SendInput): Promise<SendResult> {
  const t = input.template;
  const params = input.params.slice(0, t.paramCount).map((p) => p.slice(0, 1000));
  while (params.length < t.paramCount) params.push('-');
  const body = renderTemplateBody(t.body, params);
  const [row] = await dbAdmin
    .insert(whatsappMessages)
    .values({
      organizationId: input.organizationId,
      connectionId: t.connectionId,
      toPhone: input.to,
      templateName: t.name,
      language: t.language,
      params,
      body,
      purpose: input.purpose,
      leadId: input.leadId ?? null,
      dealId: input.dealId ?? null,
      recipientUserId: input.recipientUserId ?? null,
      notificationType: input.notificationType ?? null,
      automationRunId: input.automationRunId ?? null,
      sentBy: input.sentBy ?? null,
    })
    .returning({ id: whatsappMessages.id });
  const messageId = row!.id;
  return deliver(messageId, t, input);
}

async function deliver(
  messageId: string,
  t: Template,
  input: Omit<SendInput, 'template' | 'params'> & { params?: string[] },
): Promise<SendResult> {
  const [msg] = await dbAdmin.select().from(whatsappMessages).where(eq(whatsappMessages.id, messageId));
  if (!msg) throw new Error('message_missing');
  let mode: string = 'live';
  try {
    if (t.status !== 'approved') throw new ProviderError('template_not_approved', t.name);
    const { externalId } = await withConnection(t.connectionId, async ({ provider, ctx, connection }) => {
      mode = connection.mode;
      if (!provider.sendTemplate) throw new ProviderError('not_configured', 'no WhatsApp sender');
      return provider.sendTemplate(ctx, {
        to: msg.toPhone,
        template: t.name,
        language: t.language as 'ar' | 'en',
        languageCode: t.languageCode || t.language,
        params: msg.params,
      });
    });
    await serviceTx(input.sentBy ?? null, async (tx) => {
      await tx
        .update(whatsappMessages)
        .set({ status: 'sent', externalId, sentAt: new Date(), attempts: msg.attempts + 1, errorCode: null, errorMessage: null })
        .where(eq(whatsappMessages.id, messageId));
      if (msg.leadId || msg.dealId)
        await tx.insert(crmActivities).values({
          organizationId: msg.organizationId,
          leadId: msg.leadId,
          dealId: msg.dealId,
          type: 'whatsapp',
          subject: 'whatsapp_sent',
          body: msg.body,
          ownerId: msg.sentBy,
          completedAt: new Date(),
        });
      await emitEvent(tx, {
        type: 'whatsapp.message_sent',
        organizationId: msg.organizationId,
        actorId: msg.sentBy,
        aggregate: { type: 'whatsapp_message', id: messageId },
        payload: { messageId, purpose: msg.purpose as SendInput['purpose'], leadId: msg.leadId, dealId: msg.dealId },
      });
    });
    if (mode === 'sandbox') await simulateSandboxDelivery(externalId, t.connectionId);
    return { messageId, status: 'sent', errorCode: null };
  } catch (error) {
    const failure = error instanceof ProviderError ? error : new ProviderError('platform_error', String(error));
    await serviceTx(null, async (tx) => {
      await tx
        .update(whatsappMessages)
        .set({
          status: 'failed',
          attempts: msg.attempts + 1,
          failedAt: new Date(),
          errorCode: failure.code,
          errorMessage: failure.detail.slice(0, 300),
        })
        .where(eq(whatsappMessages.id, messageId));
      await emitEvent(tx, {
        type: 'whatsapp.message_failed',
        organizationId: msg.organizationId,
        actorId: null,
        aggregate: { type: 'whatsapp_message', id: messageId },
        payload: { messageId, errorCode: failure.code },
      });
    });
    return { messageId, status: 'failed', errorCode: failure.code };
  }
}

/**
 * The sandbox has no platform to call us back, so it plays the platform's part: a signed status webhook
 * (`delivered`, then `read`) goes through the same receiver as a live one — signature, dedup, forward-only status.
 */
async function simulateSandboxDelivery(externalId: string, connectionId: string) {
  const [account] = await dbAdmin
    .select({ settings: integrationConnections.settings })
    .from(integrationConnections)
    .where(eq(integrationConnections.id, connectionId));
  const phoneNumberId = account?.settings.phoneNumberId ?? 'sbx_wa_7001';
  for (const status of ['delivered', 'read'] as const) {
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'sbx_waba',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: phoneNumberId },
                statuses: [{ id: externalId, status, timestamp: String(Math.floor(Date.now() / 1000)) }],
              },
            },
          ],
        },
      ],
    });
    const headers = new Headers({ [SANDBOX_SIGNATURE_HEADER]: signSandbox(raw, signingSecret()) });
    const received = await receiveWebhook('whatsapp', raw, headers);
    await processWebhookEvents(received.accepted);
  }
}

/** Failed messages that may succeed on a second try (not a bad number or template), once, from the sweep. */
export async function retryFailedMessages(limit = 20): Promise<number> {
  const failed = await dbAdmin
    .select()
    .from(whatsappMessages)
    .where(and(eq(whatsappMessages.status, 'failed'), isNull(whatsappMessages.externalId), eq(whatsappMessages.attempts, 1)))
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(limit);
  let retried = 0;
  for (const m of failed) {
    if (terminalErrors.includes(m.errorCode as ProviderErrorCode)) continue;
    const [t] = await dbAdmin
      .select()
      .from(whatsappTemplates)
      .where(
        and(
          eq(whatsappTemplates.connectionId, m.connectionId!),
          eq(whatsappTemplates.name, m.templateName),
          eq(whatsappTemplates.language, m.language),
        ),
      );
    if (!t) continue;
    await deliver(m.id, t, { organizationId: m.organizationId, to: m.toPhone, purpose: m.purpose as SendInput['purpose'] });
    retried++;
  }
  return retried;
}

/** The organization's notification template for a language (falls back to the other language). */
async function notificationTemplate(organizationId: string, locale: 'ar' | 'en'): Promise<Template | null> {
  const rows = await dbAdmin
    .select({ t: whatsappTemplates })
    .from(whatsappTemplates)
    .innerJoin(integrationConnections, eq(integrationConnections.id, whatsappTemplates.connectionId))
    .where(
      and(
        eq(whatsappTemplates.organizationId, organizationId),
        eq(whatsappTemplates.isNotification, true),
        eq(whatsappTemplates.status, 'approved'),
        eq(integrationConnections.status, 'connected'),
      ),
    );
  return rows.find((r) => r.t.language === locale)?.t ?? rows[0]?.t ?? null;
}

/**
 * WhatsApp leg of `notify()` (ADR-070): only for recipients with an active opt-in and the category's WhatsApp switch
 * on, through the organization's approved notification template ({{1}} title, {{2}} body + link).
 */
export async function sendNotificationWhatsApp(input: {
  organizationId: string;
  category: string;
  type: string;
  recipients: string[];
  content: (locale: 'ar' | 'en') => Promise<{ title: string; body: string }>;
}): Promise<number> {
  if (!input.recipients.length) return 0;
  const wanted = await dbAdmin
    .select({ userId: notificationPreferences.userId })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.organizationId, input.organizationId),
        eq(notificationPreferences.category, input.category),
        eq(notificationPreferences.whatsapp, true),
        inArray(notificationPreferences.userId, input.recipients),
      ),
    );
  if (!wanted.length) return 0;
  const optedIn = await dbAdmin
    .select({ userId: whatsappOptIns.userId, phone: whatsappOptIns.phone, locale: profiles.locale })
    .from(whatsappOptIns)
    .innerJoin(profiles, eq(profiles.id, whatsappOptIns.userId))
    .where(
      and(
        eq(whatsappOptIns.organizationId, input.organizationId),
        inArray(
          whatsappOptIns.userId,
          wanted.map((w) => w.userId),
        ),
        isNotNull(whatsappOptIns.optedInAt),
        isNull(whatsappOptIns.optedOutAt),
      ),
    );
  let sent = 0;
  for (const person of optedIn) {
    const locale = person.locale === 'en' ? 'en' : 'ar';
    const template = await notificationTemplate(input.organizationId, locale);
    if (!template) return sent;
    const content = await input.content(template.language as 'ar' | 'en');
    const result = await sendWhatsApp({
      organizationId: input.organizationId,
      template,
      to: person.phone,
      params: [content.title, content.body],
      purpose: 'notification',
      recipientUserId: person.userId,
      notificationType: input.type,
    });
    if (result.status === 'sent') sent++;
  }
  return sent;
}
