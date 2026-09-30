import type { AccountKind, MessageStatus, ProviderKey } from '@/modules/integrations/constants';

/**
 * Inbound platform payloads → normalized items (pure). Each item says which of our accounts it belongs to
 * (`route`), its dedup key and what to do with it. Unknown shapes produce no items (logged as ignored).
 */
export type WebhookItem =
  | {
      topic: 'lead';
      externalId: string;
      route: { kind: AccountKind; externalId: string } | { campaignId: string };
      leadId: string;
      formId: string | null;
      /** Answers when the platform sends them (TikTok, Snapchat, Google, sandbox); Meta sends only the id. */
      fields: Record<string, string> | null;
    }
  | {
      topic: 'message_status';
      externalId: string;
      route: { kind: 'whatsapp_number'; externalId: string };
      messageId: string;
      status: Exclude<MessageStatus, 'queued'>;
      /** ISO time (items are stored as jsonb and processed later). */
      at: string;
      errorCode: string | null;
      errorTitle: string | null;
    }
  | { topic: 'message'; externalId: string; route: { kind: 'whatsapp_number'; externalId: string } };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : typeof v === 'number' ? String(v) : null);

function fieldList(list: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of list) {
    const o = obj(f);
    const name = str(o.name) ?? str(o.column_id) ?? str(o.key) ?? str(o.question);
    const value = str(o.value) ?? str(o.string_value) ?? str(arr(o.values)[0]) ?? str(o.answer);
    if (name && value) out[name.toLowerCase()] = value;
  }
  return out;
}

/** Meta pages (`leadgen`) and WhatsApp Business (`statuses`, `messages`) share the Graph webhook envelope. */
function parseMetaEnvelope(body: Obj): WebhookItem[] {
  const items: WebhookItem[] = [];
  for (const entry of arr(body.entry)) {
    for (const change of arr(obj(entry).changes)) {
      const c = obj(change);
      const value = obj(c.value);
      if (c.field === 'leadgen') {
        const leadId = str(value.leadgen_id);
        const pageId = str(value.page_id) ?? str(obj(entry).id);
        if (!leadId || !pageId) continue;
        const inline = arr(value.field_data);
        items.push({
          topic: 'lead',
          externalId: leadId,
          route: { kind: 'page', externalId: pageId },
          leadId,
          formId: str(value.form_id),
          fields: inline.length ? fieldList(inline) : null,
        });
      } else if (c.field === 'messages') {
        const numberId = str(obj(value.metadata).phone_number_id);
        if (!numberId) continue;
        for (const s of arr(value.statuses)) {
          const so = obj(s);
          const id = str(so.id);
          const status = str(so.status);
          if (!id || !status || !['sent', 'delivered', 'read', 'failed'].includes(status)) continue;
          const error = obj(arr(so.errors)[0]);
          const ts = Number(so.timestamp);
          items.push({
            topic: 'message_status',
            externalId: `${id}:${status}`,
            route: { kind: 'whatsapp_number', externalId: numberId },
            messageId: id,
            status: status as Exclude<MessageStatus, 'queued'>,
            at: (Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date()).toISOString(),
            errorCode: str(error.code),
            errorTitle: str(error.title) ?? str(error.message),
          });
        }
        for (const m of arr(value.messages)) {
          const id = str(obj(m).id);
          if (id) items.push({ topic: 'message', externalId: id, route: { kind: 'whatsapp_number', externalId: numberId } });
        }
      }
    }
  }
  return items;
}

/**
 * TikTok Lead Generation webhook (instant form): `{ advertiser_id, lead_id, form_id, fields: [{ name, value }] }`.
 * Snapchat Lead Generation webhook: `{ ad_account_id, lead_id, lead_form_id, fields | answers: [{ name, value }] }`.
 * (Shapes to be confirmed against each platform's developer console when live apps exist — ADR-069.)
 */
function parseLeadList(body: Obj, accountKey: string, formKey: string): WebhookItem[] {
  const events = Array.isArray(body.leads) ? arr(body.leads) : [body];
  const items: WebhookItem[] = [];
  for (const e of events) {
    const o = obj(e);
    const leadId = str(o.lead_id) ?? str(o.id);
    const account = str(o[accountKey]) ?? str(body[accountKey]);
    if (!leadId || !account) continue;
    items.push({
      topic: 'lead',
      externalId: leadId,
      route: { kind: 'ad_account', externalId: account },
      leadId,
      formId: str(o[formKey]),
      fields: fieldList([...arr(o.fields), ...arr(o.answers), ...arr(o.field_data)]),
    });
  }
  return items;
}

/** Google Ads lead form extension webhook (documented shape): routed by the platform campaign id. */
function parseGoogle(body: Obj): WebhookItem[] {
  const leadId = str(body.lead_id);
  const campaignId = str(body.campaign_id);
  if (!leadId || !campaignId) return [];
  return [
    {
      topic: 'lead',
      externalId: leadId,
      route: { campaignId },
      leadId,
      formId: str(body.form_id),
      fields: fieldList(arr(body.user_column_data)),
    },
  ];
}

export function parseWebhook(provider: ProviderKey, body: unknown): WebhookItem[] {
  const b = obj(body);
  switch (provider) {
    case 'meta':
    case 'whatsapp':
      return parseMetaEnvelope(b);
    case 'tiktok':
      return parseLeadList(b, 'advertiser_id', 'form_id');
    case 'snapchat':
      return parseLeadList(b, 'ad_account_id', 'lead_form_id');
    case 'google':
      return parseGoogle(b);
    case 'x':
    case 'linkedin':
      return [];
  }
}

/** Lead form answers → our lead fields. Keys are matched loosely across platforms (Meta, TikTok, Snap, Google). */
export function leadFieldsFrom(fields: Record<string, string>): {
  fullName: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  city: string | null;
  message: string;
} {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = fields[k]?.trim();
      if (v) return v;
    }
    return null;
  };
  const first = pick('first_name', 'given_name');
  const last = pick('last_name', 'family_name');
  const fullName = pick('full_name', 'name', 'fullname') ?? ([first, last].filter(Boolean).join(' ') || null);
  const known = new Set([
    'full_name',
    'name',
    'fullname',
    'first_name',
    'given_name',
    'last_name',
    'family_name',
    'phone_number',
    'phone',
    'mobile',
    'email',
    'work_email',
    'company_name',
    'company',
    'city',
    'region',
  ]);
  const extras = Object.entries(fields)
    .filter(([k]) => !known.has(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  return {
    fullName: fullName?.slice(0, 120) ?? null,
    phone: pick('phone_number', 'phone', 'mobile'),
    email: pick('email', 'work_email'),
    company: pick('company_name', 'company')?.slice(0, 160) ?? null,
    city: pick('city', 'region'),
    message: extras.slice(0, 2000),
  };
}
