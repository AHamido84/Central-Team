import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { scheduleEventDispatch } from '@/lib/events/schedule';
import { checkRateLimit } from '@/lib/rate-limit';
import { webhookLeadSchema } from '@/modules/crm/schemas';
import { ingestLead, webhookOrganization } from '@/modules/crm/server/intake';

export const dynamic = 'force-dynamic';

/**
 * Inbound leads from other systems (Phase 7: Meta / TikTok / Snap lead ads, WhatsApp). Contract (ARCHITECTURE §21):
 * `POST /api/webhooks/leads`, `Authorization: Bearer ctw_…` (a token from Sales settings), JSON body per
 * `webhookLeadSchema`. Idempotent on (`source`, `external_ref`): replays return the same lead with `duplicate: true`.
 */
export async function POST(request: NextRequest) {
  const auth = await webhookOrganization(request.headers.get('authorization'));
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await checkRateLimit(`lead-webhook:${auth.tokenId}`, 120, 60)))
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parsed = webhookLeadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: 'validation', fieldErrors: z.flattenError(parsed.error).fieldErrors }, { status: 400 });
  const v = parsed.data;
  const result = await ingestLead(
    auth.organizationId,
    {
      fullName: v.full_name,
      company: v.company,
      phone: v.phone,
      email: v.email,
      source: v.source,
      sourceDetail: v.source_detail,
      externalRef: v.external_ref,
      services: v.services,
      budgetRange: v.budget_range,
      city: v.city,
      ownerId: null,
      tags: [],
      notes: '',
      message: v.message,
    },
    'webhook',
  );
  scheduleEventDispatch();
  return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
}
