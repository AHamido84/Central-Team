import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { connectionHealth, countTemplateParams, renderTemplateBody } from '@/modules/integrations/constants';
import { aggregateToChannels, eachDay, flightDays } from '@/modules/integrations/metrics';
import { sandboxProvider, unit } from '@/modules/integrations/providers/sandbox';
import type { DailyMetric } from '@/modules/integrations/providers/types';
import {
  signSandbox,
  signState,
  verifyGoogleKey,
  verifyMetaSignature,
  verifySandboxSignature,
  verifySnapSignature,
  verifyState,
  verifyTikTokSignature,
  type OAuthState,
} from '@/modules/integrations/signatures';
import { leadFieldsFrom, parseWebhook } from '@/modules/integrations/webhook-parsers';

const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');

describe('webhook signatures', () => {
  const body = JSON.stringify({ object: 'page', entry: [] });

  it('Meta / WhatsApp: X-Hub-Signature-256 over the raw body', () => {
    const header = `sha256=${hmac('app-secret', body)}`;
    expect(verifyMetaSignature(body, header, 'app-secret')).toBe(true);
    expect(verifyMetaSignature(`${body} `, header, 'app-secret')).toBe(false);
    expect(verifyMetaSignature(body, header, 'other-secret')).toBe(false);
    expect(verifyMetaSignature(body, `sha1=${hmac('app-secret', body)}`, 'app-secret')).toBe(false);
    expect(verifyMetaSignature(body, null, 'app-secret')).toBe(false);
    expect(verifyMetaSignature(body, header, undefined)).toBe(false);
  });

  it('TikTok: timestamped signature, replays outside the window are rejected', () => {
    const now = Date.UTC(2026, 8, 30, 9);
    const t = Math.floor(now / 1000);
    const header = `t=${t},s=${hmac('tt-secret', `${t}.${body}`)}`;
    expect(verifyTikTokSignature(body, header, 'tt-secret', now)).toBe(true);
    expect(verifyTikTokSignature(body, header, 'tt-secret', now + 10 * 60_000)).toBe(false);
    expect(verifyTikTokSignature(body, header, 'wrong', now)).toBe(false);
    expect(verifyTikTokSignature(body, `t=${t}`, 'tt-secret', now)).toBe(false);
  });

  it('Snapchat: HMAC hex, with or without the sha256= prefix', () => {
    const sig = hmac('snap-secret', body);
    expect(verifySnapSignature(body, sig, 'snap-secret')).toBe(true);
    expect(verifySnapSignature(body, `sha256=${sig}`, 'snap-secret')).toBe(true);
    expect(verifySnapSignature(body, sig, 'nope')).toBe(false);
  });

  it('Google: the shared key in the body, and only when configured', () => {
    expect(verifyGoogleKey('k3y-value', 'k3y-value')).toBe(true);
    expect(verifyGoogleKey('k3y-valuf', 'k3y-value')).toBe(false);
    expect(verifyGoogleKey(undefined, 'k3y-value')).toBe(false);
    expect(verifyGoogleKey('anything', undefined)).toBe(false);
  });

  it('sandbox: sign and verify round-trip, tampering and staleness fail', () => {
    const now = Date.now();
    const header = signSandbox(body, 'sandbox-secret-xxxxxxxx', now);
    expect(verifySandboxSignature(body, header, 'sandbox-secret-xxxxxxxx', now)).toBe(true);
    expect(verifySandboxSignature(body.replace('page', 'user'), header, 'sandbox-secret-xxxxxxxx', now)).toBe(false);
    expect(verifySandboxSignature(body, header, 'sandbox-secret-xxxxxxxx', now + 6 * 60_000)).toBe(false);
  });
});

describe('OAuth state', () => {
  const state: OAuthState = {
    organizationId: 'org',
    userId: 'user',
    provider: 'meta',
    mode: 'sandbox',
    connectionId: null,
    nonce: 'nonce-123',
    exp: Date.now() + 60_000,
  };

  it('verifies with the right secret and nonce', () => {
    expect(verifyState(signState(state, 's3cret'), 's3cret', 'nonce-123')).toEqual(state);
  });

  it('rejects a wrong secret, a wrong or missing nonce cookie, a tampered body and an expired state', () => {
    const signed = signState(state, 's3cret');
    expect(verifyState(signed, 'other', 'nonce-123')).toBeNull();
    expect(verifyState(signed, 's3cret', 'nonce-999')).toBeNull();
    expect(verifyState(signed, 's3cret', undefined)).toBeNull();
    const [body, sig] = signed.split('.');
    const forged = Buffer.from(JSON.stringify({ ...state, organizationId: 'victim' })).toString('base64url');
    expect(verifyState(`${forged}.${sig}`, 's3cret', 'nonce-123')).toBeNull();
    expect(body).toBeTruthy();
    expect(verifyState(signState({ ...state, exp: Date.now() - 1 }, 's3cret'), 's3cret', 'nonce-123')).toBeNull();
  });
});

