import { timingSafeEqual } from 'node:crypto';

import { after, NextResponse, type NextRequest } from 'next/server';

import { env } from '@/lib/env';
import { scheduleEventDispatch } from '@/lib/events/schedule';
import { checkRateLimit } from '@/lib/rate-limit';
import { providerKeys, type ProviderKey } from '@/modules/integrations/constants';
import { processWebhookEvents, receiveWebhook } from '@/modules/integrations/server/webhooks';

export const dynamic = 'force-dynamic';

const MAX_BODY = 512 * 1024;

function provider(raw: string): ProviderKey | null {
  return (providerKeys as readonly string[]).includes(raw) ? (raw as ProviderKey) : null;
}

/**
 * Meta / WhatsApp subscription check: echo `hub.challenge` when `hub.verify_token` matches our configured token.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const key = provider((await params).provider);
  const q = request.nextUrl.searchParams;
  const expected = env().META_WEBHOOK_VERIFY_TOKEN;
  const given = q.get('hub.verify_token') ?? '';
  const ok =
    (key === 'meta' || key === 'whatsapp') &&
    q.get('hub.mode') === 'subscribe' &&
    !!expected &&
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return new NextResponse(q.get('hub.challenge') ?? '', { status: 200, headers: { 'content-type': 'text/plain' } });
}

/**
 * Inbound platform webhooks (lead ads, WhatsApp delivery statuses). The raw body is signature-checked per platform
 * before anything is parsed (ADR-069); accepted items are stored (deduplicated) and processed after the response.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const key = provider((await params).provider);
  if (!key) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!(await checkRateLimit(`hooks:${key}:${ip}`, 600, 60))) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: 'too_large' }, { status: 413 });

  const result = await receiveWebhook(key, raw, request.headers);
  if (result.status === 401) return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  if (result.accepted.length)
    after(async () => {
      await processWebhookEvents(result.accepted);
      scheduleEventDispatch();
    });
  return NextResponse.json({ received: result.accepted.length, duplicates: result.duplicates });
}
