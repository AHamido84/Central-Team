import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { checkRateLimit } from '@/lib/rate-limit';
import { publicLeadSchema } from '@/modules/crm/schemas';
import { checkFormTicket, ingestLead, publicFormByToken } from '@/modules/crm/server/intake';
import { scheduleEventDispatch } from '@/lib/events/schedule';

export const dynamic = 'force-dynamic';

const body = z.object({
  fields: z.unknown(),
  /** Honeypot: a hidden field people never fill in. */
  website: z.string().max(200).optional(),
  ticket: z.string().max(200),
});

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

/**
 * Public lead form submission (no session). Spam protection: honeypot, a signed load-time ticket that must be at
 * least a few seconds and at most a few hours old, and rate limits per IP and per form. Responses never reveal
 * whether the lead already existed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await publicFormByToken(token);
  if (!form) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const ip = clientIp(request);
  if (!(await checkRateLimit(`lead-form:ip:${ip}`, 5, 600)) || !(await checkRateLimit(`lead-form:form:${form.id}`, 200, 3600)))
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'validation' }, { status: 400 });
  // Bots that fill the honeypot get a normal-looking success and nothing is stored.
  if (parsed.data.website) return NextResponse.json({ ok: true });
  const ticket = checkFormTicket(form.id, parsed.data.ticket);
  if (ticket !== 'ok') return NextResponse.json({ error: ticket === 'too_fast' ? 'too_fast' : 'expired' }, { status: 400 });

  const fields = publicLeadSchema.safeParse(parsed.data.fields);
  if (!fields.success) {
    const fieldErrors = z.flattenError(fields.error).fieldErrors;
    return NextResponse.json({ error: 'validation', fieldErrors }, { status: 400 });
  }
  const v = fields.data;
  const services = form.services.length ? v.services.filter((s) => form.services.includes(s)) : v.services;
  await ingestLead(
    form.organizationId,
    {
      fullName: v.fullName,
      company: v.company,
      phone: v.phone,
      email: v.email,
      source: 'website_form',
      sourceDetail: form.name,
      services,
      budgetRange: v.budgetRange,
      city: v.city,
      ownerId: null,
      tags: [],
      notes: '',
      formId: form.id,
      message: v.message,
    },
    'form',
  );
  scheduleEventDispatch();
  return NextResponse.json({ ok: true });
}