describe('metrics aggregation (sync idempotency)', () => {
  const m = (id: string, date: string, spend: number, impressions = 100): DailyMetric => ({
    externalCampaignId: id,
    date,
    impressions,
    reach: 50,
    clicks: 5,
    spend,
    conversions: 1,
    leads: 1,
    videoViews: 0,
    engagements: 2,
    revenue: 10.005,
  });
  const days = eachDay('2026-09-01', '2026-09-03');

  it('sums several platform campaigns into one channel per day and converts money once', () => {
    const out = aggregateToChannels(
      [m('c1', '2026-09-01', 10.1), m('c2', '2026-09-01', 0.2), m('c1', '2026-09-02', 3.333)],
      new Map([
        ['c1', 'ch'],
        ['c2', 'ch'],
      ]),
      new Map([['ch', days]]),
    );
    const ch = out.get('ch')!;
    expect(ch.get('2026-09-01')).toMatchObject({ impressions: 200, spendMinor: 1030, revenueMinor: 2001 });
    expect(ch.get('2026-09-02')!.spendMinor).toBe(333);
    // A day the platform reported nothing for is written as zeros (corrects restated days).
    expect(ch.get('2026-09-03')).toMatchObject({ impressions: 0, spendMinor: 0 });
  });

  it('ignores unlinked campaigns and days outside the flight; same input → same output', () => {
    const input = [m('c1', '2026-09-01', 5), m('zz', '2026-09-01', 99), m('c1', '2026-08-31', 7)];
    const links = new Map([['c1', 'ch']]);
    const flight = new Map([['ch', flightDays('2026-08-25', '2026-09-03', '2026-09-01', '2026-12-31')]]);
    const a = aggregateToChannels(input, links, flight);
    const b = aggregateToChannels([...input].reverse(), links, flight);
    expect([...a.get('ch')!.keys()]).toEqual(days);
    expect(a.get('ch')!.get('2026-09-01')!.spendMinor).toBe(500);
    expect(JSON.stringify([...a.get('ch')!])).toBe(JSON.stringify([...b.get('ch')!]));
  });

  it('flight days clip the range to the campaign dates', () => {
    expect(flightDays('2026-09-01', '2026-09-10', '2026-09-08', '2026-09-20')).toEqual(['2026-09-08', '2026-09-09', '2026-09-10']);
    expect(flightDays('2026-09-01', '2026-09-03', '2026-10-01', '2026-10-05')).toEqual([]);
  });
});

describe('sandbox provider', () => {
  const ctx = { connectionId: 'x', mode: 'sandbox' as const, tokens: { accessToken: 'sbx_a', expiresAt: null }, settings: {} };
  const account = { externalId: 'sbx_tt_3001', kind: 'ad_account' as const, metadata: {} };

  it('returns the same numbers for the same campaign and day (deterministic)', async () => {
    const p = sandboxProvider('tiktok', 'http://localhost:3000');
    const a = await p.fetchDailyMetrics!(ctx, account, { campaignIds: ['sbx_tt_3001_c1'], from: '2026-09-01', to: '2026-09-03' });
    const b = await p.fetchDailyMetrics!(ctx, account, { campaignIds: ['sbx_tt_3001_c1'], from: '2026-09-01', to: '2026-09-03' });
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
    expect(a.every((r) => r.clicks <= r.impressions && r.reach <= r.impressions && r.spend > 0)).toBe(true);
    expect(unit('x')).toBe(unit('x'));
  });

  it('expired and revoked tokens fail like a real platform', async () => {
    const p = sandboxProvider('meta', 'http://localhost:3000');
    await expect(
      p.identify({ ...ctx, tokens: { accessToken: 'sbx_a', expiresAt: new Date(Date.now() - 1000).toISOString() } }),
    ).rejects.toMatchObject({
      code: 'auth_expired',
    });
    await expect(p.identify({ ...ctx, tokens: { accessToken: 'sbx_revoked_1' } })).rejects.toMatchObject({ code: 'auth_revoked' });
    await expect(p.refresh!({ accessToken: 'sbx_a', refreshToken: null })).rejects.toMatchObject({ code: 'auth_expired' });
  });

  it('exchanges only sandbox codes; short-lived codes have no refresh token', async () => {
    const p = sandboxProvider('google', 'http://localhost:3000');
    const long = await p.exchangeCode!({ code: 'sbx.l.abcdefghij', redirectUri: '' });
    const short = await p.exchangeCode!({ code: 'sbx.s.abcdefghij', redirectUri: '' });
    expect(long.refreshToken).toBeTruthy();
    expect(short.refreshToken).toBeNull();
    expect(Date.parse(short.expiresAt!) - Date.now()).toBeLessThan(3 * 60_000);
    await expect(p.exchangeCode!({ code: 'real-code', redirectUri: '' })).rejects.toMatchObject({ code: 'auth_revoked' });
    expect(p.authorizeUrl!({ state: 's', redirectUri: 'http://localhost:3000/cb' })).toContain(
      '/integrations/sandbox/authorize?provider=google',
    );
  });

  it('WhatsApp sandbox sends only to E.164 numbers', async () => {
    const p = sandboxProvider('whatsapp', 'http://localhost:3000');
    await expect(p.sendTemplate!(ctx, { to: '+966551234567', template: 't', language: 'ar', params: [] })).resolves.toMatchObject({
      externalId: expect.stringMatching(/^wamid\.sbx\./),
    });
    await expect(p.sendTemplate!(ctx, { to: '0551234567', template: 't', language: 'ar', params: [] })).rejects.toMatchObject({
      code: 'invalid_phone',
    });
  });
});

