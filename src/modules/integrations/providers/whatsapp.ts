import 'server-only';

import { classifyMeta } from '@/modules/integrations/providers/meta';
import { form, requestJson } from '@/modules/integrations/providers/http';
import { ProviderError, type ExternalTemplate, type IntegrationProvider } from '@/modules/integrations/providers/types';

type WhatsAppConfig = { version: string };

/** `en_US` → `en`; templates in other languages are not offered (the app speaks Arabic and English). */
export function normalizeTemplateLanguage(code: string): 'ar' | 'en' | null {
  const base = code.toLowerCase().split(/[_-]/)[0];
  return base === 'ar' || base === 'en' ? base : null;
}

const categoryOf = (c: string): ExternalTemplate['category'] =>
  c === 'MARKETING' ? 'marketing' : c === 'AUTHENTICATION' ? 'authentication' : 'utility';
const statusOf = (s: string): ExternalTemplate['status'] =>
  s === 'APPROVED' ? 'approved' : s === 'REJECTED' ? 'rejected' : s === 'PAUSED' || s === 'DISABLED' ? 'paused' : 'pending';

/**
 * WhatsApp Business Cloud API. Connects with a system-user token (Meta Business settings → System users) plus the
 * phone number id and WhatsApp Business Account id; sends approved templates; statuses arrive by webhook.
 */
export function whatsappProvider(config: WhatsAppConfig): IntegrationProvider {
  const graph = `https://graph.facebook.com/${config.version}`;
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  return {
    key: 'whatsapp',
    mode: 'live',
    async connectWithToken(input) {
      const accessToken = input.accessToken?.trim() ?? '';
      const phoneNumberId = input.phoneNumberId?.trim() ?? '';
      const wabaId = input.wabaId?.trim() ?? '';
      if (!/^\d{5,30}$/.test(phoneNumberId) || !/^\d{5,30}$/.test(wabaId) || accessToken.length < 20)
        throw new ProviderError('invalid_response', 'phone number id, WABA id and token are required');
      // Validates the token against the number before anything is stored.
      await requestJson(`${graph}/${phoneNumberId}?${form({ fields: 'display_phone_number' })}`, {
        headers: auth(accessToken),
        classify: classifyMeta,
      });
      return { tokens: { accessToken, expiresAt: null, scopes: ['whatsapp_business_messaging'] }, settings: { phoneNumberId, wabaId } };
    },
    async identify(ctx) {
      const waba = await requestJson<{ id: string; name?: string }>(`${graph}/${ctx.settings.wabaId}?${form({ fields: 'id,name' })}`, {
        headers: auth(ctx.tokens.accessToken),
        classify: classifyMeta,
      });
      return { externalUserId: waba.id, name: waba.name ?? waba.id, scopes: ['whatsapp_business_messaging'] };
    },
    async listAccounts(ctx) {
      const n = await requestJson<{ id: string; display_phone_number: string; verified_name?: string }>(
        `${graph}/${ctx.settings.phoneNumberId}?${form({ fields: 'id,display_phone_number,verified_name' })}`,
        { headers: auth(ctx.tokens.accessToken), classify: classifyMeta },
      );
      return [
        {
          kind: 'whatsapp_number',
          externalId: n.id,
          name: n.verified_name ? `${n.verified_name} · ${n.display_phone_number}` : n.display_phone_number,
          metadata: { displayPhone: n.display_phone_number },
        },
      ];
    },
    async listTemplates(ctx) {
      type Row = { name: string; language: string; status: string; category: string; components?: { type: string; text?: string }[] };
      const out: ExternalTemplate[] = [];
      let url: string | undefined =
        `${graph}/${ctx.settings.wabaId}/message_templates?${form({ fields: 'name,language,status,category,components', limit: '200' })}`;
      for (let i = 0; url && i < 20; i++) {
        const page: { data: Row[]; paging?: { next?: string } } = await requestJson(url, {
          headers: auth(ctx.tokens.accessToken),
          classify: classifyMeta,
        });
        for (const t of page.data) {
          const language = normalizeTemplateLanguage(t.language);
          if (!language) continue;
          out.push({
            name: t.name,
            language,
            languageCode: t.language,
            category: categoryOf(t.category),
            status: statusOf(t.status),
            body: t.components?.find((c) => c.type === 'BODY')?.text ?? '',
          });
        }
        url = page.paging?.next;
      }
      return out;
    },
    async sendTemplate(ctx, message) {
      if (!/^\+[1-9]\d{7,14}$/.test(message.to)) throw new ProviderError('invalid_phone', message.to);
      const res = await requestJson<{ messages?: { id: string }[] }>(`${graph}/${ctx.settings.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { ...auth(ctx.tokens.accessToken), 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: message.to.slice(1),
          type: 'template',
          template: {
            name: message.template,
            language: { code: message.languageCode ?? message.language },
            components: message.params.length ? [{ type: 'body', parameters: message.params.map((text) => ({ type: 'text', text })) }] : [],
          },
        }),
        classify: (status, body) => {
          const code = (body as { error?: { code?: number } } | null)?.error?.code;
          if (code === 131026 || code === 131021) return 'invalid_phone';
          if (code === 132000 || code === 132001 || code === 132015) return 'template_not_approved';
          return classifyMeta(status, body);
        },
      });
      const id = res.messages?.[0]?.id;
      if (!id) throw new ProviderError('invalid_response', 'no message id');
      return { externalId: id };
    },
  };
}
