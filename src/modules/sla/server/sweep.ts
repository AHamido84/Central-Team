import 'server-only';

import { and, eq, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db/client';
import { organizations, requests, slaBreaches, slaPolicies } from '@/lib/db/schema';
import { emitEvent } from '@/lib/events/emit';
import { responseState, slaState, type RequestStatus } from '@/modules/requests/constants';
import { zonedInstant } from '@/modules/sla/calendar';
import type { BreachKind, BreachLevel } from '@/modules/sla/constants';
import { liveClient } from '@/lib/db/live';

export type SlaSweepResult = { atRisk: number; breached: number; resolved: number };

const ended: RequestStatus[] = ['closed', 'cancelled', 'rejected'];

/** End of the due day in the organization's time zone — the resolution deadline. */
export function resolutionDeadline(dueDate: string, timeZone: string): Date {
  return new Date(zonedInstant(dueDate, 1440, timeZone).getTime() - 1000);
}

/**
 * SLA breach detection, run from the cron route with the service connection (listed service path, CLAUDE.md §6)
 * because it scans every organization. For each open request it records the first time a response or resolution
 * target turns at risk or is breached (one `sla_breaches` row per request × kind × level, so alerts fire once)
 * and emits `sla.at_risk` / `sla.breached`; notifications come from the consumer (ADR-028). Rows whose target was
 * met afterwards, or whose request ended, are marked resolved. The live states shown in the app don't depend on it.
 */
export async function runSlaSweep(now = new Date()): Promise<SlaSweepResult> {
  const result: SlaSweepResult = { atRisk: 0, breached: 0, resolved: 0 };
  const orgs = await dbAdmin.select({ id: organizations.id, tz: organizations.defaultTimezone }).from(organizations);
  for (const org of orgs) {
    await dbAdmin.transaction(async (tx) => {
      const open = await tx
        .select({
          id: requests.id,
          clientId: requests.clientId,
          status: requests.status,
          submittedAt: requests.submittedAt,
          dueDate: requests.dueDate,
          deliveredAt: requests.deliveredAt,
          firstResponseAt: requests.firstResponseAt,
          responseDueAt: requests.responseDueAt,
          slaPausedAt: requests.slaPausedAt,
          policyId: requests.slaPolicyId,
          atRiskPercent: slaPolicies.atRiskPercent,
        })
        .from(requests)
        .leftJoin(slaPolicies, eq(slaPolicies.id, requests.slaPolicyId))
        .where(
          and(
            eq(requests.organizationId, org.id),
            notInArray(requests.status, ['draft', ...ended]),
            isNull(requests.deletedAt),
            liveClient(requests.clientId),
            isNotNull(requests.submittedAt),
            or(isNull(requests.deliveredAt), and(isNull(requests.firstResponseAt), isNotNull(requests.responseDueAt))),
          ),
        );

      const iso = (d: Date | null) => (d ? d.toISOString() : null);
      const candidates: {
        requestId: string;
        clientId: string;
        policyId: string | null;
        kind: BreachKind;
        level: BreachLevel;
        dueAt: Date;
      }[] = [];
      for (const r of open) {
        const base = {
          status: r.status as RequestStatus,
          submittedAt: iso(r.submittedAt),
          atRiskPercent: r.atRiskPercent,
        };
        const response = responseState({ ...base, responseDueAt: iso(r.responseDueAt), firstResponseAt: iso(r.firstResponseAt) }, now);
        if ((response === 'at_risk' || response === 'overdue') && r.responseDueAt)
          candidates.push({
            requestId: r.id,
            clientId: r.clientId,
            policyId: r.policyId,
            kind: 'response',
            level: response === 'overdue' ? 'breached' : 'at_risk',
            dueAt: r.responseDueAt,
          });
        const resolution = slaState({ ...base, dueDate: r.dueDate, deliveredAt: iso(r.deliveredAt), slaPausedAt: iso(r.slaPausedAt) }, now);
        if ((resolution === 'at_risk' || resolution === 'overdue') && r.dueDate)
          candidates.push({
            requestId: r.id,
            clientId: r.clientId,
            policyId: r.policyId,
            kind: 'resolution',
            level: resolution === 'overdue' ? 'breached' : 'at_risk',
            dueAt: resolutionDeadline(r.dueDate, org.tz),
          });
      }

      for (const c of candidates) {
        // Once breached, an at-risk alert would only be noise.
        if (c.level === 'at_risk') {
          const [already] = await tx
            .select({ id: slaBreaches.id })
            .from(slaBreaches)
            .where(and(eq(slaBreaches.requestId, c.requestId), eq(slaBreaches.kind, c.kind), eq(slaBreaches.level, 'breached')));
          if (already) continue;
        }
        const [inserted] = await tx
          .insert(slaBreaches)
          .values({
            organizationId: org.id,
            clientId: c.clientId,
            requestId: c.requestId,
            policyId: c.policyId,
            kind: c.kind,
            level: c.level,
            dueAt: c.dueAt,
            detectedAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: slaBreaches.id });
        if (!inserted) continue;
        if (c.level === 'breached') result.breached++;
        else result.atRisk++;
        await emitEvent(tx, {
          type: c.level === 'breached' ? 'sla.breached' : 'sla.at_risk',
          organizationId: org.id,
          actorId: null,
          aggregate: { type: 'request', id: c.requestId },
          clientId: c.clientId,
          payload: { breachId: inserted.id, requestId: c.requestId, clientId: c.clientId, kind: c.kind, dueAt: c.dueAt.toISOString() },
        });
      }

      // Resolve: the reply came, the work was delivered, or the request ended.
      const resolved = await tx.execute<{ id: string }>(sql`
        update public.sla_breaches b set resolved_at = ${now.toISOString()}::timestamptz
        from public.requests r
        where r.id = b.request_id and b.organization_id = ${org.id} and b.resolved_at is null
          and (r.status in ('closed', 'cancelled', 'rejected')
            or (b.kind = 'response' and r.first_response_at is not null)
            or (b.kind = 'resolution' and r.delivered_at is not null))
        returning b.id`);
      result.resolved += resolved.length;
    });
  }
  return result;
}