describe('connection health and templates', () => {
  const now = new Date('2026-09-30T00:00:00Z');
  it('derives expiring / expired from the token expiry', () => {
    expect(connectionHealth({ status: 'connected', tokenExpiresAt: null }, now)).toBe('connected');
    expect(connectionHealth({ status: 'connected', tokenExpiresAt: '2026-10-30T00:00:00Z' }, now)).toBe('connected');
    expect(connectionHealth({ status: 'connected', tokenExpiresAt: '2026-10-03T00:00:00Z' }, now)).toBe('expiring');
    expect(connectionHealth({ status: 'connected', tokenExpiresAt: '2026-09-29T00:00:00Z' }, now)).toBe('expired');
    expect(connectionHealth({ status: 'disconnected', tokenExpiresAt: '2026-10-30T00:00:00Z' }, now)).toBe('disconnected');
  });

  it('renders WhatsApp template variables', () => {
    expect(renderTemplateBody('Hi {{1}}, from {{2}}. {{3}}', ['Sara', 'Ofoq'])).toBe('Hi Sara, from Ofoq. {{3}}');
    expect(countTemplateParams('{{1}} and {{2}} and {{1}}')).toBe(2);
    expect(countTemplateParams('no vars')).toBe(0);
  });
});

describe('webhook payload parsing', () => {
  it('Meta leadgen → one lead item routed by page, answers fetched later', () => {
    const items = parseWebhook('meta', {
      object: 'page',
      entry: [{ id: '123', changes: [{ field: 'leadgen', value: { leadgen_id: '9001', page_id: '123', form_id: '77' } }] }],
    });
    expect(items).toEqual([
      { topic: 'lead', externalId: '9001', route: { kind: 'page', externalId: '123' }, leadId: '9001', formId: '77', fields: null },
    ]);
  });

  it('WhatsApp statuses → one item per status with the error; inbound messages are logged', () => {
    const items = parseWebhook('whatsapp', {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'pn1' },
                statuses: [
                  { id: 'wamid.1', status: 'delivered', timestamp: '1759200000' },
                  { id: 'wamid.2', status: 'failed', timestamp: '1759200000', errors: [{ code: 131026, title: 'Undeliverable' }] },
                ],
                messages: [{ id: 'wamid.in' }],
              },
            },
          ],
        },
      ],
    });
    expect(items.map((i) => [i.topic, i.externalId])).toEqual([
      ['message_status', 'wamid.1:delivered'],
      ['message_status', 'wamid.2:failed'],
      ['message', 'wamid.in'],
    ]);
    expect(items[1]).toMatchObject({ errorCode: '131026', errorTitle: 'Undeliverable' });
  });

  it('TikTok, Snapchat and Google lead payloads carry their answers', () => {
    const tt = parseWebhook('tiktok', {
      advertiser_id: 'adv',
      lead_id: 'L1',
      form_id: 'F',
      fields: [{ name: 'Phone_Number', value: '0551234567' }],
    });
    expect(tt[0]).toMatchObject({ route: { kind: 'ad_account', externalId: 'adv' }, fields: { phone_number: '0551234567' } });
    const snap = parseWebhook('snapchat', { ad_account_id: 'sa', lead_id: 'S1', answers: [{ question: 'email', answer: 'a@b.co' }] });
    expect(snap[0]).toMatchObject({ route: { kind: 'ad_account', externalId: 'sa' }, fields: { email: 'a@b.co' } });
    const g = parseWebhook('google', {
      lead_id: 'G1',
      campaign_id: '555',
      google_key: 'k',
      user_column_data: [
        { column_id: 'FULL_NAME', string_value: 'Noura A' },
        { column_id: 'PHONE_NUMBER', string_value: '+966501112222' },
      ],
    });
    expect(g[0]).toMatchObject({ route: { campaignId: '555' }, fields: { full_name: 'Noura A', phone_number: '+966501112222' } });
    expect(parseWebhook('google', { nothing: true })).toEqual([]);
  });

  it('maps answers to lead fields across platforms, extras go to the message', () => {
    expect(leadFieldsFrom({ first_name: 'Sara', last_name: 'Ali', phone: '055', budget: '10k' })).toEqual({
      fullName: 'Sara Ali',
      phone: '055',
      email: null,
      company: null,
      city: null,
      message: 'budget: 10k',
    });
  });
});
