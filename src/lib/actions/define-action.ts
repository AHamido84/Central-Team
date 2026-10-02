import 'server-only';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ActionFailure, toActionError, type ActionResult } from '@/lib/actions/errors';
import { getAppContext, type AgencyContext, type AppContext, type ClientContext } from '@/lib/auth/context';
import type { Tx } from '@/lib/db/client';
import { withRls } from '@/lib/db/rls';
import { scheduleEventDispatch } from '@/lib/events/schedule';
import { can } from '@/lib/permissions/can';
import type { Permission } from '@/lib/permissions/catalog';
import { checkRateLimit } from '@/lib/rate-limit';

type SideContext = { agency: AgencyContext; client: ClientContext; any: AppContext };

type ActionConfig<S extends z.ZodType, T, Side extends keyof SideContext, R = T> = {
  input: S;
  side: Side;
  /** Early check for UX; RLS enforces the same rule in the database. */
  permission?: Permission | ((input: z.infer<S>) => Permission | null);
  rateLimit?: { key: string; max: number; windowSeconds: number };
  handler: (args: { input: z.infer<S>; tx: Tx; ctx: SideContext[Side] }) => Promise<T>;
  /**
   * Slow work that must not hold the transaction open (e.g. an AI provider call, ADR-073): runs after commit with what
   * the handler prepared (RLS-checked), and its result — or its failure — is the action's result. It may write through
   * its own `withRls` / service calls; events it emits are dispatched like the handler's.
   */
  complete?: (args: { input: z.infer<S>; prepared: T; ctx: SideContext[Side] }) => Promise<R>;
  /** Runs after commit (e.g. transactional emails). Failures are logged, never surfaced. Notification fan-out belongs in event consumers. */
  after?: (args: { input: z.infer<S>; result: T; ctx: SideContext[Side] }) => Promise<void>;
  revalidate?: string[] | ((input: z.infer<S>, result: T) => string[]);
};

/**
 * The only way to write a mutation (CLAUDE.md §6): validate → authenticate → side check →
 * can() → RLS transaction → commit → event dispatch (scheduled) → after hooks → revalidate → typed Result.
 */
export function defineAction<S extends z.ZodType, T, Side extends keyof SideContext, R = T>(config: ActionConfig<S, T, Side, R>) {
  return async (raw: z.input<S>): Promise<ActionResult<R>> => {
    const parsed = config.input.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'validation', fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> },
      };
    }
    const input = parsed.data as z.infer<S>;
    try {
      const ctx = await getAppContext();
      if (!ctx) throw new ActionFailure('unauthenticated');
      if (config.side !== 'any' && ctx.side !== config.side) throw new ActionFailure('forbidden');
      const typedCtx = ctx as SideContext[Side];

      const permission = typeof config.permission === 'function' ? config.permission(input) : config.permission;
      if (permission && !can(ctx.permissions, permission)) throw new ActionFailure('forbidden');

      if (config.rateLimit) {
        const allowed = await checkRateLimit(
          `${config.rateLimit.key}:${ctx.session.userId}`,
          config.rateLimit.max,
          config.rateLimit.windowSeconds,
        );
        if (!allowed) throw new ActionFailure('rate_limited');
      }

      const result = await withRls((tx) => config.handler({ input, tx, ctx: typedCtx }), ctx.session);
      // Committed: consumers (notifications, …) react to the events the handler emitted.
      scheduleEventDispatch();
      const final = config.complete ? await config.complete({ input, prepared: result, ctx: typedCtx }) : (result as unknown as R);
      if (config.complete) scheduleEventDispatch();

      if (config.after) {
        try {
          await config.after({ input, result, ctx: typedCtx });
        } catch (error) {
          console.error('[action.after] failed', error);
        }
      }
      const paths = typeof config.revalidate === 'function' ? config.revalidate(input, result) : config.revalidate;
      for (const path of paths ?? []) revalidatePath(path, 'layout');
      return { ok: true, data: final };
    } catch (error) {
      const actionError = toActionError(error);
      if (actionError.code === 'unknown') console.error('[action] unexpected error', error);
      return { ok: false, error: actionError };
    }
  };
}
