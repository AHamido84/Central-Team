import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Inbound webhook signature checks (pure; secrets are passed in so they can be unit-tested). Every platform webhook
 * is verified before anything is parsed or stored with its payload (ADR-069).
 */

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const hmacHex = (secret: string, data: string) => createHmac('sha256', secret).update(data, 'utf8').digest('hex');

/** Meta and WhatsApp: `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(app secret, raw body)>`. */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string | undefined): boolean {
  if (!header || !appSecret) return false;
  const [algo, sig] = header.split('=', 2);
  if (algo !== 'sha256' || !sig) return false;
  return safeEqual(hmacHex(appSecret, rawBody), sig.toLowerCase());
}

/** Parses `t=<unix seconds>,s=<hex>` / `t=…,v1=…` headers. */
function parseTimestamped(header: string): { t: number; sig: string } | null {
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const sig = parts.s ?? parts.v1;
  return Number.isFinite(t) && sig ? { t, sig } : null;
}

/**
 * TikTok: `TikTok-Signature: t=<unix seconds>,s=<hex HMAC-SHA256(app secret, "<t>.<raw body>")>`, rejected when the
 * timestamp is more than `toleranceSeconds` away (replays).
 */
export function verifyTikTokSignature(
  rawBody: string,
  header: string | null,
  secret: string | undefined,
  now = Date.now(),
  toleranceSeconds = 300,
): boolean {
  if (!header || !secret) return false;
  const parsed = parseTimestamped(header);
  if (!parsed || Math.abs(now / 1000 - parsed.t) > toleranceSeconds) return false;
  return safeEqual(hmacHex(secret, `${parsed.t}.${rawBody}`), parsed.sig.toLowerCase());
}

/** Snapchat: `X-Snap-Signature: <hex HMAC-SHA256(webhook secret, raw body)>` (optionally prefixed `sha256=`). */
export function verifySnapSignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!header || !secret) return false;
  const sig = header.startsWith('sha256=') ? header.slice(7) : header;
  return safeEqual(hmacHex(secret, rawBody), sig.toLowerCase());
}

/** Google Ads lead form webhooks carry the shared `google_key` configured on the lead form. */
export function verifyGoogleKey(key: unknown, expected: string | undefined): boolean {
  return typeof key === 'string' && !!expected && safeEqual(key, expected);
}

/** Sandbox platform: `X-Central-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. */
export function signSandbox(rawBody: string, secret: string, now = Date.now()): string {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${hmacHex(secret, `${t}.${rawBody}`)}`;
}

export function verifySandboxSignature(rawBody: string, header: string | null, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parsed = parseTimestamped(header);
  if (!parsed || Math.abs(now / 1000 - parsed.t) > 300) return false;
  return safeEqual(hmacHex(secret, `${parsed.t}.${rawBody}`), parsed.sig.toLowerCase());
}

/* -------------------------------------------------------------------------- */
/* OAuth state: signed, short-lived, bound to a nonce cookie                   */
/* -------------------------------------------------------------------------- */

export type OAuthState = {
  organizationId: string;
  userId: string;
  provider: string;
  mode: 'live' | 'sandbox';
  /** Set when reconnecting an existing connection. */
  connectionId: string | null;
  nonce: string;
  /** Expiry, unix ms. */
  exp: number;
};

export function signState(state: OAuthState, secret: string): string {
  const body = Buffer.from(JSON.stringify(state)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyState(value: string, secret: string, nonce: string | undefined, now = Date.now()): OAuthState | null {
  const [body, sig] = value.split('.');
  if (!body || !sig || !nonce) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(expected, sig)) return null;
  try {
    const state = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState;
    if (state.exp < now || !safeEqual(state.nonce, nonce)) return null;
    return state;
  } catch {
    return null;
  }
}
