import 'server-only';

import { after } from 'next/server';

import { dispatchPendingEvents, type DispatchResult } from '@/lib/events/dispatcher';

let running: Promise<DispatchResult> | null = null;
let rerun = false;

/** Runs the dispatcher with every registered consumer; overlapping calls in one process coalesce into one extra pass. */
export async function runDispatcher(): Promise<DispatchResult> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    const { consumers } = await import('@/lib/events/consumers');
    const total: DispatchResult = { delivered: 0, failed: 0 };
    do {
      rerun = false;
      // Keep draining while full batches come back (bounded so one request never spins forever).
      for (let i = 0; i < 10; i++) {
        const r = await dispatchPendingEvents(consumers);
        total.delivered += r.delivered;
        total.failed += r.failed;
        if (r.delivered + r.failed === 0) break;
      }
    } while (rerun);
    return total;
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * Called after a mutation commits: delivers its events once the response has been sent. The cron route
 * (`/api/cron/dispatch-events`) is the safety net for retries and for anything a crashed process left behind.
 */
export function scheduleEventDispatch(): void {
  const task = () =>
    runDispatcher().then(
      () => undefined,
      (error) => console.error('[events] dispatch failed', error),
    );
  try {
    after(task);
  } catch {
    // Outside a request scope (scripts): run detached.
    void task();
  }
}
