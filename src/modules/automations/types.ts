import type { z } from 'zod';

import type { actionSchema, conditionSchema } from '@/modules/automations/schemas';

export type AutomationCondition = z.infer<typeof conditionSchema>;
export type AutomationAction = z.infer<typeof actionSchema>;

export type ConditionResult = { field: string; op: string; expected: unknown; actual: unknown; passed: boolean };

export type ActionResult = {
  id: string;
  type: string;
  status: 'succeeded' | 'failed' | 'skipped' | 'planned';
  /** Short machine-readable outcome, e.g. `{ taskId }`, `{ notified: 2 }`, `{ status: 200 }` — shown in the run log. */
  output?: Record<string, string | number | boolean | null>;
  /** Error code (translated in the UI) and a short detail. */
  error?: string;
};
