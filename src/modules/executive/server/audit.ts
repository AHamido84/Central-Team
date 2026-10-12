import 'server-only';

import { sql } from 'drizzle-orm';

import type { Session } from '@/lib/auth/session';
import { withRls } from '@/lib/db/rls';

export type ExecutiveAuditAction = 'executive_login' | 'executive_export' | 'executive_schedule_sent';

/**
 * Writes an `activity_log` row for an executive's sign-in or export (FR7, ADR-096). The SQL function checks that the
 * caller holds `executive:view` and does nothing for anyone else, so every sign-in path can call it unconditionally.
 */
export async function logExecutiveEvent(action: ExecutiveAuditAction, details: Record<string, unknown> = {}, session?: Session) {
  try {
    await withRls((tx) => tx.execute(sql`select app.log_executive_event(${action}, ${JSON.stringify(details)}::jsonb)`), session);
  } catch {
    // Auditing must never block a sign-in or a download; a failure shows in the database logs.
  }
}
